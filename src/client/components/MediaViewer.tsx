import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { ViewerItem, ViewerSpec } from '../app/nav';
import { copyText, openUrl, redditUrl } from '../lib/platform';
import { Icon } from './Icon';

type Transform = { scale: number; x: number; y: number };
const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 5;

const apply = (el: HTMLElement | null, t: Transform, animate = false) => {
  if (!el) return;
  el.style.transition = animate ? 'transform 240ms var(--ease-emph)' : 'none';
  el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;
};

type PageProps = {
  item: ViewerItem;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onTap: () => void;
  onDismissDrag: (dy: number, done: boolean) => void;
  stageRef?: (el: HTMLDivElement | null) => void;
  fallbackUrl: string | undefined;
};

const ImagePage = ({
  item,
  active,
  onZoomChange,
  onTap,
  onDismissDrag,
  stageRef,
  fallbackUrl,
}: PageProps) => {
  const stage = useRef<HTMLDivElement | null>(null);
  const t = useRef<Transform>({ ...IDENTITY });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    kind: 'none' | 'pan' | 'pinch' | 'dismiss';
    startDist: number;
    startScale: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    kind: 'none',
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });
  const lastTap = useRef(0);
  const tapTimer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isZoomed, setIsZoomed] = useState(false);

  const setTransform = useCallback(
    (next: Transform, animate = false) => {
      const el = stage.current;
      const bounds = el?.getBoundingClientRect();
      const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
      let { x, y } = next;
      if (el && bounds) {
        const w = el.clientWidth;
        const h = el.clientHeight;
        const maxX = (w * (scale - 1)) / 2;
        const maxY = (h * (scale - 1)) / 2;
        x = Math.min(maxX, Math.max(-maxX, x));
        y = Math.min(maxY, Math.max(-maxY, y));
      }
      if (scale === 1) {
        x = 0;
        y = 0;
      }
      const wasZoomed = t.current.scale > 1.01;
      t.current = { scale, x, y };
      apply(stage.current, t.current, animate);
      const zoomed = scale > 1.01;
      if (zoomed !== wasZoomed) {
        setIsZoomed(zoomed);
        onZoomChange(zoomed);
      }
    },
    [onZoomChange]
  );

  useEffect(() => {
    if (!active && t.current.scale !== 1) setTransform(IDENTITY);
  }, [active, setTransform]);

  const zoomAt = (clientX: number, clientY: number, scale: number) => {
    const el = stage.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = clientX - (rect.left + rect.width / 2);
    const cy = clientY - (rect.top + rect.height / 2);
    const current = t.current;
    const ratio = scale / current.scale;
    setTransform(
      {
        scale,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      },
      true
    );
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      g.kind = 'pinch';
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.startScale = t.current.scale;
      g.originX = (a.x + b.x) / 2;
      g.originY = (a.y + b.y) / 2;
      g.moved = true;
    } else {
      g.kind = 'none';
      g.startX = event.clientX;
      g.startY = event.clientY;
      g.originX = t.current.x;
      g.originY = t.current.y;
      g.moved = false;
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const g = gesture.current;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(
        MAX_SCALE * 1.2,
        Math.max(0.8, (g.startScale * dist) / g.startDist)
      );
      const el = stage.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = g.originX - (rect.left + rect.width / 2);
      const cy = g.originY - (rect.top + rect.height / 2);
      const ratio = scale / t.current.scale;
      t.current = {
        scale,
        x: cx - (cx - t.current.x) * ratio,
        y: cy - (cy - t.current.y) * ratio,
      };
      apply(stage.current, t.current);
      return;
    }
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 8) {
      g.moved = true;
      if (t.current.scale > 1.01) g.kind = 'pan';
      else if (Math.abs(dy) > Math.abs(dx)) g.kind = 'dismiss';
    }
    if (g.kind === 'pan') {
      t.current = { ...t.current, x: g.originX + dx, y: g.originY + dy };
      apply(stage.current, t.current);
    } else if (g.kind === 'dismiss') {
      apply(stage.current, {
        scale: 1 - Math.min(0.25, Math.abs(dy) / 1600),
        x: 0,
        y: dy,
      });
      onDismissDrag(dy, false);
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) {
        g.kind = 'none';
        setTransform(t.current, true);
      }
      return;
    }
    if (g.kind === 'pan') {
      g.kind = 'none';
      setTransform(t.current, true);
      return;
    }
    if (g.kind === 'dismiss') {
      g.kind = 'none';
      const dy = event.clientY - g.startY;
      if (Math.abs(dy) > 110) {
        onDismissDrag(dy, true);
      } else {
        apply(stage.current, IDENTITY, true);
        onDismissDrag(0, false);
      }
      return;
    }
    if (!g.moved) {
      const now = event.timeStamp;
      if (now - lastTap.current < 280) {
        window.clearTimeout(tapTimer.current);
        lastTap.current = 0;
        if (t.current.scale > 1.01) setTransform(IDENTITY, true);
        else zoomAt(event.clientX, event.clientY, 2.6);
      } else {
        lastTap.current = now;
        tapTimer.current = window.setTimeout(onTap, 290);
      }
    }
  };

  const onPointerCancel = (event: ReactPointerEvent) => {
    // The browser claimed the gesture (e.g. a horizontal page swipe).
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.kind === 'dismiss') {
      apply(stage.current, IDENTITY, true);
      onDismissDrag(0, false);
    } else if (g.kind === 'pinch' || g.kind === 'pan') {
      setTransform(t.current, true);
    }
    g.kind = 'none';
    g.moved = true;
  };

  const onWheel = (event: ReactWheelEvent) => {
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return;
    const next = t.current.scale * (event.deltaY < 0 ? 1.18 : 1 / 1.18);
    zoomAt(
      event.clientX,
      event.clientY,
      Math.min(MAX_SCALE, Math.max(1, next))
    );
  };

  return (
    <div
      className="viewer-stage"
      ref={(el) => {
        stage.current = el;
        stageRef?.(el);
      }}
      style={{ touchAction: isZoomed ? 'none' : 'pan-x' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
    >
      {item.kind === 'image' && state !== 'error' ? (
        <img
          src={item.url}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      ) : null}
      {state === 'loading' ? <div className="spinner" /> : null}
      {state === 'error' ? (
        <div className="viewer-error">
          <Icon name="image" size={36} />
          <span>This image can't be shown here.</span>
          {fallbackUrl ? (
            <button
              type="button"
              className="btn"
              onClick={() => openUrl(fallbackUrl)}
            >
              <Icon name="external" /> Open original
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const VideoPage = ({
  item,
  active,
  stageRef,
  fallbackUrl,
}: {
  item: Extract<ViewerItem, { kind: 'video' }>;
  active: boolean;
  stageRef?: (el: HTMLDivElement | null) => void;
  fallbackUrl: string | undefined;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const nativeHls = (() => {
    try {
      return (
        document
          .createElement('video')
          .canPlayType('application/vnd.apple.mpegurl') !== ''
      );
    } catch {
      return false;
    }
  })();
  const src =
    nativeHls && item.hls && !item.isGif
      ? item.hls
      : (item.mp4 ?? (nativeHls ? item.hls : undefined));

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) void video.play().catch(() => undefined);
    else video.pause();
  }, [active]);

  return (
    <div className="viewer-stage" ref={stageRef}>
      {src && !failed ? (
        <video
          ref={ref}
          src={src}
          poster={item.poster}
          controls={!item.isGif}
          muted={item.isGif}
          loop={item.isGif}
          autoPlay={active}
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
          style={{ aspectRatio: `${item.width} / ${item.height}` }}
        />
      ) : (
        <div className="viewer-error">
          <Icon name="play" size={36} />
          <span>This video can't be played here.</span>
          {fallbackUrl ? (
            <button
              type="button"
              className="btn"
              onClick={() => openUrl(fallbackUrl)}
            >
              <Icon name="external" /> Watch on Reddit
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

type MediaViewerProps = { spec: ViewerSpec; onClosed: () => void };

export const MediaViewer = ({ spec, onClosed }: MediaViewerProps) => {
  const [index, setIndex] = useState(spec.index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [closing, setClosing] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const firstStage = useRef<HTMLDivElement | null>(null);
  const many = spec.items.length > 1;
  const source = spec.permalink ? redditUrl(spec.permalink) : spec.sourceUrl;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const stage =
      track.current?.children[index]?.querySelector<HTMLElement>(
        '.viewer-stage'
      );
    stage?.animate(
      [
        { opacity: 1 },
        { opacity: 0, transform: `${stage.style.transform || ''} scale(0.94)` },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(0.3,0,0.8,0.15)',
        fill: 'forwards',
      }
    );
    window.setTimeout(onClosed, 190);
  }, [closing, index, onClosed]);

  // Start on the requested page and play the shared-element zoom.
  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = spec.index * el.clientWidth;
    const stage = firstStage.current;
    const origin = spec.origin;
    if (
      !stage ||
      !origin ||
      document.documentElement.dataset.motion === 'reduced'
    )
      return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dx = origin.left + origin.width / 2 - vw / 2;
    const dy = origin.top + origin.height / 2 - vh / 2;
    const scale = Math.max(0.15, Math.min(1, origin.width / vw));
    stage.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          opacity: 0.4,
        },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    );
  }, [spec]);

  const count = spec.items.length;
  const go = useCallback(
    (next: number) => {
      const el = track.current;
      if (!el || next < 0 || next >= count) return;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    },
    [count]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') go(index + 1);
      if (event.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, go, index]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (next !== index) setIndex(next);
  };

  const onDismissDrag = useCallback(
    (dy: number, done: boolean) => {
      if (bg.current)
        bg.current.style.opacity = String(
          Math.max(0.15, 1 - Math.abs(dy) / 500)
        );
      if (done) close();
    },
    [close]
  );

  const current = spec.items[index];

  return (
    <div
      className={`viewer${closing ? ' is-closing' : ''}${chrome ? '' : ' is-chrome-hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <div className="viewer-bg" ref={bg} />
      <div
        className={`viewer-track${zoomed ? ' is-locked' : ''}`}
        ref={track}
        onScroll={onScroll}
        style={{ touchAction: zoomed ? 'none' : 'pan-x' }}
      >
        {spec.items.map((item, i) => (
          <div
            className="viewer-page"
            key={`${i}-${item.kind === 'image' ? item.url : (item.mp4 ?? item.hls)}`}
          >
            {item.kind === 'image' ? (
              <ImagePage
                item={item}
                active={i === index}
                onZoomChange={setZoomed}
                onTap={() => setChrome((value) => !value)}
                onDismissDrag={onDismissDrag}
                fallbackUrl={item.url}
                {...(i === spec.index
                  ? {
                      stageRef: (el: HTMLDivElement | null) =>
                        (firstStage.current = el),
                    }
                  : {})}
              />
            ) : (
              <VideoPage
                item={item}
                active={i === index}
                fallbackUrl={source}
                {...(i === spec.index
                  ? {
                      stageRef: (el: HTMLDivElement | null) =>
                        (firstStage.current = el),
                    }
                  : {})}
              />
            )}
          </div>
        ))}
      </div>

      <div className="viewer-top viewer-chrome">
        <button
          type="button"
          className="icon-btn"
          aria-label="Close viewer"
          onClick={close}
        >
          <Icon name="close" />
        </button>
        <span className="title">{spec.title ?? ''}</span>
        {many ? (
          <span className="counter">
            {index + 1} / {spec.items.length}
          </span>
        ) : null}
        {current?.kind === 'image' ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy image link"
            onClick={() => void copyText(current.url, 'Image link copied')}
          >
            <Icon name="copy" />
          </button>
        ) : null}
        {source ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Open on Reddit"
            onClick={() => openUrl(source)}
          >
            <Icon name="external" />
          </button>
        ) : null}
      </div>

      {many ? (
        <div className="viewer-strip viewer-chrome" data-no-swipe>
          {spec.items.map((item, i) => (
            <button
              key={i}
              type="button"
              className={i === index ? 'is-current' : ''}
              aria-label={`Show item ${i + 1}`}
              onClick={() => go(i)}
            >
              {item.kind === 'image' ? (
                <img src={item.url} alt="" loading="lazy" decoding="async" />
              ) : (
                <Icon name="play" />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
