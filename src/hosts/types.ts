/**
 * What OpenRelay needs from the app that runs it. The browser extension gets
 * these from the `chrome.*` APIs (see `reader.ts` and `page.ts`). A wrapper
 * app (Android WebView, Electron) instead defines a global object before
 * OpenRelay's scripts run:
 *
 * - `openRelayReaderHost` (a `ReaderHost`) in the reader frame only, and
 * - `openRelayPageHost` (a `PageHost`) in the Reddit page, before `content.js`.
 *
 * Every method is async so a host can answer over a message channel.
 */

/** Key/value storage that survives restarts. Values are JSON-compatible. */
export type HostStorage = {
  /** Every stored entry. */
  getAll(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Changes saved by another reader (another tab or window), if any. */
  onChanged?(
    listener: (changes: Record<string, { newValue?: unknown }>) => void,
  ): void;
};

/**
 * Posts saved for offline reading. Kept apart from `HostStorage`, which is
 * read whole at start, and read one entry at a time. Keys match
 * `OFFLINE_KEY`; values are JSON-compatible. A missing entry reads as
 * `undefined`.
 */
export type OfflineStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

/** Offline keys are safe as file names: `index`, `post:t3_abc123`. */
export const OFFLINE_KEY = /^[a-z]+(?::[A-Za-z0-9_]{1,40})?$/;

/**
 * Reddit's image hosts. Images on them are saved with offline posts, fetched
 * by the host because they don't allow the reader to fetch them (no CORS).
 */
export const MEDIA_HOSTS: readonly string[] = [
  "i.redd.it",
  "preview.redd.it",
  "external-preview.redd.it",
  "a.thumbs.redditmedia.com",
  "b.thumbs.redditmedia.com",
];
/** Larger files aren't saved. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** A fetched file: its media type and its bytes as base64. */
export type MediaFile = { type: string; data: string };

/**
 * Fetches an image from `MEDIA_HOSTS` (https only, at most `MEDIA_MAX_BYTES`,
 * without cookies), rejecting anything else.
 */
export type MediaFetcher = { fetch(url: string): Promise<MediaFile> };

/** A file to save: a remote URL, or bytes the reader built (a video with sound). */
export type SaveFile =
  | { url: string; filename?: string }
  | { data: Uint8Array; filename: string; type: string };

export type Downloads = { save(file: SaveFile): Promise<void> };

/**
 * A message channel between the reader and the Reddit page, for a host that
 * shows the reader outside the page (see `PageHost.readerView`). It carries the
 * same `openrelay:*` messages as the iframe's `postMessage`; the host checks
 * both ends' origins.
 */
export type HostChannel = {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
};

/**
 * The reader shown by the host itself, over the page, instead of in an iframe
 * the content script adds. Android needs this: Reddit's CSP `frame-src` blocks
 * the reader's origin, and a WebView can't exempt a frame from it.
 */
export type ReaderView = HostChannel & {
  /** Loads the reader with this hash (as `readerUrl` would), still hidden. */
  open(hash: string): void;
  /** Shows or hides the reader that's already open. */
  setVisible(visible: boolean): void;
  /** Unloads the reader. */
  close(): void;
  /** How much of the bottom edge the reader's chrome uses, for the host's own controls. */
  setBottomInset(bottom: number): void;
  /** The host's "Original Reddit" control was used. */
  onExit(listener: () => void): void;
};

export type ReaderHost = {
  /** Shown in diagnostics only. */
  name: string;
  /**
   * The channel to the Reddit page when the host shows the reader itself.
   * Without one, the reader is in an iframe and uses `window.parent`.
   */
  channel?: HostChannel;
  /** `null` falls back to the frame's `localStorage` when it has one. */
  storage: HostStorage | null;
  /** Absent or `null` when the host can't keep posts for offline reading. */
  offline?: OfflineStore | null;
  /**
   * Access to fetching images for offline posts. As with `downloads`, call
   * it straight from the click handler: the extension asks for permission.
   * Absent when the host can't fetch them.
   */
  media?(): Promise<MediaFetcher | "declined" | "unavailable">;
  /**
   * Access to saving files. Call it straight from the click handler, before
   * awaiting anything: Chrome's permission prompt needs the user gesture.
   * Resolves to "declined" if the user refused, "unavailable" if the host
   * can't save files.
   */
  downloads(): Promise<Downloads | "declined" | "unavailable">;
  /**
   * The host's own back control (Android's back gesture), for a host whose
   * back doesn't reach the reader's history. The listener returns whether the
   * reader went back; if not, the host does its own back. A later call
   * replaces the listener.
   */
  onBack?(listener: () => boolean): void;
};

export type PageHost = {
  /** Where the reader is served, with the given hash appended. */
  readerUrl(hash: string): string;
  /** The toolbar button / menu item that shows or hides the reader. */
  onToggle(listener: () => void): void;
  /** Set when the host shows the reader itself; otherwise it's an iframe. */
  readerView?: ReaderView;
};
