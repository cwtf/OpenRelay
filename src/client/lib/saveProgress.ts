/** How far saving posts for offline reading has got, for the drawer and the cards. */

export type SaveProgress = {
  /** The posts being saved, in order; empty while they're still being picked. */
  ids: string[];
  /** Posts finished, saved or not. */
  done: number;
  /** When the first post was started. */
  started: number;
  /** Stop was pressed: no further post is started. */
  stopping: boolean;
};

/** Where one post is in the save, or null when it isn't waiting on it. */
export type SaveState = "saving" | "queued" | null;

export const saveState = (progress: SaveProgress | null, id: string): SaveState => {
  const index = progress ? progress.ids.indexOf(id) : -1;
  if (!progress || index < progress.done) return null;
  if (index === progress.done) return "saving";
  return progress.stopping ? null : "queued";
};

/**
 * Seconds left at the average pace so far (pauses included), or null until
 * the first post is done.
 */
export const secondsLeft = (progress: SaveProgress, now: number): number | null => {
  const left = progress.ids.length - progress.done;
  if (!progress.done || left <= 0) return null;
  return (((now - progress.started) / progress.done) * left) / 1000;
};

/** "about 3 min left", rounded up to a whole minute. */
export const timeLeftLabel = (seconds: number): string =>
  seconds < 60 ? "under a minute left" : `about ${Math.ceil(seconds / 60)} min left`;
