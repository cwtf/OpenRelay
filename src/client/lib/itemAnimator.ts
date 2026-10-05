/**
 * List change animations modelled on RecyclerView's default item animator:
 * removed rows fade out (120ms), surviving rows then slide to their new
 * position (250ms), and added rows fade in once the moves have finished
 * (120ms). Rows opt in with a `data-anim-key` attribute.
 */

const FADE_MS = 120;
const MOVE_MS = 250;
const EASING = 'cubic-bezier(0.45, 0, 0.55, 1)'; // accelerate_decelerate
const KEYED = '[data-anim-key]';

export type LayoutSnapshot = Map<string, number>;

const reducedMotion = (): boolean => {
  if (document.documentElement.dataset.motion === 'reduced') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const nearViewport = (rect: DOMRect): boolean => {
  const height = window.innerHeight;
  return rect.bottom > -height * 0.25 && rect.top < height * 1.25;
};

/** Record where keyed rows near the viewport currently sit. */
export const snapshotLayout = (root: HTMLElement): LayoutSnapshot => {
  const positions: LayoutSnapshot = new Map();
  if (reducedMotion()) return positions;
  for (const el of root.querySelectorAll<HTMLElement>(KEYED)) {
    const rect = el.getBoundingClientRect();
    const key = el.dataset.animKey;
    if (key && nearViewport(rect)) positions.set(key, rect.top);
  }
  return positions;
};

/** Animate keyed rows from a snapshot to their current layout. */
export const animateLayout = (
  root: HTMLElement,
  before: LayoutSnapshot
): void => {
  if (!before.size || reducedMotion()) return;
  let moved = false;
  const added: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(KEYED)) {
    const rect = el.getBoundingClientRect();
    if (!nearViewport(rect)) continue;
    const previous = el.dataset.animKey
      ? before.get(el.dataset.animKey)
      : undefined;
    if (previous === undefined) {
      added.push(el);
      continue;
    }
    const dy = previous - rect.top;
    if (Math.abs(dy) < 1) continue;
    moved = true;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
      {
        duration: MOVE_MS,
        easing: EASING,
      }
    );
  }
  const delay = moved ? MOVE_MS : 0;
  for (const el of added) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_MS,
      delay,
      easing: EASING,
      fill: 'backwards',
    });
  }
};

/** Fade rows out before they are removed. Resolves when done. */
export const fadeOutRows = async (rows: HTMLElement[]): Promise<void> => {
  if (!rows.length || reducedMotion()) return;
  const fades = Promise.all(
    rows.map(
      (el) =>
        el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: FADE_MS,
          easing: EASING,
          fill: 'forwards',
        }).finished
    )
  );
  // Animations stall in background tabs; never let that block the update.
  const timeout = new Promise<void>((resolve) =>
    window.setTimeout(resolve, FADE_MS + 60)
  );
  try {
    await Promise.race([fades, timeout]);
  } catch {
    // Cancelled animations are fine; the rows are about to unmount.
  }
};

/**
 * Rows that visually belong to a comment's subtree: the following siblings
 * with a deeper `data-level`, limited to those that are on or near screen.
 */
export const subtreeRows = (root: HTMLElement, id: string): HTMLElement[] => {
  const head = root.querySelector<HTMLElement>(
    `[data-cid="${CSS.escape(id)}"]`
  );
  if (!head) return [];
  // Rows may be wrapped (e.g. in a swipe container): walk the list's own
  // children, reading each row's level from itself or the row inside it.
  let row: HTMLElement = head;
  while (row.parentElement && row.parentElement !== root) row = row.parentElement;
  const levelOf = (el: HTMLElement) =>
    Number(el.dataset.level ?? el.querySelector<HTMLElement>('[data-level]')?.dataset.level);
  const level = Number(head.dataset.level);
  const rows: HTMLElement[] = [];
  let next = row.nextElementSibling as HTMLElement | null;
  while (next && levelOf(next) > level) {
    const rect = next.getBoundingClientRect();
    if (rect.top > window.innerHeight * 1.25) break;
    if (nearViewport(rect)) rows.push(next);
    next = next.nextElementSibling as HTMLElement | null;
  }
  return rows;
};
