import { memo, useSyncExternalStore } from 'react';
import type { Prefs, PostSummary } from '../../shared/api';
import { useNav } from '../app/nav';
import { usePrefs } from '../app/prefs';
import { compact, plural } from '../lib/format';
import { useLongPress } from '../lib/gestures';
import { useIsSelectedPost } from '../lib/panes';
import { readPosts } from '../lib/storage';
import { Icon } from './Icon';
import {
  MediaFrame,
  PostFlags,
  PostMeta,
  Thumb,
  wantsThumb,
} from './PostParts';
import { openPostActions } from './PostActions';
import { ModActionsSheet } from './Relay';
import { SwipeActions, type SwipeAction } from './SwipeActions';
import { VoteLinks, useVoteToggle } from './VoteLinks';
import { useAccount } from '../lib/account';
import { sharePost } from '../lib/platform';
import { toggleSaved, useSaved } from '../lib/saved';
import { site } from '../lib/api';
import { isLemmyItem } from '../lib/hybrid';

const useIsRead = (id: string): boolean => {
  useSyncExternalStore(readPosts.subscribe, readPosts.getVersion);
  return readPosts.has(id);
};

type PostCardProps = {
  post: PostSummary;
  layout: Prefs['layout'];
  showThumbnails: boolean;
  showSub: boolean;
  onHide?: (id: string) => void;
};

const Stats = ({ post, onMore }: { post: PostSummary; onMore: () => void }) => {
  const nav = useNav();
  return (
    <div className="post-stats">
      <VoteLinks
        thingId={post.id}
        permalink={post.permalink}
        score={post.score}
        vote={post.vote}
        kind="post"
        variant="stat"
      />
      <button
        type="button"
        className="stat"
        data-ripple
        onClick={(event) => {
          event.stopPropagation();
          nav.openPost(post);
        }}
        aria-label={`${post.comments} comments`}
      >
        <Icon name="comment" />
        {compact(post.comments)}
      </button>
      <span className="grow" />
      <button
        type="button"
        className="icon-btn"
        data-ripple
        aria-label="More actions"
        onClick={(event) => {
          event.stopPropagation();
          onMore();
        }}
      >
        <Icon name="more" size={20} />
      </button>
    </div>
  );
};

/** The compact and list layouts' row: title, flags, meta and thumbnail. */
const PostRow = ({
  post,
  showSub,
  thumb,
  onMore,
}: {
  post: PostSummary;
  showSub: boolean;
  thumb: boolean;
  onMore: () => void;
}) => (
  <>
    <div className="row">
      <div className="row-main">
        <h3 className="post-title">{post.title}</h3>
        <PostFlags post={post} />
        <PostMeta post={post} showSub={showSub} />
        <div className="list-stats">
          <VoteLinks
            thingId={post.id}
            permalink={post.permalink}
            score={post.score}
            vote={post.vote}
            kind="post"
            variant="inline"
          />
          <span>
            <Icon name="comment" size={14} />
            {compact(post.comments)}
          </span>
        </div>
      </div>
      {thumb ? <Thumb post={post} /> : null}
    </div>
    <div className="row-foot">
      <Stats post={post} onMore={onMore} />
    </div>
  </>
);

/**
 * Relay's crosspost block: an "Original Post" header over the original as a
 * small card styled like a feed row, or with Compact Crosspost Layout one "N Comments in r/sub"
 * link. Both open the original's comments.
 */
const Crosspost = ({ original }: { original: PostSummary }) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const read = useIsRead(original.id);
  const more = () => openPostActions(nav, original);
  const press = useLongPress(more);
  const open = () => nav.openPost(original);
  if (prefs.compactCrossposts)
    return (
      <div className="crosspost">
        <button
          type="button"
          className="crosspost-title is-single"
          data-ripple
          onClick={open}
        >
          <span>
            {plural(original.comments, 'Comment')} in {site.communityLabel(original.subreddit)}
          </span>
          <Icon name="crosspost" size={20} />
        </button>
      </div>
    );
  return (
    <div className="crosspost">
      <button
        type="button"
        className="crosspost-title"
        data-ripple
        onClick={open}
      >
        <span>Original Post</span>
        <Icon name="crosspost" size={20} />
      </button>
      <article className={`crosspost-card${read ? ' is-read' : ''}`}>
        <button
          type="button"
          className="post-hit"
          data-ripple
          onClick={() => {
            if (press.consumeClick()) return;
            open();
          }}
          aria-label={`Original post: ${original.title}`}
          {...press.handlers}
        />
        {/* The original as a feed row: title, flags, meta and its score and
            comments, with no thumbnail or buttons since the crosspost above
            already shows the media and has its own. */}
        <h3 className="post-title">{original.title}</h3>
        <PostFlags post={original} />
        <PostMeta post={original} showSub />
        <div className="crosspost-stats">
          <span>
            <Icon name="up" size={14} />
            {compact(original.score)}
          </span>
          <span>
            <Icon name="comment" size={14} />
            {compact(original.comments)}
          </span>
        </div>
      </article>
    </div>
  );
};

export const PostCard = memo(
  ({ post, layout, showThumbnails, showSub, onHide }: PostCardProps) => {
    const nav = useNav();
    const read = useIsRead(post.id);
    const selected = useIsSelectedPost(post.id);
    const stateClass = `${read ? ' is-read' : ''}${selected ? ' is-selected' : ''}`;
    const more = () => openPostActions(nav, post, onHide);
    const press = useLongPress(more);
    const open = () => {
      if (press.consumeClick()) return;
      nav.openPost(post);
    };
    const account = useAccount();
    const vote = useVoteToggle(post.id, post.vote, post.score);
    const saved = useSaved(post.id, post.saved);
    // The hybrid feed's Lemmy posts are voted on and saved on their instance.
    const writable = !isLemmyItem(post.id);
    // Relay's post swipe actions: Up, Down, Save, Share, Cmts, Mod, More.
    const swipe: SwipeAction[] = [
      ...(writable
        ? ([
            { icon: 'up', label: 'Up', title: 'Upvote', tone: 'up', active: vote.current === 1, disabled: vote.pending, onClick: () => vote.cast(1) },
            { icon: 'down', label: 'Down', title: 'Downvote', tone: 'down', active: vote.current === -1, disabled: vote.pending, onClick: () => vote.cast(-1) },
            { icon: saved ? 'starFilled' : 'star', label: saved ? 'Saved' : 'Save', tone: 'saved', active: saved, onClick: () => toggleSaved(post.id, saved) },
          ] satisfies SwipeAction[])
        : []),
      { icon: 'share', label: 'Share', onClick: () => void sharePost(post.id, post.permalink) },
      { icon: 'comment', label: 'Cmts', title: 'Open comments', onClick: () => nav.openPost(post) },
      ...(writable && account?.isMod && site.features.moderation
        ? [{ icon: 'modShield', label: 'Mod', title: 'Moderate', onClick: () => nav.openSheet((onClosed) => <ModActionsSheet id={post.id} onClosed={onClosed} />) } satisfies SwipeAction]
        : []),
      { icon: 'more', label: 'More', title: 'More actions', onClick: more },
    ];

    const crosspost = post.crosspostParent ? (
      <Crosspost original={post.crosspostParent} />
    ) : null;

    const hit = (
      <button
        type="button"
        className="post-hit"
        data-ripple
        onClick={open}
        aria-label={post.title}
        {...press.handlers}
      />
    );

    if (layout === 'cards') {
      return (
        <SwipeActions actions={swipe}>
        <article
          className={`post${stateClass}`}
          data-anim-key={post.id}
        >
          {hit}
          <div className="card-body">
            <PostMeta post={post} showSub={showSub} />
            <h3 className="post-title">{post.title}</h3>
            <PostFlags post={post} />
            {post.media.kind === 'self' && post.excerpt ? (
              <p className="post-excerpt">{post.excerpt}</p>
            ) : null}
          </div>
          {post.media.kind !== 'self' ? (
            <div className="card-media">
              <MediaFrame post={post} variant="card" />
            </div>
          ) : null}
          {crosspost}
          <div className="card-foot">
            <Stats post={post} onMore={more} />
          </div>
        </article>
        </SwipeActions>
      );
    }

    const thumb = showThumbnails && wantsThumb(post);
    return (
      <SwipeActions actions={swipe}>
      <article
        className={`post${stateClass}`}
        data-anim-key={post.id}
      >
        {hit}
        <PostRow post={post} showSub={showSub} thumb={thumb} onMore={more} />
        {crosspost}
      </article>
      </SwipeActions>
    );
  }
);
PostCard.displayName = 'PostCard';
