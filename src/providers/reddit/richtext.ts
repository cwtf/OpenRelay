import { parseBlocks, type Block } from "../../client/lib/markdownParser.ts";

/**
 * Reddit-flavoured Markdown to Reddit's richtext JSON (RTJSON), for a reply
 * or edit that refers to media by ID: Reddit takes those only as richtext.
 * Its own converter (`/api/convert_rte_body_format`, which PRAW calls through
 * OAuth) answers a browser session with 404, so the content script builds
 * the document here, with the block parser the reader renders Markdown with
 * and inline rules that follow `markdown.tsx`.
 */

/**
 * `![img](<asset id>)`, `![gif](<asset id>)` or `![gif](giphy|<id>)`: media
 * Reddit takes in a comment only as richtext, not in its Markdown `text`.
 * Images linked by URL and Reddit's emotes stay inline.
 */
const MEDIA = /!\[(img|gif|video)\]\(((?!https?:|emote\|)[^)\s]+)[^)]*\)/;

export const hasMediaRef = (markdown: string): boolean => MEDIA.test(markdown);

// Reddit's format flags for a range of text.
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 8;
const SUPER = 32;
const CODE = 64;

/** `[flags, start, length]`, counted in code points as Reddit's backend does. */
type Range = [number, number, number];
type Text = { e: "text"; t: string; f?: Range[] };
type Inline =
  | Text
  | { e: "link"; u: string; t: string; f?: Range[] }
  | { e: "r/" | "u/"; t: string; l: boolean }
  | { e: "spoilertext"; c: Inline[] }
  | { e: "br" };
type Rich = { e: string; [key: string]: unknown };
/** Text with its flags, before runs of it are joined into one text node. */
type Piece = { text: string; f: number } | Exclude<Inline, Text>;
type Rule = { re: RegExp; piece: (m: RegExpExecArray, f: number) => Piece[] };

const length = (text: string): number => [...text].length;

/** Joins a run of text pieces into one node, its flags as ranges. */
function textNode(run: { text: string; f: number }[]): { t: string; f?: Range[] } {
  let t = "";
  const f: Range[] = [];
  for (const { text, f: flags } of run) {
    if (!text) continue;
    const start = length(t);
    const last = f.at(-1);
    if (flags && last && last[0] === flags && last[1] + last[2] === start) last[2] += length(text);
    else if (flags) f.push([flags, start, length(text)]);
    t += text;
  }
  return f.length ? { t, f } : { t };
}

/** A link; without a label (a bare URL) it reads as its URL, unparsed. */
const link = (url: string, label: string, f: number): Piece => {
  const text = label
    ? pieces(label, f).map((piece) =>
        "text" in piece ? piece : { text: "t" in piece ? piece.t : "", f },
      )
    : [{ text: url, f }];
  const node = textNode(text);
  return { e: "link", u: url, ...(node.t ? node : { t: url }) };
};

/** A bare URL without the punctuation that ends its sentence (as `markdown.tsx`). */
const trimUrl = (url: string): string => {
  let result = url;
  for (;;) {
    const last = result.at(-1);
    if (last && ".,;:!?'\"*_~".includes(last)) result = result.slice(0, -1);
    else if (
      last === ")" &&
      (result.match(/\)/g) ?? []).length > (result.match(/\(/g) ?? []).length
    )
      result = result.slice(0, -1);
    else return result;
  }
};

const RULES: Rule[] = [
  { re: /\\([\\`*_{}[\]()#+\-.!>~^|<])/, piece: (m, f) => [{ text: m[1]!, f }] },
  { re: /(`+)([\s\S]*?[^`])\1(?!`)/, piece: (m, f) => [{ text: m[2]!, f: f | CODE }] },
  { re: / {2,}\n|\\\n/, piece: () => [{ e: "br" }] },
  { re: />!([\s\S]+?)!</, piece: (m, f) => [{ e: "spoilertext", c: inline(m[1]!, f) }] },
  // An image linked by URL is a link; anything else (an emote) stays text.
  {
    re: /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/,
    piece: (m, f) =>
      /^https?:\/\//.test(m[2]!) ? [link(m[2]!, m[1]!, f)] : [{ text: m[0], f }],
  },
  {
    re: /\[((?:\\.|[^[\]\\]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]+(?:\([^\s)]*\)[^\s)>]*)?)>?(?:\s+["'][^"']*["'])?\s*\)/,
    piece: (m, f) => [link(m[2]!, m[1]!, f)],
  },
  {
    re: /https?:\/\/[^\s<>[\]]+/,
    piece: (m, f) => {
      const url = trimUrl(m[0]);
      return [link(url, "", f), { text: m[0].slice(url.length), f }];
    },
  },
  {
    re: /(?<![\w/])(\/?)(r|u)\/([A-Za-z0-9_-]{2,21})/,
    piece: (m) => [{ e: m[2] === "r" ? "r/" : "u/", t: m[3]!, l: m[1] === "/" }],
  },
  {
    re: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/,
    piece: (m, f) => pieces(m[1] ?? m[2]!, f | BOLD),
  },
  { re: /~~(?=\S)([\s\S]*?\S)~~/, piece: (m, f) => pieces(m[1]!, f | STRIKE) },
  {
    re: /\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<![A-Za-z0-9])_(?=\S)([\s\S]*?\S)_(?![A-Za-z0-9])/,
    piece: (m, f) => pieces(m[1] ?? m[2]!, f | ITALIC),
  },
  { re: /\^\(([^)\n]+)\)|\^([^\s^()]+)/, piece: (m, f) => pieces(m[1] ?? m[2]!, f | SUPER) },
  { re: /\n/, piece: (_m, f) => [{ text: " ", f }] },
];

/** The earliest rule's match each time, as the reader renders inline Markdown. */
function pieces(text: string, f: number): Piece[] {
  const out: Piece[] = [];
  let rest = text;
  while (rest) {
    let best: { match: RegExpExecArray; rule: Rule } | null = null;
    for (const rule of RULES) {
      const match = rule.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) {
        best = { match, rule };
        if (match.index === 0) break;
      }
    }
    if (!best) {
      out.push({ text: rest, f });
      break;
    }
    if (best.match.index > 0) out.push({ text: rest.slice(0, best.match.index), f });
    out.push(...best.rule.piece(best.match, f));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return out;
}

function inline(text: string, f = 0): Inline[] {
  const out: Inline[] = [];
  let run: { text: string; f: number }[] = [];
  const flush = () => {
    const node = textNode(run);
    if (node.t) out.push({ e: "text", ...node });
    run = [];
  };
  for (const piece of pieces(text, f)) {
    if ("text" in piece) run.push(piece);
    else {
      flush();
      out.push(piece);
    }
  }
  flush();
  return out;
}

/**
 * Media by ID, a block of its own. Reddit names a Giphy GIF in a comment
 * `giphy|<id>|downsized` (its `media_metadata` key), so a bare one gets that.
 */
const media = (kind: string, id: string): Rich => ({
  e: kind,
  id: /^giphy\|[A-Za-z0-9]+$/.test(id) ? `${id}|downsized` : id,
});

/** A paragraph, split around the media it refers to. */
function paragraph(text: string): Rich[] {
  const out: Rich[] = [];
  const par = (part: string) => {
    const c = inline(part.trim());
    if (c.length) out.push({ e: "par", c });
  };
  let last = 0;
  for (const match of text.matchAll(new RegExp(MEDIA.source, "g"))) {
    par(text.slice(last, match.index));
    out.push(media(match[1]!, match[2]!));
    last = match.index + match[0].length;
  }
  par(text.slice(last));
  return out;
}

const ALIGN = { left: "L", center: "C", right: "R" } as const;

function blocks(list: Block[]): Rich[] {
  return list.flatMap((block): Rich[] => {
    switch (block.t) {
      case "p":
        return paragraph(block.text);
      case "h":
        return [{ e: "h", l: block.level, c: inline(block.text) }];
      case "code":
        return [{ e: "code", c: block.text.split("\n").map((t) => ({ e: "raw", t })) }];
      case "quote":
        return [{ e: "blockquote", c: blocks(block.children) }];
      case "list":
        return [
          {
            e: "list",
            o: block.ordered,
            c: block.items.map((item) => ({ e: "li", c: blocks(item) })),
          },
        ];
      case "hr":
        return [{ e: "hr" }];
      case "table": {
        const align = (i: number) => {
          const side = block.align[i];
          return side ? { a: ALIGN[side] } : {};
        };
        return [
          {
            e: "table",
            h: block.head.map((cell, i) => ({ ...align(i), c: inline(cell) })),
            c: block.rows.map((row) => block.head.map((_, i) => ({ c: inline(row[i] ?? "") }))),
          },
        ];
      }
      // Lemmy's `::: spoiler` blocks aren't Reddit's; keep what's inside.
      case "spoiler":
        return blocks(block.children);
    }
  });
}

/** The `richtext_json` Reddit's `/api/comment` and `/api/editusertext` take. */
export const toRichtext = (markdown: string): string =>
  JSON.stringify({ document: blocks(parseBlocks(markdown)) });
