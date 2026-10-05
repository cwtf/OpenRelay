import { useSyncExternalStore } from "react";

/** Relay's per-orientation "Single or Dual Pane" setting. */
export type PaneMode = "auto" | "single" | "dual";

export type PaneLayout = {
  /** Listing on the left, opened post on the right. */
  dual: boolean;
  /** Relay switches from a 50:50 to a 42:58 split at 900dp. */
  wide: boolean;
};

const SINGLE: PaneLayout = { dual: false, wide: false };

/**
 * Relay's tablet rules (reddit.news `aa2.A` + `bool/isDualPane`), with CSS
 * pixels standing in for dp. Portrait is height >= width, as in Relay.
 * - Auto: dual from 840 wide, or in landscape from 600 wide when the
 *   shorter side is at least 480.
 * - Dual: dual whenever the window is at least 600 wide.
 * - Single: never dual.
 */
export const paneLayout = (
  width: number,
  height: number,
  modes: { portrait: PaneMode; landscape: PaneMode },
): PaneLayout => {
  const portrait = height >= width;
  const mode = portrait ? modes.portrait : modes.landscape;
  const dual =
    mode === "dual"
      ? width >= 600
      : mode === "auto"
        ? width >= 840 ||
          (!portrait && Math.min(width, height) >= 480 && width >= 600)
        : false;
  return dual ? { dual, wide: width >= 900 } : SINGLE;
};

// ------------------------------------------------------------------ window size

type Size = { width: number; height: number };

let size: Size = { width: 0, height: 0 };
const readSize = (): Size => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width !== size.width || height !== size.height) size = { width, height };
  return size;
};

const subscribeSize = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};

export const useWindowSize = (): Size =>
  useSyncExternalStore(subscribeSize, readSize);

// ------------------------------------------------------------------ selection

/** The post shown in the right-hand pane, highlighted in the listing. */
let selected: string | null = null;
const selectionListeners = new Set<() => void>();

export const setSelectedPost = (id: string | null): void => {
  if (id === selected) return;
  selected = id;
  for (const listener of selectionListeners) listener();
};

const subscribeSelection = (notify: () => void) => {
  selectionListeners.add(notify);
  return () => {
    selectionListeners.delete(notify);
  };
};

export const useIsSelectedPost = (id: string): boolean =>
  useSyncExternalStore(subscribeSelection, () => selected === id);
