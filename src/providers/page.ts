import { providerOf } from "./hosts";
import type { PageProvider } from "./types";
import { redditPage } from "./reddit/page";

/** The content script's provider for the page at `href`, if it has one. */
export function pageProvider(href: string): PageProvider | null {
  switch (providerOf(href)) {
    case "reddit":
      return redditPage;
    default:
      return null;
  }
}
