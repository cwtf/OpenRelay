import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { InlineMedia } from '../../shared/api';
import { isInlineImage, normaliseHref } from './links';
import { site } from './api';
import { decodeEntities, parseBlocks, type Block } from './markdownParser';

export { decodeEntities };

/**
 * A small, safe renderer for Reddit-flavoured markdown. It produces React
 * elements directly (never HTML strings), so user content cannot inject markup.
 */

export type MarkdownActions = {
  onLink: (href: string) => void;
  /** `media` is set for an image the body refers to by ID, like a GIF. */
  onImage: (url: string, media?: InlineMedia) => void;
  highlight: RegExp | null;
  /** The Autoplay GIFs and Load GIFs from Giphy preferences. */
  autoplayGifs: boolean;
  giphyGifs: boolean;
};

const noop = () => undefined;
export const MarkdownContext = createContext<MarkdownActions>({
  onLink: noop,
  onImage: noop,
  highlight: null,
  autoplayGifs: true,
  giphyGifs: false,
});

/** The current body's media, keyed by the ID its `![alt](<id>)` uses. */
const MediaContext = createContext<Record<string, InlineMedia> | undefined>(
  undefined
);

// ---------------------------------------------------------------------------
// Inline rendering

type InlineRule = {
  re: RegExp;
  render: (match: RegExpExecArray, key: string) => ReactNode;
};

const trimUrl = (url: string): string => {
  let result = url;
  for (;;) {
    const last = result[result.length - 1];
    if (!last) break;
    if ('.,;:!?\'"*_~'.includes(last)) {
      result = result.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (result.match(/\(/g) ?? []).length;
      const closes = (result.match(/\)/g) ?? []).length;
      if (closes > opens) {
        result = result.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return result;
};

const Spoiler = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`md-spoiler${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={open ? undefined : 'Spoiler, tap to reveal'}
      onClick={(event) => {
        if (open) return;
        event.stopPropagation();
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setOpen(true);
      }}
    >
      {children}
    </span>
  );
};

const Link = ({ href, children }: { href: string; children: ReactNode }) => {
  const { onLink } = useContext(MarkdownContext);
  // Links relative to the site (`/c/linux` on Lemmy) lead there.
  const safe = normaliseHref(
    /^\/(?!\/)/.test(href) ? new URL(href, site.baseUrl).href : href,
  );
  if (!safe) return <>{children}</>;
  return (
    <a
      className="md-link"
      href={safe}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onLink(safe);
      }}
    >
      {children}
    </a>
  );
};

/**
 * Reserves the media's box (at most 360×320) before it loads. Giphy GIFs that
 * Reddit has no copy of have no known size (0×0) and take their own.
 */
const mediaSize = ({
  width,
  height,
}: InlineMedia): CSSProperties | undefined => {
  if (!width || !height) return undefined;
  const scale = Math.min(1, 360 / width, 320 / height);
  return {
    width: Math.round(width * scale),
    height: 'auto',
    aspectRatio: `${width} / ${height}`,
  };
};

/**
 * A GIF's MP4, far smaller than the GIF itself. It loads once it scrolls into
 * view and loops silently; without autoplay, or with reduced motion, it waits
 * on its first frame.
 */
const InlineVideo = ({
  media,
  label,
  onSize,
  onError,
}: {
  media: InlineMedia;
  label: string;
  onSize: (width: number, height: number) => void;
  onError: () => void;
}) => {
  const { autoplayGifs } = useContext(MarkdownContext);
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '300px' }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <video
      ref={ref}
      src={visible ? media.mp4 : undefined}
      aria-label={label}
      style={mediaSize(media)}
      autoPlay={
        autoplayGifs && document.documentElement.dataset.motion !== 'reduced'
      }
      muted
      loop
      playsInline
      onLoadedMetadata={(event) =>
        onSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
      }
      onError={onError}
    />
  );
};

const InlineImage = ({
  url,
  alt,
  media,
}: {
  url: string;
  alt: string;
  media?: InlineMedia;
}) => {
  const { onImage, onLink } = useContext(MarkdownContext);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number }>();
  if (failed) {
    return <Link href={url}>{alt || url}</Link>;
  }
  return (
    <button
      type="button"
      className="md-image"
      onClick={(event) => {
        event.stopPropagation();
        onImage(url, media && size ? { ...media, ...size } : media);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onLink(url);
      }}
    >
      {media?.mp4 ? (
        <InlineVideo
          media={media}
          label={alt}
          onSize={(width, height) => setSize({ width, height })}
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={media ? mediaSize(media) : undefined}
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
};

/** `![alt](<id>)`: an image the body refers to by ID, such as a Giphy GIF. */
const MediaRef = ({ target, alt }: { target: string; alt: string }) => {
  const media = useContext(MediaContext);
  const { giphyGifs } = useContext(MarkdownContext);
  // `giphy|<id>|downsized` may be listed under `giphy|<id>`.
  const item =
    media?.[target] ?? media?.[target.split('|').slice(0, 2).join('|')];
  if (item) return <InlineImage url={item.url} alt={alt} media={item} />;
  if (/^giphy\|/.test(target)) {
    const id = target.split('|')[1] ?? '';
    // Reddit often lists a Giphy GIF only as `"status": "invalid"`, with no
    // URLs, so Giphy has the only copy.
    if (giphyGifs && /^[A-Za-z0-9]+$/.test(id)) {
      const giphy: InlineMedia = {
        url: `https://i.giphy.com/media/${id}/giphy.gif`,
        mp4: `https://i.giphy.com/media/${id}/giphy.mp4`,
        width: 0,
        height: 0,
      };
      return <InlineImage url={giphy.url} alt={alt} media={giphy} />;
    }
    return <Link href={`https://giphy.com/gifs/${id}`}>GIF</Link>;
  }
  return <Link href={target}>{alt || target}</Link>;
};

/**
 * An image on a Lemmy instance's image server (`/pictrs/image/<file>`), as
 * Lemmy embeds uploads; any instance's, since comments federate. Only on
 * Lemmy, where posts already show images from other instances.
 */
const PICTRS_IMAGE =
  /^https:\/\/[a-z0-9.-]+(?::\d+)?\/pictrs\/image\/[\w-]+\.(jpe?g|png|gif|webp|avif)(\?[^\s]*)?$/i;
const isEmbeddedImage = (url: string): boolean =>
  isInlineImage(url) || (site.name === 'Lemmy' && PICTRS_IMAGE.test(url));

const Highlighted = ({ text }: { text: string }) => {
  const { highlight } = useContext(MarkdownContext);
  if (!highlight || !text) return <>{text}</>;
  const parts = text.split(highlight);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="md-mark">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
};

const RULES: InlineRule[] = [
  {
    re: /\\([\\`*_{}[\]()#+\-.!>~^|<])/,
    render: (m) => m[1],
  },
  {
    re: /(`+)([\s\S]*?[^`])\1(?!`)/,
    render: (m, key) => (
      <code key={key} className="md-code">
        {m[2]}
      </code>
    ),
  },
  {
    re: / {2,}\n|\\\n/,
    render: (_m, key) => <br key={key} />,
  },
  {
    re: />!([\s\S]+?)!</,
    render: (m, key) => <Spoiler key={key}>{inline(m[1] ?? '', key)}</Spoiler>,
  },
  {
    re: /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/,
    render: (m, key) => {
      const alt = m[1] ?? '';
      const target = m[2] ?? '';
      if (/^emote\|/.test(target))
        return <span key={key}>{alt ? `:${alt}:` : ''}</span>;
      if (isEmbeddedImage(target))
        return <InlineImage key={key} url={target} alt={alt} />;
      return <MediaRef key={key} target={target} alt={alt} />;
    },
  },
  {
    re: /\[((?:\\.|[^[\]\\]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]+(?:\([^\s)]*\)[^\s)>]*)?)>?(?:\s+["'][^"']*["'])?\s*\)/,
    render: (m, key) => (
      <Link key={key} href={m[2] ?? ''}>
        {inline(m[1] || (m[2] ?? ''), key)}
      </Link>
    ),
  },
  {
    re: /https?:\/\/[^\s<>[\]]+/,
    render: (m, key) => {
      const url = trimUrl(m[0]);
      const rest = m[0].slice(url.length);
      if (isInlineImage(url)) {
        return (
          <span key={key}>
            <InlineImage url={url} alt="" />
            {rest}
          </span>
        );
      }
      return (
        <span key={key}>
          <Link href={url}>{url.replace(/^https?:\/\/(www\.)?/, '')}</Link>
          {rest}
        </span>
      );
    },
  },
  // Lemmy's `!community@instance` and `@user@instance`.
  ...(site.name === "Lemmy"
    ? [
        {
          re: /(?<![\w/@!])([!@])([\w]{1,50})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i,
          render: (m: RegExpExecArray, key: string) => (
            <Link
              key={key}
              href={`/${m[1] === "!" ? "c" : "u"}/${m[2]}@${m[3]}`}
            >
              {m[0]}
            </Link>
          ),
        },
      ]
    : []),
  {
    re: /(?<![\w/])\/?(r|u)\/([A-Za-z0-9_-]{2,21})/,
    render: (m, key) => (
      <Link key={key} href={`https://www.reddit.com/${m[1]}/${m[2]}`}>
        {m[0]}
      </Link>
    ),
  },
  {
    re: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/,
    render: (m, key) => (
      <strong key={key}>{inline(m[1] ?? m[2] ?? '', key)}</strong>
    ),
  },
  {
    re: /~~(?=\S)([\s\S]*?\S)~~/,
    render: (m, key) => <del key={key}>{inline(m[1] ?? '', key)}</del>,
  },
  {
    re: /\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<![A-Za-z0-9])_(?=\S)([\s\S]*?\S)_(?![A-Za-z0-9])/,
    render: (m, key) => <em key={key}>{inline(m[1] ?? m[2] ?? '', key)}</em>,
  },
  {
    re: /\^\(([^)\n]+)\)|\^([^\s^()]+)/,
    render: (m, key) => <sup key={key}>{inline(m[1] ?? m[2] ?? '', key)}</sup>,
  },
  {
    re: /\n/,
    render: () => ' ',
  },
];

export const inline = (text: string, keyPrefix = 'i'): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let rest = text;
  let counter = 0;
  while (rest) {
    let best: {
      index: number;
      match: RegExpExecArray;
      rule: InlineRule;
    } | null = null;
    for (const rule of RULES) {
      const match = rule.re.exec(rest);
      if (match && (best === null || match.index < best.index)) {
        best = { index: match.index, match, rule };
        if (match.index === 0) break;
      }
    }
    if (!best) {
      nodes.push(<Highlighted key={`${keyPrefix}-${counter}`} text={rest} />);
      break;
    }
    if (best.index > 0) {
      nodes.push(
        <Highlighted
          key={`${keyPrefix}-${counter++}`}
          text={rest.slice(0, best.index)}
        />
      );
    }
    const key = `${keyPrefix}-${counter++}`;
    const rendered = best.rule.render(best.match, key);
    nodes.push(
      typeof rendered === 'string' ? (
        <Highlighted key={key} text={rendered} />
      ) : (
        rendered
      )
    );
    rest = rest.slice(best.index + best.match[0].length);
  }
  return nodes;
};

// ---------------------------------------------------------------------------
// Block rendering

const renderBlocks = (blocks: Block[], prefix: string): ReactNode[] =>
  blocks.map((block, index) => {
    const key = `${prefix}.${index}`;
    switch (block.t) {
      case 'p':
        return <p key={key}>{inline(block.text, key)}</p>;
      case 'h': {
        const level = Math.min(6, Math.max(1, block.level));
        const Tag = `h${level}` as 'h1';
        return (
          <Tag key={key} className="md-h">
            {inline(block.text, key)}
          </Tag>
        );
      }
      case 'code':
        return (
          <pre key={key} className="md-pre">
            <code>{block.text}</code>
          </pre>
        );
      case 'spoiler':
        return (
          <details key={key} className="md-details">
            <summary>{inline(block.title, key)}</summary>
            {renderBlocks(block.children, key)}
          </details>
        );
      case 'quote':
        return (
          <blockquote key={key}>{renderBlocks(block.children, key)}</blockquote>
        );
      case 'hr':
        return <hr key={key} />;
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}.${itemIndex}`}>
            {renderBlocks(item, `${key}.${itemIndex}`)}
          </li>
        ));
        return block.ordered ? (
          <ol key={key} start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case 'table':
        return (
          <div key={key} className="md-table-wrap">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th
                      key={cellIndex}
                      style={{ textAlign: block.align[cellIndex] ?? undefined }}
                    >
                      {inline(cell, `${key}.h${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {block.head.map((_cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        style={{
                          textAlign: block.align[cellIndex] ?? undefined,
                        }}
                      >
                        {inline(
                          row[cellIndex] ?? '',
                          `${key}.${rowIndex}.${cellIndex}`
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });

type MarkdownProps = {
  source: string;
  className?: string;
  /** Media the body refers to by ID, from the comment's `media_metadata`. */
  media?: Record<string, InlineMedia>;
};

export const Markdown = memo(({ source, className, media }: MarkdownProps) => {
  const { highlight } = useContext(MarkdownContext);
  const blocks = useMemo(() => parseBlocks(decodeEntities(source)), [source]);
  // `highlight` is read through context by leaf nodes; referencing it here
  // keeps memoised output in sync when the search term changes.
  return (
    <div
      className={className ? `md ${className}` : 'md'}
      data-hl={highlight ? '1' : undefined}
    >
      <MediaContext.Provider value={media}>
        {renderBlocks(blocks, 'b')}
      </MediaContext.Provider>
    </div>
  );
});
Markdown.displayName = 'Markdown';
