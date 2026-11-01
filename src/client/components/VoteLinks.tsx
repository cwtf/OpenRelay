import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  /** `pill`: the post page's capsule, arrows around a score ring, labelled. */
  variant: "stat" | "inline" | "pill";
};

const pillLabel: Record<Vote, string> = { 1: "Liked", 0: "Like it", [-1]: "Disliked" };
/** The pill's label while letting go would cast a vote, by the vote it would leave. */
const armedLabel: Record<Vote, string> = { 1: "Upvote", 0: "Undo", [-1]: "Downvote" };

/** From the score ring's centre to an arrow's: half the 46px ring plus half a 30px arrow. */
const REACH = 38;
/** The share of REACH past which letting go casts the vote. */
const COMMIT = 0.7;

/**
 * Drag the pill's score ring toward an arrow to vote that way. The ring's
 * border blends from the current vote's colour to the one letting go would
 * give, through `--drag` (0..1) and `data-drag-to` on the pill; reader.css
 * does the colours. The ring keeps the new colour until the vote settles.
 */
const useDragVote = (
  current: Vote,
  pending: boolean,
  enabled: boolean,
  cast: (direction: Vote) => void,
) => {
  const root = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; x: number; dx: number } | null>(null);
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
    el.style.removeProperty("--drag");
  }, [holding, pending]);

  const show = (dx: number, keepColour = false) => {
    const el = root.current;
    if (!el) return;
    const distance = Math.abs(dx);
    // Past the arrow the ring only stretches a little further.
    const x = distance > REACH ? Math.sign(dx) * (REACH + (distance - REACH) * 0.2) : dx;
    el.style.setProperty("--drag-x", `${x}px`);
    if (keepColour) {
      delete el.dataset.drag;
      el.style.setProperty("--drag", "1");
      return;
    }
    const direction: Vote = dx < 0 ? 1 : dx > 0 ? -1 : 0;
    const progress = Math.min(1, distance / REACH);
    if (direction) {
      const target: Vote = current === direction ? 0 : direction;
      el.dataset.drag = String(direction);
      el.dataset.dragTo = String(target);
      el.style.setProperty("--drag", String(progress));
      setArmed(progress >= COMMIT ? target : null);
    } else {
      delete el.dataset.drag;
      delete el.dataset.dragTo;
      el.style.removeProperty("--drag");
      setArmed(null);
    }
  };

  const finish = (event: ReactPointerEvent, commit: boolean) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (root.current) delete root.current.dataset.dragging;
    const direction: Vote = state.dx < 0 ? 1 : -1;
    if (commit && Math.abs(state.dx) / REACH >= COMMIT) {
      show(0, true);
      setArmed(null);
      setHolding(true);
      cast(direction);
    } else {
      show(0);
    }
  };

  const handlers = enabled
    ? {
        onPointerDown: (event: ReactPointerEvent) => {
          if (event.button !== 0 || !event.isPrimary || pending || holding) return;
          drag.current = { id: event.pointerId, x: event.clientX, dx: 0 };
          // A data attribute, not a class: React rewrites className when `armed` changes.
          if (root.current) root.current.dataset.dragging = "";
          try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          } catch {
            // Capture is best-effort.
          }
        },
        onPointerMove: (event: ReactPointerEvent) => {
          const state = drag.current;
          if (!state || state.id !== event.pointerId) return;
          state.dx = event.clientX - state.x;
          show(state.dx);
        },
        onPointerUp: (event: ReactPointerEvent) => finish(event, true),
        onPointerCancel: (event: ReactPointerEvent) => finish(event, false),
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
  const dragVote = useDragVote(
    current,
    state.pending,
    variant === "pill" && !lemmy && !state.fallback,
    (direction) => void castVote(thingId, direction, current, shown),
  );
  const text = compact(shown);
  const scoreEl = (
    <span
      className={`vote-score${text.length > 3 ? " is-long" : ""}`}
      data-no-swipe={variant === "pill" || undefined}
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
      {variant === "pill" ? (
        <span className="vote-capsule">
          {arrow(1)}
          {scoreEl}
          {arrow(-1)}
        </span>
      ) : (
        <>
          {arrow(1)}
          {scoreEl}
          {arrow(-1)}
        </>
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
