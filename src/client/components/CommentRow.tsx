import { memo, type CSSProperties } from 'react';
import type { CommentNode } from '../../shared/api';
import { age, compact, fullDate } from '../lib/format';
import { useLongPress } from '../lib/gestures';
import { Markdown } from '../lib/markdown';
import { Icon } from './Icon';
import { FlairChip } from './PostParts';
import { VoteLinks, useVoteToggle } from './VoteLinks';
import { SwipeActions, type SwipeAction } from './SwipeActions';
import { useNav } from '../app/nav';
import { useAccount } from '../lib/account';

const MAX_VISUAL_DEPTH = 10;

const depthColor = (depth: number) => `var(--d${((depth - 1) % 7) + 1})`;

/** Faint guide lines for every ancestor level, drawn as background layers. */
const guidesFor = (depth: number): string | undefined => {
  if (depth < 2) return undefined;
  const layers: string[] = [];
  for (let level = 1; level < depth; level++) {
    const x = 10 + (level - 1) * 12 + 1;
    const color = `color-mix(in srgb, ${depthColor(level)} 40%, transparent)`;
    layers.push(
      `linear-gradient(${color}, ${color}) ${x}px 0 / 1px 100% no-repeat`
    );
  }
  return layers.join(', ');
};

export const visualDepth = (depth: number) => Math.min(depth, MAX_VISUAL_DEPTH);

/** Thread-level handlers for a comment's swipe actions (stable callbacks). */
export type CommentSwipe = {
  reply?: (node: CommentNode) => void;
  parent: (node: CommentNode) => void;
  edit: (node: CommentNode) => void;
  moderate: (node: CommentNode) => void;
};

type CommentRowProps = {
  node: CommentNode;
  depth: number;
  collapsed: boolean;
  hiddenCount: number;
  /** The comment a context link points at; stays highlighted. */
  focused?: boolean;
  onToggle: (id: string) => void;
  onActions: (node: CommentNode) => void;
  swipe?: CommentSwipe | undefined;
  /** An archived thread Reddit no longer shows: no voting, replying or editing. */
  readOnly?: boolean;
};

export const CommentRow = memo(
  ({
    node,
    depth,
    collapsed,
    hiddenCount,
    focused,
    onToggle,
    onActions,
    swipe,
    readOnly,
  }: CommentRowProps) => {
    const nav = useNav();
    const account = useAccount();
    const vote = useVoteToggle(node.id, node.vote, node.score);
    const own = account?.name.toLowerCase() === node.author.toLowerCase();
    const live = !readOnly;
    // Relay's comment swipe actions: Up, Down, User, Edit, Reply, Parent, Mod, More.
    const actions: SwipeAction[] = [
      ...(live
        ? [
            { icon: 'up', label: 'Up', title: 'Upvote', tone: 'up', active: vote.current === 1, disabled: vote.pending, onClick: () => vote.cast(1) } satisfies SwipeAction,
            { icon: 'down', label: 'Down', title: 'Downvote', tone: 'down', active: vote.current === -1, disabled: vote.pending, onClick: () => vote.cast(-1) } satisfies SwipeAction,
          ]
        : []),
      ...(/^[\w-]{3,20}$/.test(node.author)
        ? [{ icon: 'user', label: 'User', title: `Go to u/${node.author}`, onClick: () => nav.openProfile(node.author) } satisfies SwipeAction]
        : []),
      ...(live && own && swipe ? [{ icon: 'edit', label: 'Edit', title: 'Edit comment', onClick: () => swipe.edit(node) } satisfies SwipeAction] : []),
      ...(live && swipe?.reply ? [{ icon: 'reply', label: 'Reply', onClick: () => swipe.reply!(node) } satisfies SwipeAction] : []),
      ...(swipe && node.parentId.startsWith('t1_')
        ? [{ icon: 'comment', label: 'Parent', title: 'Go to parent comment', onClick: () => swipe.parent(node) } satisfies SwipeAction]
        : []),
      ...(live && account?.isMod && swipe ? [{ icon: 'modShield', label: 'Mod', title: 'Moderate', onClick: () => swipe.moderate(node) } satisfies SwipeAction] : []),
      { icon: 'more', label: 'More', title: 'More actions', onClick: () => onActions(node) },
    ];
    const press = useLongPress(() => onActions(node));
    // Like Relay, collapsing hides only the replies; the comment stays whole.
    const collapsible = node.replies.length > 0 || node.moreReplies;
    const d = visualDepth(depth);
    const style = {
      '--depth': d,
      '--rail': d > 0 ? depthColor(d) : 'transparent',
    } as CSSProperties & Record<string, string | number | undefined>;
    const guides = guidesFor(d);
    const authorClass = [
      'author',
      node.isSubmitter ? 'is-op' : '',
      node.distinguished === 'moderator' ? 'is-mod' : '',
      node.distinguished === 'admin' ? 'is-admin' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <SwipeActions actions={actions}>
      <div
        className={`comment${collapsed ? ' is-collapsed' : ''}${focused ? ' is-context' : ''}`}
        data-depth={d}
        data-level={depth}
        data-cid={node.id}
        data-anim-key={node.id}
        style={style}
        role="article"
        aria-expanded={collapsible ? !collapsed : undefined}
        aria-label={`Comment by ${node.author}${collapsed ? ', replies collapsed' : ''}`}
        tabIndex={0}
        onClick={(event) => {
          if (press.consumeClick()) return;
          if ((event.target as Element).closest('a, button, .md-spoiler'))
            return;
          if (window.getSelection()?.toString()) return;
          if (collapsible) onToggle(node.id);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            event.target === event.currentTarget &&
            collapsible
          )
            onToggle(node.id);
        }}
        {...press.handlers}
      >
        {guides ? (
          <span
            className="comment-guides"
            style={{
              inset: 0,
              right: 'auto',
              width: '100%',
              background: guides,
            }}
          />
        ) : null}
        {d > 0 ? <span className="comment-rail" /> : null}
        <div className="comment-head">
          <span className={authorClass}>{node.author}</span>
          {node.isSubmitter ? <span className="badge">OP</span> : null}
          {node.distinguished === 'moderator' ? (
            <span className="badge mod">MOD</span>
          ) : null}
          {node.archive === 'restored' ? (
            <span className="badge archive" title="Restored from the archive">ARCHIVE</span>
          ) : null}
          {node.authorFlair ? <FlairChip flair={node.authorFlair} /> : null}
          {live ? (
            <VoteLinks
              thingId={node.id}
              permalink={node.permalink}
              score={node.score}
              vote={node.vote}
              kind="comment"
              variant="inline"
            />
          ) : (
            <span className="vote vote-inline" title="Score when archived">
              <span className="vote-score">{compact(node.score)}</span>
            </span>
          )}
          <time
            dateTime={new Date(node.createdAt).toISOString()}
            title={fullDate(node.createdAt)}
          >
            {age(node.createdAt)}
            {node.edited ? '*' : ''}
          </time>
          {node.stickied ? <Icon name="pin" className="pinned" /> : null}
          {node.locked ? <Icon name="lock" /> : null}
          <span className="grow" />
          {collapsed ? (
            <span
              className="collapsed-count"
              title={`${hiddenCount || 'More'} hidden ${hiddenCount === 1 ? 'reply' : 'replies'}`}
            >
              +{hiddenCount || '…'}
            </span>
          ) : null}
          <button
            type="button"
            className="comment-more"
            aria-label="Comment actions"
            onClick={(event) => {
              event.stopPropagation();
              onActions(node);
            }}
          >
            <Icon name="more" />
          </button>
        </div>
        <div className="comment-body">
          {node.removed ? (
            <p className="comment-removed">
              {node.removed === 'author' ? 'Deleted by its author' : '[removed]'}
              {node.archive === 'missing' ? (
                <span className="archive-missing">Not in the archive</span>
              ) : null}
            </p>
          ) : (
            <Markdown source={node.body} media={node.media} />
          )}
        </div>
      </div>
      </SwipeActions>
    );
  }
);
CommentRow.displayName = 'CommentRow';

type MoreRowProps = {
  animKey: string;
  depth: number;
  label: string;
  loading: boolean;
  onClick: () => void;
  root?: boolean;
};

export const MoreRow = ({
  animKey,
  depth,
  label,
  loading,
  onClick,
  root,
}: MoreRowProps) => {
  const d = visualDepth(depth);
  const guides = guidesFor(d + 1);
  return (
    <button
      type="button"
      className={`more-row${root ? ' is-root' : ''}`}
      data-ripple
      data-anim-key={animKey}
      data-level={root ? 0 : depth}
      style={{
        ['--depth' as string]: d,
        ...(guides && !root ? { background: `${guides}, var(--surface)` } : {}),
      }}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? (
        <span className="spinner" style={{ width: 18, height: 18 }} />
      ) : (
        <Icon name={root ? 'down' : 'thread'} />
      )}
      {loading ? 'Loading…' : label}
    </button>
  );
};
