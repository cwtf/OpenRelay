import { providerOf } from "./hosts";
import type { ReaderProvider } from "./types";
import { redditReader } from "./reddit/reader";

/** The reader's provider for the page it was opened from, if it has one. */
export function readerProvider(href: string): ReaderProvider | null {
  switch (providerOf(href)) {
    case "reddit":
      return redditReader;
    default:
      return null;
  }
}
