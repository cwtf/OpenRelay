import { usePrefs } from "../app/prefs";
import { plural } from "../lib/format";
import {
  FEED_SAVE_COUNTS,
  TEXT_ONLY,
  saveFeedOffline,
  savedMedia,
  stopSaving,
  useSaveProgress,
  type OfflineFeed,
} from "../lib/offline";
import { secondsLeft, timeLeftLabel, type SaveProgress } from "../lib/saveProgress";
import { Segmented } from "./SettingsSheet";
import { Sheet, SheetItem } from "./Sheet";

/** "12 of 50 · about 2 min left", or what it's doing before that. */
const progressText = (progress: SaveProgress): string => {
  if (!progress.ids.length) return "Finding posts to save…";
  const left = secondsLeft(progress, Date.now());
  const count = `${progress.done} of ${plural(progress.ids.length, "post")}`;
  return left === null ? count : `${count} · ${timeLeftLabel(left)}`;
};

const RING = 2 * Math.PI * 9;

/** How much is saved, round the drawer row's icon; spinning while picking. */
const ProgressRing = ({ fraction }: { fraction: number | null }) => (
  <svg
    className={`icon progress-ring${fraction === null ? " is-spinning" : ""}`}
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    aria-hidden
  >
    <circle cx="12" cy="12" r="9" opacity={0.25} />
    <circle
      cx="12"
      cy="12"
      r="9"
      strokeLinecap="round"
      strokeDasharray={`${RING * (fraction ?? 0.25)} ${RING}`}
      transform="rotate(-90 12 12)"
    />
  </svg>
);

/** The drawer's "Save feed for offline" row while a save runs. */
export const SavingItem = ({
  progress,
  onClick,
}: {
  progress: SaveProgress;
  onClick: () => void;
}) => (
  <button type="button" className="drawer-item is-saving" data-ripple onClick={onClick}>
    <ProgressRing
      fraction={progress.ids.length ? progress.done / progress.ids.length : null}
    />
    <span className="label">
      {progress.stopping ? "Stopping…" : "Saving for offline"}
      <span className="hint">{progressText(progress)}</span>
    </span>
  </button>
);

/** Opened from that row: the progress again, and Stop. */
export const SavingSheet = ({ onClosed }: { onClosed: () => void }) => {
  const progress = useSaveProgress();
  return (
    <Sheet title="Saving for offline" onClosed={onClosed}>
      {(close) =>
        !progress ? (
          <div className="sheet-section">Finished</div>
        ) : progress.stopping ? (
          <div className="sheet-section">Stopping after this post…</div>
        ) : (
          <SheetItem
            icon="close"
            label="Stop saving"
            hint={`${progressText(progress)}. Posts saved so far are kept.`}
            onClick={() => {
              stopSaving();
              close();
            }}
          />
        )
      }
    </Sheet>
  );
};

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
