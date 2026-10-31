import { usePrefs } from "../app/prefs";
import { plural } from "../lib/format";
import {
  FEED_SAVE_COUNTS,
  TEXT_ONLY,
  saveFeedOffline,
  savedMedia,
  type OfflineFeed,
} from "../lib/offline";
import { Segmented } from "./SettingsSheet";
import { Sheet, SheetItem } from "./Sheet";

/**
 * "Save feed for offline": the feed's next posts that aren't saved yet, as
 * many as chosen, with the images and videos Settings asks for, as text
 * only, or only its text posts.
 */
export const SaveFeedSheet = ({
  title,
  feed,
  onClosed,
}: {
  title: string;
  feed: OfflineFeed;
  onClosed: () => void;
}) => {
  const { prefs, update } = usePrefs();
  const count = FEED_SAVE_COUNTS.includes(prefs.offlineFeedCount as never)
    ? prefs.offlineFeedCount
    : 25;
  const media = savedMedia();
  const withMedia =
    media.images && media.videos
      ? "With images and videos"
      : media.images
        ? "With images"
        : media.videos
          ? "With videos"
          : null;
  const next = `The next ${plural(count, "post")} you haven't saved`;
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
            <div className="sheet-section">How many</div>
            <Segmented
              label="Posts to save"
              value={String(count)}
              onChange={(value) => update({ offlineFeedCount: Number(value) })}
              options={FEED_SAVE_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <div className="sheet-section">Save</div>
            {withMedia ? (
              <SheetItem
                icon="image"
                label={withMedia}
                hint={`${next}, as set in Settings`}
                onClick={run(() => void saveFeedOffline(feed, count, media))}
              />
            ) : null}
            <SheetItem
              icon="text"
              label="Text only"
              hint={`${next}, without images or videos`}
              onClick={run(() => void saveFeedOffline(feed, count, TEXT_ONLY))}
            />
            <SheetItem
              icon="comment"
              label="Text posts only"
              hint={`The next ${plural(count, "text post")} you haven't saved, skipping links, images and videos`}
              onClick={run(() => void saveFeedOffline(feed, count, TEXT_ONLY, true))}
            />
          </>
        );
      }}
    </Sheet>
  );
};
