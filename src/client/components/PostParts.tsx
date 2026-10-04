import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Flair, ImageRef, PostSummary } from '../../shared/api';
import type { ViewerItem, ViewerSpec } from '../app/nav';
import { useNav } from '../app/nav';
import { usePrefs } from '../app/prefs';
import { age, compact, duration, fullDate } from '../lib/format';
import { openUrl } from '../lib/platform';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ flair

export const FlairChip = ({ flair }: { flair: Flair }) => {
  const custom = Boolean(flair.background);
  const style: CSSProperties | undefined = custom
    ? { background: flair.background }
    : undefined;
  const className = [
    'chip',
    custom ? 'is-custom' : '',
    custom && flair.tone === 'dark' ? 'is-dark-text' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className} style={style} title={flair.text}>
      {flair.text}
    </span>
  );
};

// ------------------------------------------------------------------ meta line

export const PostMeta = ({
  post,
  showSub,
}: {
  post: PostSummary;
  showSub?: boolean;
}) => {
  const authorClass =
    post.distinguished === 'moderator'
      ? 'author is-mod'
      : post.distinguished === 'admin'
        ? 'author is-admin'
        : 'author';
  const showDomain = post.media.kind === 'link' || post.media.kind === 'embed';
  return (
    <div className="post-meta">
      {showSub ? (
        <>
          <span className="author">r/{post.subreddit}</span>
          <span className="dot" />
        </>
      ) : null}
      <span className={authorClass}>u/{post.author}</span>
      <span className="dot" />
      <time
        dateTime={new Date(post.createdAt).toISOString()}
        title={fullDate(post.createdAt)}
      >
        {age(post.createdAt)}
      </time>
      {post.edited ? <span title="Edited">*</span> : null}
      {showDomain ? (
        <>
          <span className="dot" />
          <span className="domain">{post.domain}</span>
        </>
      ) : null}
    </div>
  );
};

export const PostFlags = ({ post }: { post: PostSummary }) => {
  const hasAny =
    post.stickied ||
    post.nsfw ||
    post.spoiler ||
    post.locked ||
    post.flair ||
    post.crosspost;
  if (!hasAny) return null;
  return (
    <div className="post-flags">
      {post.stickied ? (
        <span className="tag pinned">
          <Icon name="pin" size={11} /> Pinned
        </span>
      ) : null}
      {post.nsfw ? <span className="tag nsfw">NSFW</span> : null}
      {post.spoiler ? <span className="tag spoiler">Spoiler</span> : null}
      {post.locked ? (
        <span className="tag locked">
          <Icon name="lock" size={11} /> Locked
        </span>
      ) : null}
      {post.crosspost ? <span className="tag oc">Crosspost</span> : null}
      {post.flair ? <FlairChip flair={post.flair} /> : null}
    </div>
  );
};

// ------------------------------------------------------------------ viewer helpers

export const viewerItemsFor = (post: PostSummary): ViewerItem[] => {
  const media = post.media;
  switch (media.kind) {
    case 'image':
      return [
        {
          kind: 'image',
          url: media.image.url,
          width: media.image.width,
          height: media.image.height,
        },
      ];
    case 'gallery':
      return media.items.map((item) => ({
        kind: 'image',
        url: item.url,
        width: item.width,
        height: item.height,
      }));
    case 'video':
      return [
        {
          kind: 'video',
          width: media.video.width,
          height: media.video.height,
          isGif: media.video.isGif,
          ...(media.video.mp4 ? { mp4: media.video.mp4 } : {}),
          ...(media.video.hls ? { hls: media.video.hls } : {}),
          ...(media.poster ? { poster: media.poster.url } : {}),
        },
      ];
    default:
      return [];
  }
};

export const hasViewerMedia = (post: PostSummary): boolean =>
  post.media.kind === 'image' ||
  post.media.kind === 'gallery' ||
  post.media.kind === 'video';

export const viewerSpecFor = (
  post: PostSummary,
  index: number,
  origin: Element | null
): ViewerSpec => ({
  items: viewerItemsFor(post),
  index,
  title: post.title,
  permalink: post.permalink,
  sourceUrl: post.url,
  origin: origin?.getBoundingClientRect() ?? null,
});

/** Activate a post's primary media: viewer for images/video, browser for links. */
export const useActivateMedia = () => {
  const nav = useNav();
  return (post: PostSummary, index: number, origin: Element | null) => {
    if (hasViewerMedia(post)) {
      nav.openMedia(viewerSpecFor(post, index, origin));
    } else if (post.media.kind === 'link' || post.media.kind === 'embed') {
      nav.openLink(post.media.url);
    } else {
      nav.openPost(post);
    }
  };
};

// ------------------------------------------------------------------ blur state

export const useSensitive = (post: PostSummary) => {
  const { prefs } = usePrefs();
  const sensitive =
    (post.nsfw && prefs.blurNsfw) || (post.spoiler && prefs.blurSpoilers);
  const [revealed, setRevealed] = useState(false);
  return {
    blurred: sensitive && !revealed,
    label: post.nsfw ? 'NSFW' : 'Spoiler',
    reveal: () => setRevealed(true),
  };
};

// ------------------------------------------------------------------ thumbnails

const thumbIcon = (post: PostSummary): IconName => {
  switch (post.media.kind) {
    case 'video':
      return 'play';
    case 'gallery':
      return 'gallery';
    case 'image':
      return 'image';
    case 'poll':
      return 'poll';
    case 'self':
      return 'text';
    default:
      return 'link';
  }
};

const thumbUrl = (post: PostSummary): string | undefined => {
  if (post.thumb) return post.thumb.url;
  const media = post.media;
  if (media.kind === 'gallery') return media.items[0]?.url;
  if (media.kind === 'image' && !media.animated) return media.image.url;
  if (
    (media.kind === 'video' ||
      media.kind === 'embed' ||
      media.kind === 'link') &&
    media.poster
  ) {
    return media.poster.url;
  }
  return undefined;
};

export const Thumb = ({ post }: { post: PostSummary }) => {
  const activate = useActivateMedia();
  const { blurred } = useSensitive(post);
  const [failed, setFailed] = useState(false);
  const url = thumbUrl(post);
  const media = post.media;
  let badge: ReactNode = null;
  if (media.kind === 'gallery') {
    badge = (
      <span className="badge">
        <Icon name="gallery" /> {media.items.length}
      </span>
    );
  } else if (media.kind === 'video') {
    badge = (
      <span className="badge">
        {media.video.isGif ? (
          'GIF'
        ) : media.video.duration ? (
          duration(media.video.duration)
        ) : (
          <Icon name="play" />
        )}
      </span>
    );
  } else if (media.kind === 'image' && media.animated) {
    badge = <span className="badge">GIF</span>;
  } else if (media.kind === 'link' || media.kind === 'embed') {
    badge = (
      <span className="badge">
        <Icon name="external" />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`thumb${blurred ? ' is-blurred' : ''}`}
      aria-label={`Open ${media.kind}`}
      onClick={(event) => {
        event.stopPropagation();
        activate(post, 0, event.currentTarget);
      }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name={thumbIcon(post)} />
      )}
      {badge}
    </button>
  );
};

export const wantsThumb = (post: PostSummary): boolean =>
  post.media.kind !== 'self';

// ------------------------------------------------------------------ media frames

const clampRatio = (width: number, height: number, min: number, max: number) =>
  Math.min(max, Math.max(min, height / Math.max(1, width)));

type ImageFrameProps = {
  image: ImageRef;
  blurred: boolean;
  label: string;
  contain: boolean;
  onActivate: (el: Element) => void;
  onReveal: () => void;
  badge?: ReactNode;
  minRatio: number;
  maxRatio: number;
};

const ImageFrame = ({
  image,
  blurred,
  label,
  contain,
  onActivate,
  onReveal,
  badge,
  minRatio,
  maxRatio,
}: ImageFrameProps) => {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const w = natural?.w ?? image.width;
  const h = natural?.h ?? image.height;
  const ratio = clampRatio(w, h, minRatio, maxRatio);
  return (
    <button
      type="button"
      className={`media${contain ? ' is-contain' : ''}${blurred ? ' is-blurred' : ''}`}
      style={{ aspectRatio: `1 / ${ratio}` }}
      onClick={(event) => {
        event.stopPropagation();
        if (blurred) onReveal();
        else onActivate(event.currentTarget);
      }}
      aria-label={blurred ? `Reveal ${label} media` : 'Open media'}
    >
      {failed ? (
        <div className="media-fallback">
          <Icon name="image" size={28} />
          <span>Preview unavailable — tap to open</span>
        </div>
      ) : (
        <img
          src={image.url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
          onError={() => setFailed(true)}
        />
      )}
      {blurred ? (
        <div className="media-veil">
          <span>{label} · tap to view</span>
        </div>
      ) : (
        badge
      )}
    </button>
  );
};

/** Muted inline loop for GIF-like videos that plays only while visible. */
const InlineLoop = ({ src, poster }: { src: string; poster?: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.5 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
    />
  );
};

type MediaFrameProps = { post: PostSummary; variant: 'card' | 'detail' };

export const MediaFrame = ({ post, variant }: MediaFrameProps) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const { blurred, label, reveal } = useSensitive(post);
  const media = post.media;
  const detail = variant === 'detail';
  const minRatio = detail ? 0.3 : 0.5;
  const maxRatio = detail ? 1.9 : 1.25;
  const open = (index: number, el: Element | null) =>
    nav.openMedia(viewerSpecFor(post, index, el));

  switch (media.kind) {
    case 'image':
      return (
        <ImageFrame
          image={media.image}
          blurred={blurred}
          label={label}
          contain={detail}
          minRatio={minRatio}
          maxRatio={maxRatio}
          onReveal={reveal}
          onActivate={(el) => open(0, el)}
          badge={
            media.animated ? <span className="media-badge">GIF</span> : null
          }
        />
      );

    case 'gallery': {
      const shown = media.items.slice(0, 3);
      const extra = media.items.length - shown.length;
      if (detail || media.items.length === 1) {
        const first = media.items[0];
        if (!first) return null;
        return (
          <ImageFrame
            image={first}
            blurred={blurred}
            label={label}
            contain={detail}
            minRatio={minRatio}
            maxRatio={maxRatio}
            onReveal={reveal}
            onActivate={(el) => open(0, el)}
            badge={
              <span className="media-badge">
                <Icon name="gallery" /> 1 / {media.items.length}
              </span>
            }
          />
        );
      }
      return (
        <div
          className={`gallery-strip${shown.length === 2 ? ' is-two' : ''}${blurred ? ' media is-blurred' : ''}`}
        >
          {shown.map((item, index) => (
            <div key={item.url}>
              <button
                type="button"
                style={{ width: '100%', height: '100%' }}
                aria-label={`Open image ${index + 1} of ${media.items.length}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (blurred) reveal();
                  else open(index, event.currentTarget);
                }}
              >
                <img src={item.url} alt="" loading="lazy" decoding="async" />
                {index === shown.length - 1 && extra > 0 ? (
                  <span className="more">+{extra}</span>
                ) : null}
              </button>
            </div>
          ))}
          {blurred ? (
            <div className="media-veil" style={{ pointerEvents: 'none' }}>
              <span>{label} · tap to view</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'video': {
      const ratio = clampRatio(
        media.video.width,
        media.video.height,
        minRatio,
        maxRatio
      );
      const loop =
        media.video.isGif && prefs.autoplayGifs && media.video.mp4 && !blurred;
      return (
        <button
          type="button"
          className={`media${detail ? ' is-contain' : ''}${blurred ? ' is-blurred' : ''}`}
          style={{ aspectRatio: `1 / ${ratio}` }}
          onClick={(event) => {
            event.stopPropagation();
            if (blurred) reveal();
            else open(0, event.currentTarget);
          }}
          aria-label={blurred ? `Reveal ${label} video` : 'Play video'}
        >
          {loop && media.video.mp4 ? (
            <InlineLoop
              src={media.video.mp4}
              {...(media.poster ? { poster: media.poster.url } : {})}
            />
          ) : media.poster ? (
            <img
              src={media.poster.url}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="media-fallback">
              <Icon name="play" size={28} />
            </div>
          )}
          {blurred ? (
            <div className="media-veil">
              <span>{label} · tap to view</span>
            </div>
          ) : loop ? (
            <span className="media-badge">GIF</span>
          ) : (
            <>
              <div className="media-play">
                <span>
                  <Icon name="play" size={28} />
                </span>
              </div>
              {media.video.duration ? (
                <span className="media-badge">
                  {duration(media.video.duration)}
                </span>
              ) : null}
            </>
          )}
        </button>
      );
    }

    case 'embed':
      return (
        <div className="link-hero">
          {media.poster ? (
            <button
              type="button"
              className={`media${blurred ? ' is-blurred' : ''}`}
              style={{
                aspectRatio: `1 / ${clampRatio(media.poster.width, media.poster.height, 0.5, 1)}`,
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (blurred) reveal();
                else openUrl(media.url);
              }}
              aria-label={`Open on ${media.provider}`}
            >
              <img
                src={media.poster.url}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {blurred ? (
                <div className="media-veil">
                  <span>{label} · tap to view</span>
                </div>
              ) : (
                <div className="media-play">
                  <span>
                    <Icon name="play" size={28} />
                  </span>
                </div>
              )}
            </button>
          ) : null}
          <LinkCard
            url={media.url}
            domain={media.provider}
            title={media.title}
            flush={Boolean(media.poster)}
          />
        </div>
      );

    case 'link':
      return (
        <div className="link-hero">
          {media.poster && media.poster.width >= 320 ? (
            <button
              type="button"
              className={`media${blurred ? ' is-blurred' : ''}`}
              style={{
                aspectRatio: `1 / ${clampRatio(media.poster.width, media.poster.height, 0.45, 0.75)}`,
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (blurred) reveal();
                else nav.openLink(media.url);
              }}
              aria-label={`Open link to ${media.domain}`}
            >
              <img
                src={media.poster.url}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </button>
          ) : null}
          <LinkCard
            url={media.url}
            domain={media.domain}
            flush={Boolean(media.poster && media.poster.width >= 320)}
          />
        </div>
      );

    case 'poll':
      return <PollView media={media} detail={detail} />;

    default:
      return null;
  }
};

const PollView = ({
  media,
  detail,
}: {
  media: Extract<PostSummary['media'], { kind: 'poll' }>;
  detail: boolean;
}) => {
  const [now] = useState(Date.now);
  const total =
    media.totalVotes ??
    media.choices.reduce((sum, c) => sum + (c.votes ?? 0), 0);
  const open = media.endsAt ? media.endsAt > now : false;
  return (
    <div
      className="poll"
      style={{ padding: detail ? '0 16px 8px' : '0 14px 4px' }}
    >
      {media.choices.map((choice) => {
        const share = total && choice.votes ? (choice.votes / total) * 100 : 0;
        return (
          <div className="poll-option" key={choice.text}>
            <div className="bar" style={{ width: `${share}%` }} />
            <span>{choice.text}</span>
            {share ? <span>{Math.round(share)}%</span> : null}
          </div>
        );
      })}
      <div className="poll-meta">
        {total ? `${compact(total)} votes · ` : ''}
        {open ? 'Voting open — vote on Reddit' : 'Voting closed'}
      </div>
    </div>
  );
};

export const LinkCard = ({
  url,
  domain,
  title,
  flush,
}: {
  url: string;
  domain: string;
  title?: string | undefined;
  flush?: boolean;
}) => {
  const nav = useNav();
  return (
    <button
      type="button"
      className="link-card"
      data-ripple
      data-flush={flush || undefined}
      onClick={(event) => {
        event.stopPropagation();
        nav.openLink(url);
      }}
    >
      <span className="icon-wrap">
        <Icon name="link" size={20} />
      </span>
      <span className="text">
        <div className="domain">{title ?? domain}</div>
        <div className="url">{url.replace(/^https?:\/\/(www\.)?/, '')}</div>
      </span>
      <Icon name="external" size={18} />
    </button>
  );
};
