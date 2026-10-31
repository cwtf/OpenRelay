import type { PostSummary } from "../../shared/api";
import { site } from "../lib/api";
import type { Nav } from "../app/nav";
import {
  openUrl,
  copyText,
  redditUrl,
  sharePost,
  toast,
} from "../lib/platform";
import { currentAccount } from "../lib/account";
import { hiddenPosts } from "../lib/storage";
import {
  offlineAvailable,
  offlineMode,
  removeFromOffline,
  saveOffline,
} from "../lib/offline";
import { isSavedOffline } from "../lib/offlineStore";
import { DeleteSheet } from "./Relay";
import { Sheet, SheetItem } from "./Sheet";

/** `onDeleted` runs once Reddit has deleted your own post (the post screen closes). */
export const openPostActions = (
  nav: Nav,
  post: PostSummary,
  onHide?: (id: string) => void,
  onDeleted?: () => void,
) => {
  const own = currentAccount()?.name.toLowerCase() === post.author.toLowerCase();
  nav.openSheet((onClosed) => (
    <Sheet title={post.title} label="Post actions" onClosed={onClosed}>
      {(close) => {
        const run = (action: () => void) => () => {
          close();
          action();
        };
        const external =
          post.media.kind === "link" || post.media.kind === "embed";
        const savedOffline = isSavedOffline(post.id);
        return (
          <>
            <SheetItem
              icon="comment"
              label="Open comments"
              onClick={run(() => nav.openPost(post))}
            />
            {post.crosspostParent ? (
              <SheetItem
                icon="crosspost"
                label="View original post"
                hint={site.communityLabel(post.crosspostParent.subreddit)}
                onClick={run(() => nav.openPost(post.crosspostParent!))}
              />
            ) : null}
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
              label={`View on ${site.name}`}
              onClick={run(() => openUrl(redditUrl(post.permalink)))}
            />
            {offlineAvailable() && !offlineMode ? (
              <SheetItem
                icon="download"
                label={savedOffline ? "Update offline copy" : "Save for offline"}
                hint="Post and comments"
                onClick={run(() => void saveOffline([post.id]))}
              />
            ) : null}
            {savedOffline ? (
              <SheetItem
                icon="trash"
                label="Remove offline copy"
                onClick={run(() => void removeFromOffline([post.id]))}
              />
            ) : null}
            {post.subreddit.toLowerCase() !== nav.current.toLowerCase() ? (
              <SheetItem
                icon="people"
                label={`Go to ${site.communityLabel(post.subreddit)}`}
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
            {own ? (
              <SheetItem
                icon="trash"
                label="Delete"
                onClick={run(() =>
                  nav.openSheet((onClosed) => (
                    <DeleteSheet id={post.id} onDeleted={onDeleted} onClosed={onClosed} />
                  )),
                )}
              />
            ) : null}
          </>
        );
      }}
    </Sheet>
  ));
};
