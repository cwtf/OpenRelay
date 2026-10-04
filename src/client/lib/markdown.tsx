import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { isInlineImage, normaliseHref } from './links';
import { decodeEntities, parseBlocks, type Block } from './markdownParser';

export { decodeEntities };

/**
 * A small, safe renderer for Reddit-flavoured markdown. It produces React
 * elements directly (never HTML strings), so user content cannot inject markup.
 */

export type MarkdownActions = {
  onLink: (href: string) => void;
  onImage: (url: string) => void;
  highlight: RegExp | null;
};

const noop = () => undefined;
export const MarkdownContext = createContext<MarkdownActions>({
  onLink: noop,
  onImage: noop,
  highlight: null,
});

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
  const safe = normaliseHref(href);
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

const InlineImage = ({ url, alt }: { url: string; alt: string }) => {
  const { onImage, onLink } = useContext(MarkdownContext);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Link href={url}>{alt || url}</Link>;
  }
  return (
    <button
      type="button"
      className="md-image"
      onClick={(event) => {
        event.stopPropagation();
        onImage(url);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onLink(url);
      }}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </button>
  );
};

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
      if (/^giphy\|/.test(target)) {
        const id = target.split('|')[1] ?? '';
        return (
          <Link key={key} href={`https://giphy.com/gifs/${id}`}>
            GIF
          </Link>
        );
      }
      if (/^emote\|/.test(target))
        return <span key={key}>{alt ? `:${alt}:` : ''}</span>;
      if (isInlineImage(target))
        return <InlineImage key={key} url={target} alt={alt} />;
      return (
        <Link key={key} href={target}>
          {alt || target}
        </Link>
      );
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
  {
    re: /(?<![\w/])\/?(r|u)\/([A-Za-z0-9_-]{2,21})/,
    render: (m, key) => (
      <Link key={key} href={`/${m[1]}/${m[2]}`}>
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

type MarkdownProps = { source: string; className?: string };

export const Markdown = memo(({ source, className }: MarkdownProps) => {
  const { highlight } = useContext(MarkdownContext);
  const blocks = useMemo(() => parseBlocks(decodeEntities(source)), [source]);
  // `highlight` is read through context by leaf nodes; referencing it here
  // keeps memoised output in sync when the search term changes.
  return (
    <div
      className={className ? `md ${className}` : 'md'}
      data-hl={highlight ? '1' : undefined}
    >
      {renderBlocks(blocks, 'b')}
    </div>
  );
});
Markdown.displayName = 'Markdown';
