/**
 * Pure block-level parser for Reddit-flavoured markdown. Kept free of React
 * so it can be unit tested with plain Node.
 */

// ---------------------------------------------------------------------------
// Entities

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      if (value === 0x200b) return '';
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });

// ---------------------------------------------------------------------------
// Block parsing

type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; text: string }
  | { t: 'quote'; children: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: string[]; rows: string[][] };

const BLANK = /^\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s*(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>(?!!)/;
const LIST_ITEM = /^(\s*)([*+-]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const INDENTED = /^( {4}|\t)/;

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const startsBlock = (line: string): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  LIST_ITEM.test(line);

const splitRow = (line: string): string[] => {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
};

export const parseBlocks = (source: string, depth = 0): Block[] => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (BLANK.test(line)) {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence?.[1]) {
      const marker = fence[1];
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        buffer.push(lines[i] ?? '');
        i++;
      }
      i++;
      out.push({ t: 'code', text: buffer.join('\n') });
      continue;
    }

    if (INDENTED.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (INDENTED.test(current)) {
          buffer.push(current.replace(INDENTED, ''));
          i++;
        } else if (BLANK.test(current) && INDENTED.test(lines[i + 1] ?? '')) {
          buffer.push('');
          i++;
        } else break;
      }
      out.push({ t: 'code', text: buffer.join('\n') });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading?.[1]) {
      out.push({ t: 'h', level: heading[1].length, text: heading[2] ?? '' });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (QUOTE.test(current)) {
          buffer.push(current.replace(/^\s{0,3}> ?/, ''));
          i++;
        } else if (
          !BLANK.test(current) &&
          !startsBlock(current) &&
          buffer.length
        ) {
          // Lazy continuation of the quoted paragraph.
          buffer.push(current);
          i++;
        } else break;
      }
      out.push({
        t: 'quote',
        children:
          depth > 12
            ? [{ t: 'p', text: buffer.join('\n') }]
            : parseBlocks(buffer.join('\n'), depth + 1),
      });
      continue;
    }

    if (
      line.includes('|') &&
      TABLE_SEP.test(lines[i + 1] ?? '') &&
      (lines[i + 1] ?? '').includes('-')
    ) {
      const head = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1] ?? '').map((cell) => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        return left && right
          ? 'center'
          : right
            ? 'right'
            : left
              ? 'left'
              : null;
      });
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        !BLANK.test(lines[i] ?? '') &&
        (lines[i] ?? '').includes('|')
      ) {
        rows.push(splitRow(lines[i] ?? ''));
        i++;
      }
      out.push({ t: 'table', align, head, rows });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const baseIndent = item[1]?.length ?? 0;
      const ordered = /\d/.test(item[2] ?? '');
      const start = ordered ? parseInt(item[2] ?? '1', 10) || 1 : 1;
      const items: string[][] = [];
      let current: string[] = [];
      let contentIndent = baseIndent + (item[2]?.length ?? 1) + 1;
      while (i < lines.length) {
        const current_line = lines[i] ?? '';
        const match = current_line.match(LIST_ITEM);
        const indent = indentOf(current_line);
        if (
          match &&
          indent <= baseIndent + 1 &&
          /\d/.test(match[2] ?? '') === ordered
        ) {
          if (current.length) items.push(current);
          current = [match[3] ?? ''];
          contentIndent = indent + (match[2]?.length ?? 1) + 1;
          i++;
          continue;
        }
        if (match && indent <= baseIndent + 1) break; // a different list type
        if (BLANK.test(current_line)) {
          const next = lines[i + 1] ?? '';
          const nextMatch = next.match(LIST_ITEM);
          const continues =
            (nextMatch &&
              indentOf(next) <= baseIndent + 1 &&
              /\d/.test(nextMatch[2] ?? '') === ordered) ||
            (!BLANK.test(next) && indentOf(next) > baseIndent + 1);
          if (!continues) break;
          current.push('');
          i++;
          continue;
        }
        if (indent > baseIndent) {
          current.push(current_line.slice(Math.min(indent, contentIndent)));
          i++;
          continue;
        }
        if (
          !startsBlock(current_line) &&
          current.length &&
          !BLANK.test(current[current.length - 1] ?? '')
        ) {
          current.push(current_line);
          i++;
          continue;
        }
        break;
      }
      if (current.length) items.push(current);
      out.push({
        t: 'list',
        ordered,
        start,
        items: items.map((lines_) =>
          depth > 12
            ? [{ t: 'p', text: lines_.join('\n') }]
            : parseBlocks(lines_.join('\n'), depth + 1)
        ),
      });
      continue;
    }

    const buffer: string[] = [line];
    i++;
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (BLANK.test(current) || startsBlock(current)) break;
      if (current.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) break;
      buffer.push(current);
      i++;
    }
    out.push({ t: 'p', text: buffer.join('\n') });
  }
  return out;
};
