import { memo, useSyncExternalStore } from 'react';
import type { Prefs, PostSummary } from '../../shared/api';
import { useNav } from '../app/nav';
import { compact } from '../lib/format';
import { useLongPress } from '../lib/gestures';
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
import { VoteLinks } from './VoteLinks';

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
        permalink={post.permalink}
        score={post.score}
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

export const PostCard = memo(
  ({ post, layout, showThumbnails, showSub, onHide }: PostCardProps) => {
    const nav = useNav();
    const read = useIsRead(post.id);
    const more = () => openPostActions(nav, post, onHide);
    const press = useLongPress(more);
    const open = () => {
      if (press.consumeClick()) return;
      nav.openPost(post);
    };

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
        <article
          className={`post${read ? ' is-read' : ''}`}
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
          <div className="card-foot">
            <Stats post={post} onMore={more} />
          </div>
        </article>
      );
    }

    const thumb = showThumbnails && wantsThumb(post);
    return (
      <article
        className={`post${read ? ' is-read' : ''}`}
        data-anim-key={post.id}
      >
        {hit}
        <div className="row">
          <div className="row-main">
            <h3 className="post-title">{post.title}</h3>
            <PostFlags post={post} />
            <PostMeta post={post} showSub={showSub} />
            <div className="list-stats">
              <span className="score">
                <Icon name="up" size={14} />
                {compact(post.score)}
              </span>
              <span>
                <Icon name="comment" size={14} />
                {compact(post.comments)}
              </span>
            </div>
          </div>
          {thumb ? <Thumb post={post} /> : null}
        </div>
        <div className="row-foot">
          <Stats post={post} onMore={more} />
        </div>
      </article>
    );
  }
);
PostCard.displayName = 'PostCard';
