import type { PostSummary } from "../../shared/api";
import { plural } from "../lib/format";
import {
  FEED_SAVE_LIMIT,
  TEXT_ONLY,
  saveOffline,
  savedMedia,
} from "../lib/offline";
import { Sheet, SheetItem } from "./Sheet";

/**
 * "Save feed for offline": the feed's first posts with the images and
 * videos Settings asks for, as text only, or only its text posts.
 */
export const SaveFeedSheet = ({
  title,
  posts,
  onClosed,
}: {
  title: string;
  posts: PostSummary[];
  onClosed: () => void;
}) => {
  const first = posts.slice(0, FEED_SAVE_LIMIT);
  const textPosts = posts
    .filter((post) => post.media.kind === "self")
    .slice(0, FEED_SAVE_LIMIT);
  const media = savedMedia();
  const withMedia =
    media.images && media.videos
      ? "With images and videos"
      : media.images
        ? "With images"
        : media.videos
          ? "With videos"
          : null;
  return (
    <Sheet title={`Save ${title} for offline`} onClosed={onClosed}>
      {(close) => {
        // In the click itself: saving images may ask for permission.
        const run = (save: () => void) => () => {
          close();
          save();
        };
        return (
          <>
            {withMedia ? (
              <SheetItem
                icon="image"
                label={withMedia}
                hint={`The first ${plural(first.length, "post")}, as set in Settings`}
                onClick={run(() => void saveOffline(first))}
              />
            ) : null}
            <SheetItem
              icon="text"
              label="Text only"
              hint={`The first ${plural(first.length, "post")}, without images or videos`}
              onClick={run(() => void saveOffline(first, TEXT_ONLY))}
            />
            {textPosts.length ? (
              <SheetItem
                icon="comment"
                label="Text posts only"
                hint={`${plural(textPosts.length, "text post")}, skipping links, images and videos`}
                onClick={run(() => void saveOffline(textPosts, TEXT_ONLY))}
              />
            ) : null}
          </>
        );
      }}
    </Sheet>
  );
};
