import type { CommentSort, FeedSort, Timeframe } from "../../shared/api.ts";
import { safeUrl } from "./reddit.ts";

/**
 * New Reddit's server-rendered HTML ("shreddit"), for sessions Reddit
 * refuses JSON: signed out, it answers every `.json` read with 403, but
 * still serves the HTML pieces its own pages load while you scroll. The
 * content script fetches them (the `html` bridge action) and reads them with
 * `readHtmlPage` in `snapshot.ts`; the paths and the Markdown are here.
 */

/** Comments a page left out: POSTed with their cursor, as new Reddit does. */
export type MoreComments = {
  /** The comment they reply to; "" for the top level of the page. */
  parent: string;
  path: string;
  cursor: string;
};

/**
 * A page of a feed. Reddit's own pages pass the last post's full name in
 * base64; the popular feed (Reddit's signed-out front page too) also as
 * `cursor`. Multireddits have no such page: null.
 */
export function feedPagePath(
  sub: string,
  sort: FeedSort,
  t: Timeframe,
  after?: string | null,
): string | null {
  const front = sub === "Home" || sub.toLowerCase() === "popular";
  if (!front && !/^\w+$/.test(sub)) return null;
  const params = new URLSearchParams();
  if (front) params.set("sort", sort.toUpperCase());
  else params.set("name", sub);
  if (sort === "top" || sort === "controversial") params.set("t", t.toUpperCase());
  if (after && /^t3_[a-z0-9]+$/i.test(after)) {
    params.set("after", btoa(after));
    if (front) params.set("cursor", btoa(after));
  }
  return (
    (front
      ? "/svc/shreddit/feeds/popular-feed?"
      : "/svc/shreddit/community-more-posts/" + sort + "/?") + params
  );
}

/** A post's own page, for its text and media. */
export const postPagePath = (id: string): string =>
  "/comments/" + id.replace(/^t3_/, "") + "/";

/** A post's first top-level comments. */
export const commentsPath = (id: string, sub: string, sort: CommentSort): string =>
  "/svc/shreddit/comments/r/" +
  encodeURIComponent(sub) +
  "/" +
  id +
  "?sort=" +
  sort.toUpperCase();

const PAGE_ROUTES = [
  /^\/svc\/shreddit\/community-more-posts\/(?:hot|new|top|rising|controversial|best)\/?$/i,
  /^\/svc\/shreddit\/feeds\/popular-feed\/?$/i,
  /^\/svc\/shreddit\/comments\/r\/\w+\/t3_[a-z0-9]+\/?$/i,
  /^\/(?:r\/\w+\/)?comments\/[a-z0-9]+\/(?:[\w-]+\/?)?$/i,
];
/** Signed out it's `/more-comments/<sub>/…`; signed in, `/more-comments/r/<sub>/…`. */
const MORE_COMMENTS = /^\/svc\/shreddit\/more-comments\/(?:r\/)?\w+\/t3_[a-z0-9]+\/?$/i;

/**
 * A same-origin page of posts or comments: read with GET, or, with a cursor,
 * the "more comments" piece Reddit reads with POST.
 */
export function allowedHtmlPath(path: unknown, cursor?: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length > 3000 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return false;
  const url = new URL(path, "https://www.reddit.com");
  if (url.origin !== "https://www.reddit.com") return false;
  if (cursor === undefined) return PAGE_ROUTES.some((route) => route.test(url.pathname));
  return (
    typeof cursor === "string" &&
    /^[\w+/=-]{1,4000}$/.test(cursor) &&
    MORE_COMMENTS.test(url.pathname)
  );
}

/** The parts of a DOM node `htmlToMarkdown` reads, so tests need no DOM. */
export type HtmlNode = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<HtmlNode>;
  getAttribute?(name: string): string | null;
};

const ELEMENT = 1;
const TEXT = 3;
const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "BUTTON", "TEMPLATE", "NOSCRIPT"]);
const BLOCKS = new Set([
  "P", "DIV", "SECTION", "FIGURE", "BLOCKQUOTE", "UL", "OL", "PRE", "TABLE", "HR",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);
const nameOf = (node: HtmlNode) => node.nodeName.toUpperCase();
const children = (node: HtmlNode) => Array.from(node.childNodes);
const attr = (node: HtmlNode, name: string) => node.getAttribute?.(name) ?? "";
const textOf = (node: HtmlNode): string =>
  node.nodeType === TEXT ? (node.nodeValue ?? "") : children(node).map(textOf).join("");
const escapeText = (text: string) => text.replace(/[\\`*_~^[\]]/g, "\\$&");
/** A URL as a Markdown link target. */
const target = (url: string) =>
  safeUrl(url).replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20"));
/** A video posted in a comment, which Reddit's Markdown only links to. */
const VIDEO_LINK = /^https:\/\/(?:www\.)?reddit\.com\/link\/[a-z0-9]+\/video\/[a-z0-9]+\/player\/?$/i;
/**
 * Its stream, as Reddit's player loads it: `v.redd.it/<id>/…`, or from the
 * post's folder, `v.redd.it/link/<post>/asset/<id>/…`.
 */
const VIDEO_STREAM = /^https:\/\/v\.redd\.it\/(?:link\/[a-z0-9]+\/asset\/)?([a-z0-9]+)\//i;
/** The post whose body `htmlToMarkdown` is reading, which a video's link names. */
let reading = "";
/** `**text**`, keeping the spaces around it outside the markers. */
const wrap = (mark: string, text: string, end = mark) => {
  const [, before, body, after] = text.match(/^(\s*)([^]*?)(\s*)$/)!;
  return body ? before + mark + body + end + after : text;
};

function inline(node: HtmlNode): string {
  if (node.nodeType === TEXT) return escapeText((node.nodeValue ?? "").replace(/\s+/g, " "));
  if (node.nodeType !== ELEMENT) return "";
  const name = nameOf(node);
  if (SKIP.has(name)) return "";
  const inner = () => children(node).map(inline).join("");
  switch (name) {
    case "BR":
      return "\\\n";
    case "STRONG":
    case "B":
      return wrap("**", inner());
    case "EM":
    case "I":
      return wrap("*", inner());
    case "DEL":
    case "S":
    case "STRIKE":
      return wrap("~~", inner());
    case "SUP":
      return wrap("^(", inner(), ")");
    case "CODE": {
      const code = textOf(node);
      return code.includes("`") ? "`` " + code + " ``" : "`" + code + "`";
    }
    case "A": {
      const href = target(attr(node, "href"));
      // As Reddit's Markdown has it, so the reader plays it.
      if (VIDEO_LINK.test(href)) return " " + href + " ";
      const label = inner().trim();
      // A picture linked to its full size: the reader opens it when tapped.
      if (/^!\[[^\]]*\]\([^)]*\)$/.test(label)) return label;
      return href ? "[" +(label || escapeText(href)) + "](" + href + ")" : inner();
    }
    case "IMG": {
      const src = target(attr(node, "src"));
      const alt = attr(node, "alt").replace(/[[\]\\]/g, "").trim() || "image";
      return src ? "![" + alt + "](" + src + ")" : "";
    }
    // A video in a comment. Without its stream, its poster picture stands in.
    case "SHREDDIT-PLAYER":
    case "SHREDDIT-PLAYER-2": {
      const id = VIDEO_STREAM.exec(safeUrl(attr(node, "src")))?.[1];
      return id && reading
        ? " https://www.reddit.com/link/" + reading + "/video/" + id + "/player "
        : inner();
    }
  }
  if (attr(node, "class").split(/\s+/).includes("md-spoiler-text"))
    return wrap(">!", inner(), "!<");
  // A block inside inline text, which Reddit's own Markdown can't make.
  if (BLOCKS.has(name)) return " " + blocks(node).join(" ") + " ";
  return inner();
}

const inlineOf = (node: HtmlNode) =>
  children(node).map(inline).join("").replace(/\s+/g, " ").trim();

/** The node's content as Markdown paragraphs and other blocks. */
function blocks(node: HtmlNode): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = run
      .split("\n")
      // Text that would start a heading, quote or list stays text.
      .map((line) => line.trim().replace(/^(#|>(?!!)|[-+] )/, "\\$1").replace(/^(\d+)\. /, "$1\\. "))
      .join("\n")
      .trim();
    if (text) out.push(text);
    run = "";
  };
  for (const child of children(node)) {
    if (child.nodeType === ELEMENT && BLOCKS.has(nameOf(child))) {
      flush();
      out.push(...block(child));
    } else run += inline(child);
  }
  flush();
  return out;
}

function block(node: HtmlNode): string[] {
  const name = nameOf(node);
  const heading = name.match(/^H([1-6])$/);
  if (heading) {
    const text = inlineOf(node);
    return text ? ["#".repeat(Number(heading[1])) + " " + text] : [];
  }
  switch (name) {
    case "HR":
      return ["***"];
    case "PRE": {
      const code = textOf(node).replace(/\n$/, "");
      const fence = code.includes("```") ? "~~~" : "```";
      return [fence + "\n" + code + "\n" + fence];
    }
    case "BLOCKQUOTE": {
      const text = blocks(node).join("\n\n");
      return text ? [text.split("\n").map((line) => (line ? "> " + line : ">")).join("\n")] : [];
    }
    case "UL":
    case "OL":
      return list(node, name === "OL");
    case "TABLE":
      return table(node);
  }
  return blocks(node);
}

function list(node: HtmlNode, ordered: boolean): string[] {
  const start = Number(attr(node, "start")) || 1;
  const items = children(node)
    .filter((child) => nameOf(child) === "LI")
    .map((item, index) => {
      const marker = ordered ? start + index + ". " : "- ";
      const lines = blocks(item).join("\n\n").split("\n");
      return marker + lines.map((line, i) => (i && line ? " ".repeat(marker.length) + line : line)).join("\n");
    });
  return items.length ? [items.join("\n")] : [];
}

function table(node: HtmlNode): string[] {
  const rows: HtmlNode[] = [];
  const collect = (parent: HtmlNode) => {
    for (const child of children(parent)) {
      const name = nameOf(child);
      if (name === "TR") rows.push(child);
      else if (name === "THEAD" || name === "TBODY" || name === "TFOOT") collect(child);
    }
  };
  collect(node);
  const cells = rows.map((row) =>
    children(row)
      .filter((cell) => ["TH", "TD"].includes(nameOf(cell)))
      .map((cell) => inlineOf(cell).replace(/\|/g, "\\|")),
  );
  const width = Math.max(0, ...cells.map((row) => row.length));
  if (!width) return [];
  const line = (row: string[]) =>
    "| " + Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ") + " |";
  return [
    [line(cells[0]!), line(Array<string>(width).fill("---")), ...cells.slice(1).map(line)].join("\n"),
  ];
}

/**
 * Reddit's rendered post or comment body back as Reddit Markdown. `post` is
 * the ID of the post it's on (with `t3_` or without), for its videos' links.
 */
export function htmlToMarkdown(root: HtmlNode, post = ""): string {
  reading = /^(?:t3_)?([a-z0-9]+)$/i.exec(post)?.[1] ?? "";
  try {
    return blocks(root).join("\n\n");
  } finally {
    reading = "";
  }
}
