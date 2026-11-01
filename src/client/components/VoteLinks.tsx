import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { pageUrl } from "../../extension/bridge";
import { compact } from "../lib/format";
import { redditUrl } from "../lib/platform";
import { castVote, useVote } from "../lib/votes";
import { isLemmyItem } from "../lib/hybrid";
import { LEMMY_ONLY } from "../lib/api";
import type { Vote } from "../../providers/reddit/votes";
import { Icon } from "./Icon";

/** Current vote and a caster, shared by the arrows and swipe actions. */
export const useVoteToggle = (thingId: string, vote: Vote | undefined, score: number) => {
  const state = useVote(thingId);
  const current: Vote = state.vote ?? vote ?? 0;
  const shown = state.score ?? score;
  return {
    current,
    pending: state.pending,
    cast: (direction: Vote) => void castVote(thingId, direction, current, shown),
  };
};

type VoteLinksProps = {
  thingId: string;
  permalink: string;
  score: number;
  /** The viewer's vote as reported by Reddit, if known. */
  vote?: Vote | undefined;
  kind: "post" | "comment";
  /**
   * Each is a capsule of arrows around a draggable score ring, by size: `stat`
   * for the card layout's stats row, `inline` for compact/list rows and
   * comments, `pill` for the post page's, which is labelled.
   */
  variant: "stat" | "inline" | "pill";
};

const pillLabel: Record<Vote, string> = { 1: "Liked", 0: "Like it", [-1]: "Disliked" };
/** The pill's label while letting go would cast a vote, by the vote it would leave. */
const armedLabel: Record<Vote, string> = { 1: "Upvote", 0: "Undo", [-1]: "Downvote" };

/** The share of the way to an arrow past which letting go casts the vote. */
const COMMIT = 0.7;

/**
 * Drag a vote control's score ring toward an arrow to vote that way. On the
 * control it sets `--drag` (0..1 of the way to the arrow), `--blend` (0..1,
 * full once letting go would vote), `--drag-x`, `data-drag` (the arrow's
 * direction) and `data-drag-to` (the vote letting go would leave); reader.css
 * does the rest. The ring keeps the new colour until the vote settles.
 */
const useDragVote = (
  current: Vote,
  pending: boolean,
  enabled: boolean,
  cast: (direction: Vote) => void,
) => {
  const root = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; x: number; dx: number; reach: number } | null>(null);
  const swallowClick = useRef(false);
  const [armed, setArmed] = useState<Vote | null>(null);
  const [holding, setHolding] = useState(false);

  // castVote marks the vote pending before this renders again, so `holding`
  // ends only once Reddit has answered; a failed vote blends back.
  useEffect(() => {
    if (!holding || pending) return;
    setHolding(false);
    const el = root.current;
    if (!el) return;
    delete el.dataset.dragTo;
    el.style.removeProperty("--blend");
  }, [holding, pending]);

  const arm = (next: Vote | null) => {
    setArmed((was) => {
      if (next !== null && was !== next) {
        try {
          navigator.vibrate?.(10);
        } catch {
          // Optional.
        }
      }
      return next;
    });
  };

  const show = (dx: number, reach: number, keepColour = false) => {
    const el = root.current;
    if (!el) return;
    const distance = Math.abs(dx);
    // Past the arrow the ring only stretches a little further.
    const x = distance > reach ? Math.sign(dx) * (reach + (distance - reach) * 0.2) : dx;
    el.style.setProperty("--drag-x", `${x}px`);
    const direction: Vote = dx < 0 ? 1 : dx > 0 ? -1 : 0;
    if (keepColour || !direction) {
      delete el.dataset.drag;
      el.style.removeProperty("--drag");
      if (keepColour) {
        el.style.setProperty("--blend", "1");
      } else {
        delete el.dataset.dragTo;
        el.style.removeProperty("--blend");
        arm(null);
      }
      return;
    }
    const progress = Math.min(1, distance / reach);
    const target: Vote = current === direction ? 0 : direction;
    el.dataset.drag = String(direction);
    el.dataset.dragTo = String(target);
    el.style.setProperty("--drag", String(progress));
    el.style.setProperty("--blend", String(Math.min(1, progress / COMMIT)));
    arm(progress >= COMMIT ? target : null);
  };

  const finish = (event: ReactPointerEvent, commit: boolean) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (root.current) delete root.current.dataset.dragging;
    if (Math.abs(state.dx) > 4) {
      // A drag, not a tap: the click it may produce mustn't open the post or
      // collapse the comment around the ring.
      swallowClick.current = true;
      window.setTimeout(() => (swallowClick.current = false), 80);
    }
    if (commit && Math.abs(state.dx) / state.reach >= COMMIT) {
      show(0, state.reach, true);
      setArmed(null);
      setHolding(true);
      cast(state.dx < 0 ? 1 : -1);
    } else {
      show(0, state.reach);
    }
  };

  const handlers = enabled
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.button !== 0 || !event.isPrimary || pending || holding) return;
          const ring = event.currentTarget;
          const arrow = ring.previousElementSibling as HTMLElement | null;
          // From the ring's centre to the up arrow's; the arrows match.
          const reach = ((arrow?.offsetWidth ?? 0) + ring.offsetWidth) / 2;
          drag.current = { id: event.pointerId, x: event.clientX, dx: 0, reach };
          // A data attribute, not a class: React rewrites className when `armed` changes.
          if (root.current) root.current.dataset.dragging = "";
          try {
            ring.setPointerCapture(event.pointerId);
          } catch {
            // Capture is best-effort.
          }
        },
        onPointerMove: (event: ReactPointerEvent) => {
          const state = drag.current;
          if (!state || state.id !== event.pointerId) return;
          state.dx = event.clientX - state.x;
          show(state.dx, state.reach);
        },
        onPointerUp: (event: ReactPointerEvent) => finish(event, true),
        onPointerCancel: (event: ReactPointerEvent) => finish(event, false),
        onClickCapture: (event: ReactMouseEvent) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.stopPropagation();
          event.preventDefault();
        },
      }
    : {};

  return { root, armed, handlers };
};

export const VoteLinks = ({
  thingId,
  permalink,
  score,
  vote,
  kind,
  variant,
}: VoteLinksProps) => {
  const state = useVote(thingId);
  const current: Vote = state.vote ?? vote ?? 0;
  const shown = state.score ?? score;
  const href = new URL(redditUrl(permalink) || pageUrl.href);
  href.searchParams.set("openrelay", "off");
  // The hybrid feed's Lemmy posts show their score; they're voted on there.
  const lemmy = isLemmyItem(thingId);
  const arrow = (direction: Vote) => {
    if (lemmy) return null;
    const label = direction === 1 ? "Upvote" : "Downvote";
    const selected = current === direction;
    return (
      <button
        type="button"
        className={`vote-btn is-${direction === 1 ? "up" : "down"}${selected ? " is-selected" : ""}`}
        aria-label={`${selected ? "Undo " + label.toLowerCase() : label} this ${kind}`}
        aria-pressed={selected}
        disabled={state.pending}
        data-ripple
        onClick={(event) => {
          event.stopPropagation();
          void castVote(thingId, direction, current, shown);
        }}
      >
        <Icon name={direction === 1 ? "up" : "down"} />
      </button>
    );
  };
  const draggable = !lemmy && !state.fallback;
  const dragVote = useDragVote(
    current,
    state.pending,
    draggable,
    (direction) => void castVote(thingId, direction, current, shown),
  );
  const text = compact(shown);
  const scoreEl = (
    <span
      // is-interactive: feed rows otherwise let presses through to the post.
      className={`vote-score${text.length > 3 ? " is-long" : ""}${draggable ? " is-interactive" : ""}`}
      data-no-swipe={draggable || undefined}
      {...dragVote.handlers}
    >
      {text}
    </span>
  );
  const armed = dragVote.armed;
  return (
    <span
      ref={dragVote.root}
      className={`vote vote-${variant}${lemmy ? " is-score-only" : ""}${armed !== null ? " is-armed" : ""}`}
      data-thing-id={thingId}
      data-vote={current}
      aria-busy={state.pending}
      title={state.error || (lemmy ? LEMMY_ONLY : "Vote with your Reddit account")}
    >
      {lemmy ? (
        scoreEl
      ) : (
        <span className="vote-capsule">
          {arrow(1)}
          {scoreEl}
          {arrow(-1)}
        </span>
      )}
      {variant === "pill" && !state.fallback ? (
        <span className="vote-label" aria-hidden="true">
          {armed !== null ? armedLabel[armed] : pillLabel[current]}
        </span>
      ) : null}
      {state.fallback ? (
        <a
          className="vote-fallback"
          href={href.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Vote on Reddit: ${kind}`}
        >
          Vote on Reddit
        </a>
      ) : null}
      {state.error ? (
        <span className="sr-only" role="status">
          {state.error}
        </span>
      ) : null}
    </span>
  );
};
