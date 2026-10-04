import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../extension/bridge";
import { toast } from "./platform";
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
        // No buttons on the page: keep Reddit's reported or API-cast vote.
        if (!value.available && value.vote === null) continue;
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
const fail = (id: string, error: string) => {
  publish(id, { pending: false, fallback: true, error });
  toast(error);
};

/**
 * Vote on a post or comment. `current` and `score` are what the reader shows
 * now; they set the target and the new count when the vote goes through
 * Reddit's API rather than the page's own buttons.
 */
export async function castVote(
  id: string,
  direction: Vote,
  current: Vote,
  score: number,
): Promise<void> {
  if (states.get(id)?.pending) return;
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  publish(id, { pending: true, error: undefined, fallback: false });
  try {
    const result = await bridge<VoteResult>("vote", undefined, {
      thingId: id,
      direction,
      current,
    });
    if (result.status === "changed" && result.via === "api") {
      const target = result.vote ?? 0;
      publish(id, {
        available: true,
        vote: target,
        score: score - current + target,
        pending: false,
        fallback: false,
        error: undefined,
      });
      return;
    }
    if (result.status === "changed") {
      publish(id, { ...result, pending: false, fallback: false, error: undefined });
      return;
    }
    publish(id, { ...result });
    fail(
      id,
      result.status === "unavailable"
        ? "Voting isn’t available here. It may be archived or locked."
        : "Reddit hasn’t confirmed the vote. Check the original page before trying again.",
    );
  } catch (error) {
    fail(
      id,
      error instanceof Error && error.message
        ? error.message
        : "Couldn’t confirm the vote. Check the original page before trying again.",
    );
  }
}
