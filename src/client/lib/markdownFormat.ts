/**
 * Markdown formatting for the reply composer's format bar (after Relay's):
 * each action wraps or prefixes the selection, inserting placeholder text
 * when nothing is selected, and returns the new text and selection.
 */
export type FormatKind =
  | "bold"
  | "italic"
  | "strike"
  | "spoiler"
  | "quote"
  | "link"
  | "bullets"
  | "numbers"
  | "rule"
  | "code"
  | "header"
  | "superscript";

export type Edit = { text: string; start: number; end: number };

const WRAP: Partial<Record<FormatKind, [string, string, string]>> = {
  bold: ["**", "**", "bold text"],
  italic: ["*", "*", "italic text"],
  strike: ["~~", "~~", "struck text"],
  spoiler: [">!", "!<", "spoiler"],
  superscript: ["^(", ")", "superscript"],
};

/** Wrap the selection, or insert the placeholder selected. */
const wrap = (edit: Edit, before: string, after: string, placeholder: string): Edit => {
  const selected = edit.text.slice(edit.start, edit.end) || placeholder;
  const text =
    edit.text.slice(0, edit.start) + before + selected + after + edit.text.slice(edit.end);
  const start = edit.start + before.length;
  return { text, start, end: start + selected.length };
};

/** Prefix every line touched by the selection. */
const prefixLines = (edit: Edit, prefix: (index: number) => string, placeholder: string): Edit => {
  const lineStart = edit.text.lastIndexOf("\n", edit.start - 1) + 1;
  const nextBreak = edit.text.indexOf("\n", edit.end);
  const lineEnd = nextBreak === -1 ? edit.text.length : nextBreak;
  const block = edit.text.slice(lineStart, lineEnd) || placeholder;
  const prefixed = block
    .split("\n")
    .map((line, index) => prefix(index) + line)
    .join("\n");
  // Start the block on its own paragraph so Reddit treats it as one.
  const lead = lineStart > 0 && !edit.text.slice(0, lineStart).endsWith("\n\n") ? "\n" : "";
  const text = edit.text.slice(0, lineStart) + lead + prefixed + edit.text.slice(lineEnd);
  return { text, start: lineStart + lead.length, end: lineStart + lead.length + prefixed.length };
};

export function applyFormat(edit: Edit, kind: FormatKind): Edit {
  const wrapped = WRAP[kind];
  if (wrapped) return wrap(edit, ...wrapped);
  const selected = edit.text.slice(edit.start, edit.end);
  switch (kind) {
    case "quote":
      return prefixLines(edit, () => "> ", "quote");
    case "bullets":
      return prefixLines(edit, () => "- ", "item");
    case "numbers":
      return prefixLines(edit, (index) => `${index + 1}. `, "item");
    case "header":
      return prefixLines(edit, () => "# ", "Heading");
    case "code":
      // Inline code for a short selection, a fenced block for several lines.
      return selected.includes("\n")
        ? wrap(edit, "\n```\n", "\n```\n", "")
        : wrap(edit, "`", "`", "code");
    case "link": {
      const label = selected || "link text";
      const url = "https://";
      const text =
        edit.text.slice(0, edit.start) + `[${label}](${url})` + edit.text.slice(edit.end);
      // Select the URL so it can be typed over.
      const start = edit.start + label.length + 3;
      return { text, start, end: start + url.length };
    }
    case "rule": {
      const insert = "\n\n---\n\n";
      const text = edit.text.slice(0, edit.end) + insert + edit.text.slice(edit.end);
      const at = edit.end + insert.length;
      return { text, start: at, end: at };
    }
    default:
      return edit;
  }
}
