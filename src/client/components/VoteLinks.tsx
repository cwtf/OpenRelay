import { pageUrl } from "../../extension/bridge";
import { compact } from "../lib/format";
import { redditUrl } from "../lib/platform";
import { castVote, useVote } from "../lib/votes";
import type { Vote } from "../../extension/votes";
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
  const arrow = (direction: Vote) => {
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
  const text = compact(shown);
  const scoreEl = (
    <span className={`vote-score${text.length > 3 ? " is-long" : ""}`}>{text}</span>
  );
  return (
    <span
      className={`vote vote-${variant}`}
      data-thing-id={thingId}
      data-vote={current}
      aria-busy={state.pending}
      title={state.error || "Vote with your Reddit account"}
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
          {pillLabel[current]}
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
