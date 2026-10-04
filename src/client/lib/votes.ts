import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../extension/bridge";
import type { NativeVote, Vote, VoteResult } from "../../extension/votes";

type State = NativeVote & {
  pending: boolean;
  error?: string;
  fallback?: boolean;
};
const empty: State = { available: false, vote: null, pending: false };
const states = new Map<string, State>();
const revisions = new Map<string, number>();
const watchers = new Map<string, Set<() => void>>();
let timer: number | undefined;
let reading = false;
function publish(id: string, patch: Partial<State>) {
  const next = { ...(states.get(id) ?? empty), ...patch };
  if (JSON.stringify(next) === JSON.stringify(states.get(id))) return;
  states.set(id, next);
  watchers.get(id)?.forEach((fn) => fn());
}
async function refresh() {
  if (reading || document.hidden) return;
  const ids = [...watchers.keys()];
  if (!ids.length) return;
  reading = true;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const started = new Map(batch.map((id) => [id, revisions.get(id) ?? 0]));
      const values = await bridge<Record<string, NativeVote>>(
        "vote-status",
        undefined,
        { ids: batch },
      );
      for (const [id, value] of Object.entries(values)) {
        if (
          !states.get(id)?.pending &&
          started.get(id) === (revisions.get(id) ?? 0)
        )
          publish(id, value);
      }
    }
  } catch {
    /* Keep known state; a user action reports its own failure. */
  } finally {
    reading = false;
  }
}
function subscribe(id: string, listener: () => void) {
  let set = watchers.get(id);
  if (!set) {
    set = new Set();
    watchers.set(id, set);
  }
  set.add(listener);
  if (timer === undefined)
    timer = window.setInterval(() => void refresh(), 2000);
  return () => {
    set!.delete(listener);
    if (!set!.size) watchers.delete(id);
    if (!watchers.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
export function useVote(id: string) {
  const state = useSyncExternalStore(
    (fn) => subscribe(id, fn),
    () => states.get(id) ?? empty,
  );
  useEffect(() => {
    void refresh();
  }, [id]);
  return state;
}
export async function castVote(id: string, direction: Vote): Promise<void> {
  if (states.get(id)?.pending) return;
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  publish(id, { pending: true, error: undefined, fallback: false });
  try {
    const result = await bridge<VoteResult>("vote", undefined, {
      thingId: id,
      direction,
    });
    const failed = result.status !== "changed";
    publish(id, {
      ...result,
      pending: false,
      fallback: failed,
      error: failed
        ? result.status === "unavailable"
          ? "This vote control isn’t loaded. Vote on Reddit instead."
          : "Reddit hasn’t confirmed the vote. Check the original page before trying again."
        : undefined,
    });
  } catch {
    publish(id, {
      pending: false,
      fallback: true,
      error:
        "Couldn’t confirm the vote. Check the original page before trying again.",
    });
  }
}
