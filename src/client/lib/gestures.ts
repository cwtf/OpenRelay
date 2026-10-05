import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const NO_SWIPE =
  '[data-no-swipe], .md-pre, .md-table-wrap, input, textarea, select, video, .sort-strip, .viewer';

type SwipeBackOptions = {
  enabled: boolean;
  /** Drag progress 0..1; `settling` is true once the finger lifts. */
  onProgress?: (progress: number, settling: boolean) => void;
  onCommit: () => void;
};

/**
 * Horizontal drag-to-go-back for stacked screens. Vertical scrolling keeps
 * working because screens use `touch-action: pan-y`; the browser cancels the
 * pointer stream as soon as it claims a vertical pan.
 */
export const useSwipeBack = (
  ref: RefObject<HTMLElement | null>,
  { enabled, onProgress, onCommit }: SwipeBackOptions
): void => {
  const handlers = useRef({ onProgress, onCommit });
  useLayoutEffect(() => {
    handlers.current = { onProgress, onCommit };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let tracking = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;

    const settle = (commit: boolean) => {
      const width = el.clientWidth;
      el.classList.remove('is-dragging');
      el.style.transition = `transform ${commit ? 'var(--dur-screen-out) var(--ease-out)' : 'var(--dur-short) var(--ease-emph)'}`;
      el.style.transform = commit
        ? `translateX(${width}px)`
        : 'translateX(0px)';
      handlers.current.onProgress?.(commit ? 1 : 0, true);
      window.setTimeout(() => {
        el.style.transition = '';
        if (commit) {
          handlers.current.onCommit();
        } else {
          el.style.transform = '';
        }
      }, 260);
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      const target = event.target as Element | null;
      if (target?.closest(NO_SWIPE)) return;
      tracking = true;
      dragging = false;
      startX = lastX = event.clientX;
      startY = event.clientY;
      lastT = event.timeStamp;
      velocity = 0;
    };

    const onMove = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          return;
        }
        if (dx > 14 && dx > Math.abs(dy) * 1.6) {
          dragging = true;
          el.classList.add('is-dragging');
          try {
            el.setPointerCapture(event.pointerId);
          } catch {
            // Capture is best-effort.
          }
        } else {
          return;
        }
      }
      const x = Math.max(0, dx);
      const dt = event.timeStamp - lastT || 1;
      velocity = (event.clientX - lastX) / dt;
      lastX = event.clientX;
      lastT = event.timeStamp;
      el.style.transform = `translateX(${x}px)`;
      handlers.current.onProgress?.(Math.min(1, x / el.clientWidth), false);
    };

    const onUp = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      const dx = event.clientX - startX;
      settle(dx > el.clientWidth * 0.32 || (velocity > 0.45 && dx > 40));
    };

    const onCancel = () => {
      if (dragging) settle(false);
      tracking = false;
      dragging = false;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [ref, enabled]);
};

/**
 * Long-press detection that cooperates with click handlers: when the long
 * press fires, the following click is swallowed.
 */
export const useLongPress = (
  onLongPress: (() => void) | undefined,
  delay = 460
) => {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const watcher = useRef<((event: PointerEvent) => void) | null>(null);

  const clear = () => {
    window.clearTimeout(timer.current);
    if (watcher.current) {
      window.removeEventListener('pointermove', watcher.current, true);
      watcher.current = null;
    }
  };

  const handlers = {
    onPointerDown: (event: ReactPointerEvent) => {
      if (!onLongPress || event.button !== 0) return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      clear();
      // Track movement window-wide: a swipe may capture the pointer on an
      // ancestor, and this element would then never see the drag.
      watcher.current = (move: PointerEvent) => {
        if (
          Math.abs(move.clientX - origin.current.x) > 8 ||
          Math.abs(move.clientY - origin.current.y) > 8
        )
          clear();
      };
      window.addEventListener('pointermove', watcher.current, true);
      timer.current = window.setTimeout(() => {
        clear();
        fired.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          // Optional.
        }
        onLongPress();
      }, delay);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (
        Math.abs(event.clientX - origin.current.x) > 8 ||
        Math.abs(event.clientY - origin.current.y) > 8
      ) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (event: ReactMouseEvent) => {
      if (!onLongPress) return;
      event.preventDefault();
      if (!fired.current) {
        clear();
        fired.current = true;
        onLongPress();
      }
    },
  };

  /** Call at the top of click handlers; returns true if the click should be ignored. */
  const consumeClick = (): boolean => {
    if (fired.current) {
      fired.current = false;
      return true;
    }
    return false;
  };

  return { handlers, consumeClick };
};
