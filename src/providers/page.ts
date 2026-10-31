import { providerOf } from "./hosts";
import type { PageProvider } from "./types";
import { redditPage } from "./reddit/page";
import { lemmyPage } from "./lemmy/page";

/** The content script's provider for the page at `href`, if it has one. */
export function pageProvider(href: string): PageProvider | null {
  switch (providerOf(href)) {
    case "reddit":
      return redditPage;
    case "lemmy":
      return lemmyPage;
    default:
      return null;
  }
}
