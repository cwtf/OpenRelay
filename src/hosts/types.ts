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

/** A file to save: a remote URL, or bytes the reader built (a video with sound). */
export type SaveFile =
  | { url: string; filename?: string }
  | { data: Uint8Array; filename: string; type: string };

export type Downloads = { save(file: SaveFile): Promise<void> };

export type ReaderHost = {
  /** Shown in diagnostics only. */
  name: string;
  /** `null` falls back to the frame's `localStorage` when it has one. */
  storage: HostStorage | null;
  /**
   * Access to saving files. Call it straight from the click handler, before
   * awaiting anything: Chrome's permission prompt needs the user gesture.
   * Resolves to "declined" if the user refused, "unavailable" if the host
   * can't save files.
   */
  downloads(): Promise<Downloads | "declined" | "unavailable">;
};

export type PageHost = {
  /** Where the reader is served, with the given hash appended. */
  readerUrl(hash: string): string;
  /** The toolbar button / menu item that shows or hides the reader. */
  onToggle(listener: () => void): void;
};
