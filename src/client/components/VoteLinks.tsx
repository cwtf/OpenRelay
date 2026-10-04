import type { MouseEvent } from 'react';
import { compact } from '../lib/format';
import { openUrl, redditUrl } from '../lib/platform';
import { Icon } from './Icon';

type VoteLinksProps = {
  permalink: string;
  score: number;
  kind: 'post' | 'comment';
  variant: 'stat' | 'inline';
};

/**
 * Devvit apps can't vote on a user's behalf, so the vote arrows link to the
 * post or comment on Reddit, where the user can vote. They always open on
 * Reddit (never inside the reader), even for permalinks the reader could
 * otherwise show itself.
 */
export const VoteLinks = ({
  permalink,
  score,
  kind,
  variant,
}: VoteLinksProps) => {
  const href = redditUrl(permalink);
  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openUrl(href);
  };
  return (
    <span
      className={`vote vote-${variant}`}
      title={`${score.toLocaleString()} points · vote on Reddit`}
    >
      <a
        className="vote-btn is-up"
        href={href}
        data-ripple
        aria-label={`Upvote this ${kind} on Reddit`}
        onClick={open}
      >
        <Icon name="up" />
      </a>
      <span className="vote-score">{compact(score)}</span>
      <a
        className="vote-btn is-down"
        href={href}
        data-ripple
        aria-label={`Downvote this ${kind} on Reddit`}
        onClick={open}
      >
        <Icon name="down" />
      </a>
    </span>
  );
};
