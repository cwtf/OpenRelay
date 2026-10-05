// Relay's swipe layout: swipe a post or comment to the left (touch, mouse
// drag, or a sideways trackpad scroll) and it slides away to reveal a row of
// actions beneath it. Swiping right brings the card back to how it was. One
// card is open at a time; tapping the row's background, Escape or using an
// action also closes it.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Icon, type IconName } from "./Icon";

export type SwipeAction = {
  icon: IconName;
  label: string;
  /** Accessible description when the label is abbreviated ("Cmts"). */
  title?: string;
  onClick: () => void;
  /** Relay's activated colours: orange up, purple down, saved. */
  tone?: "up" | "down" | "saved";
  active?: boolean;
  disabled?: boolean;
};

/** Distance (px) a drag must travel before it is treated as a swipe. */
const SLOP = 10;
/** Fraction of the width past which a release opens or closes the row. */
const COMMIT = 0.22;

let closeOpen: (() => void) | null = null;

export const SwipeActions = ({
  actions,
  children,
}: {
  actions: SwipeAction[];
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    swiping: boolean;
  } | null>(null);
  const swallowClick = useRef(false);
  const wheel = useRef({ total: 0, at: 0 });

  const close = useCallback(() => setOpen(false), []);

  // Only one card shows its actions at a time.
  useEffect(() => {
    if (!open) return;
    if (closeOpen && closeOpen !== close) closeOpen();
    closeOpen = close;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (closeOpen === close) closeOpen = null;
    };
  }, [open, close]);

  const width = () => root.current?.clientWidth ?? 1;
  const place = (offset: number | null) => {
    const el = content.current;
    if (el) el.style.transform = offset === null ? "" : `translateX(${offset}px)`;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest("input, textarea, select, video, .md-pre, .md-table-wrap"))
      return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, swiping: false };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.swiping) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // A vertical scroll.
        return;
      }
      // Closed rows open with a leftward swipe; open rows close with a rightward one.
      const towards = open ? dx > SLOP : dx < -SLOP;
      if (!towards || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      state.swiping = true;
      setDragging(true);
      // Text selected by the drag would turn the next drag into a native
      // drag-and-drop of that text, which takes the pointer away.
      window.getSelection()?.removeAllRanges();
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort.
      }
    }
    event.stopPropagation();
    state.dx = dx;
    const base = open ? -width() : 0;
    place(Math.min(0, Math.max(-width(), base + dx)));
  };

  const finish = (event: ReactPointerEvent) => {
    const state = drag.current;
    drag.current = null;
    if (!state?.swiping) return;
    event.stopPropagation();
    // The drag was not a tap on the card: ignore the click it may produce,
    // but never a later, genuine one.
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 80);
    setDragging(false);
    place(null);
    const moved = Math.abs(state.dx) / width();
    setOpen(open ? moved < COMMIT : moved >= COMMIT);
  };

  // Trackpads: a sideways scroll to the left opens, to the right closes.
  const onWheel = (event: ReactWheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const now = event.timeStamp;
    if (now - wheel.current.at > 300) wheel.current.total = 0;
    wheel.current.at = now;
    wheel.current.total += event.deltaX;
    if (wheel.current.total > 60 && !open) {
      wheel.current.total = 0;
      setOpen(true);
    } else if (wheel.current.total < -60 && open) {
      wheel.current.total = 0;
      setOpen(false);
    }
  };

  return (
    <div
      ref={root}
      className={`swipe${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
      // While open, a rightward swipe closes the row instead of going back.
      {...(open || dragging ? { "data-no-swipe": "" } : {})}
      onWheel={onWheel}
      // On the row, not the card: once open, the card is off-screen and the
      // swipe back to the previous state starts on the actions.
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      // Native drag-and-drop of selected text or images would take over the
      // pointer mid-swipe; cards are never drag sources.
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {open || dragging ? (
        <div
          className="swipe-actions"
          role="toolbar"
          aria-label="Actions"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`swipe-btn${action.tone ? ` is-${action.tone}` : ""}${action.active ? " is-active" : ""}`}
              aria-label={action.title ?? action.label}
              aria-pressed={action.tone ? Boolean(action.active) : undefined}
              disabled={action.disabled}
              data-ripple
              onClick={() => {
                close();
                action.onClick();
              }}
            >
              <Icon name={action.icon} size={22} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={content}
        className="swipe-content"
        aria-hidden={open || undefined}
        inert={open || undefined}
      >
        {children}
      </div>
    </div>
  );
};
