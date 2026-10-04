import type { PostSummary } from "../../shared/api";
import type { Nav } from "../app/nav";
import {
  openUrl,
  copyText,
  redditUrl,
  sharePost,
  toast,
} from "../lib/platform";
import { hiddenPosts } from "../lib/storage";
import { Sheet, SheetItem } from "./Sheet";

export const openPostActions = (
  nav: Nav,
  post: PostSummary,
  onHide?: (id: string) => void,
) => {
  nav.openSheet((onClosed) => (
    <Sheet title={post.title} label="Post actions" onClosed={onClosed}>
      {(close) => {
        const run = (action: () => void) => () => {
          close();
          action();
        };
        const external =
          post.media.kind === "link" || post.media.kind === "embed";
        return (
          <>
            <SheetItem
              icon="comment"
              label="Open comments"
              onClick={run(() => nav.openPost(post))}
            />
            {external ? (
              <SheetItem
                icon="external"
                label="Open link"
                hint={post.domain}
                onClick={run(() => nav.openLink(post.url))}
              />
            ) : null}
            <SheetItem
              icon="share"
              label="Share"
              onClick={run(() => void sharePost(post.id, post.permalink))}
            />
            <SheetItem
              icon="copy"
              label="Copy link"
              onClick={run(
                () => void copyText(redditUrl(post.permalink), "Link copied"),
              )}
            />
            <SheetItem
              icon="external"
              label="View on Reddit"
              onClick={run(() => openUrl(redditUrl(post.permalink)))}
            />
            {post.subreddit.toLowerCase() !== nav.current.toLowerCase() ? (
              <SheetItem
                icon="people"
                label={`Go to r/${post.subreddit}`}
                onClick={run(() => nav.openCommunity(post.subreddit))}
              />
            ) : null}
            {onHide ? (
              <SheetItem
                icon="hide"
                label="Hide from this feed"
                hint="Only on this device"
                onClick={run(() => {
                  hiddenPosts.add(post.id);
                  onHide(post.id);
                  toast("Post hidden");
                })}
              />
            ) : null}
          </>
        );
      }}
    </Sheet>
  ));
};
