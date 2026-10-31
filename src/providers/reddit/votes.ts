export type Vote = -1 | 0 | 1;
export type NativeVote = {
  available: boolean;
  vote: Vote | null;
  score?: number;
};
export type VoteResult = NativeVote & {
  /** `missing`: Reddit's vote buttons for this item are not on the page. */
  status: "changed" | "unavailable" | "missing" | "unconfirmed" | "busy";
  /** Set when the vote was sent through Reddit's API instead of a click. */
  via?: "api";
};
export const isThingId = (value: unknown): value is string =>
  typeof value === "string" && /^t[13]_[a-z0-9]+$/i.test(value);

const ownerSelector =
  "shreddit-post, shreddit-comment, shreddit-comment-action-row, .thing.link, .thing.comment";
const identity = (el: Element) => {
  for (const name of ["thingid", "data-fullname", "id"]) {
    const value = el.getAttribute(name);
    if (isThingId(value)) return value;
  }
  return null;
};
function parent(el: Element): Element | null {
  return (
    el.parentElement ??
    (el.getRootNode() instanceof ShadowRoot
      ? (el.getRootNode() as ShadowRoot).host
      : null)
  );
}
/** Stay within the exact post/comment, including across open shadow boundaries. */
function belongsTo(el: Element, id: string): boolean {
  for (let current: Element | null = el; current; current = parent(current)) {
    if (current.matches(ownerSelector)) {
      const found = identity(current);
      if (found) return found === id;
    }
  }
  return false;
}
function deepQuery(root: ParentNode, selector: string): Element[] {
  const result = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) result.push(...deepQuery(el.shadowRoot, selector));
  }
  return result;
}
type Controls = { owner: Element; up: HTMLElement; down: HTMLElement };
function controls(doc: Document, id: string): Controls | null {
  // Restrict traversal to native Reddit things, never the reader's iframe.
  const owners = [...doc.querySelectorAll(ownerSelector)].filter(
    (el) => identity(el) === id,
  );
  for (const owner of owners) {
    const candidates = [
      ...deepQuery(owner, "button, .arrow"),
      ...(owner.shadowRoot
        ? deepQuery(owner.shadowRoot, "button, .arrow")
        : []),
    ].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && belongsTo(el, id),
    );
    const match = (el: HTMLElement, direction: "up" | "down") => {
      if (el.classList.contains("arrow"))
        return (
          el.classList.contains(direction) ||
          el.classList.contains(direction + "mod")
        );
      const label = el.getAttribute("aria-label")?.trim().toLowerCase() ?? "";
      return (
        el.hasAttribute(direction + "vote") ||
        label === direction + "vote" ||
        label === "undo " + direction + "vote" ||
        label === "remove " + direction + "vote"
      );
    };
    const up = candidates.find((el) => match(el, "up"));
    const down = candidates.find((el) => match(el, "down"));
    if (up && down) return { owner, up, down };
  }
  return null;
}
function read(c: Controls | null): NativeVote {
  if (!c) return { available: false, vote: null };
  const { up, down, owner } = c;
  let vote: Vote | null = null;
  if (
    up.classList.contains("upmod") ||
    up.getAttribute("aria-pressed") === "true"
  )
    vote = 1;
  else if (
    down.classList.contains("downmod") ||
    down.getAttribute("aria-pressed") === "true"
  )
    vote = -1;
  else if (
    (up.classList.contains("up") && down.classList.contains("down")) ||
    (up.getAttribute("aria-pressed") === "false" &&
      down.getAttribute("aria-pressed") === "false")
  )
    vote = 0;
  if (vote === null) {
    for (const name of ["vote-state", "vote-type"]) {
      const value = owner.getAttribute(name)?.toLowerCase();
      if (["up", "upvote", "1"].includes(value ?? "")) vote = 1;
      if (["down", "downvote", "-1"].includes(value ?? "")) vote = -1;
      if (["none", "neutral", "0", ""].includes(value ?? "missing")) vote = 0;
    }
  }
  const disabled = [up, down].some(
    (el) =>
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true",
  );
  // Old Reddit exposes separate counts for each vote state; modern controls may
  // render their live number inside their shadow tree instead of on the host.
  const scoreClass =
    vote === 1 ? "likes" : vote === -1 ? "dislikes" : "unvoted";
  const oldScore = [...owner.querySelectorAll(".score." + scoreClass)].find(
    (el) => belongsTo(el, identity(owner)!),
  );
  const counter = [
    ...(up.getRootNode() as Document | ShadowRoot).querySelectorAll(
      "faceplate-number[number]",
    ),
  ].find((el) => belongsTo(el, identity(owner)!));
  const rawCount = oldScore?.getAttribute("title") ?? oldScore?.textContent;
  const scoreText =
    counter?.getAttribute("number") ??
    rawCount
      ?.trim()
      .match(/^-?[\d,]+(?= points?$|$)/)?.[0]
      ?.replaceAll(",", "") ??
    owner.getAttribute("score") ??
    owner.getAttribute("data-score");
  const score =
    scoreText !== null && /^-?\d+$/.test(scoreText)
      ? Number(scoreText)
      : undefined;
  return {
    available: !disabled && vote !== null,
    vote,
    ...(score !== undefined ? { score } : {}),
  };
}
export const readNativeVote = (doc: Document, id: string): NativeVote =>
  isThingId(id) ? read(controls(doc, id)) : { available: false, vote: null };

const pending = new Set<string>();
export async function forwardVote(
  doc: Document,
  thingId: unknown,
  direction: unknown,
): Promise<VoteResult> {
  if (!isThingId(thingId) || (direction !== 1 && direction !== -1))
    throw new Error("Invalid vote request");
  if (pending.has(thingId))
    return { ...readNativeVote(doc, thingId), status: "busy" };
  const c = controls(doc, thingId);
  const before = read(c);
  if (!c) return { ...before, status: "missing" };
  if (!before.available) return { ...before, status: "unavailable" };
  pending.add(thingId);
  try {
    const expected = before.vote === direction ? 0 : direction;
    // One native click only. No token access, API write, synthetic retry or page-world code.
    (direction === 1 ? c.up : c.down).click();
    const started = Date.now();
    let matchedAt = 0;
    while (Date.now() - started < 2200) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = readNativeVote(doc, thingId);
      if (state.vote === expected) {
        matchedAt ||= Date.now();
        // Wait for quick native rollbacks. Later changes are synchronized by read-only polling.
        if (Date.now() - matchedAt >= 500)
          return { ...state, status: "changed" };
      } else matchedAt = 0;
    }
    return { ...readNativeVote(doc, thingId), status: "unconfirmed" };
  } finally {
    pending.delete(thingId);
  }
}
