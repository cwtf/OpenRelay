import { useCallback, useEffect, useRef, useState } from "react";

export type Page<T> = { items: T[]; after: string | null };

type State<T> = {
  items: T[];
  after: string | null;
  status: "loading" | "idle" | "more" | "error";
  error: string;
};

/**
 * A paged Reddit listing. `load` is re-run from the start whenever `key`
 * changes; `more()` appends the next page. Stale responses are ignored.
 */
export function useListing<T>(
  key: string,
  load: (after: string | null) => Promise<Page<T>>,
) {
  const [state, setState] = useState<State<T>>({
    items: [],
    after: null,
    status: "loading",
    error: "",
  });
  const request = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(() => {
    const id = ++request.current;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    loader
      .current(null)
      .then((page) => {
        if (id === request.current)
          setState({ items: page.items, after: page.after, status: "idle", error: "" });
      })
      .catch((err: unknown) => {
        if (id === request.current)
          setState({
            items: [],
            after: null,
            status: "error",
            error: err instanceof Error ? err.message : "Could not load this list.",
          });
      });
  }, []);

  useEffect(() => {
    setState({ items: [], after: null, status: "loading", error: "" });
    reload();
  }, [key, reload]);

  const more = useCallback(() => {
    setState((current) => {
      if (!current.after || current.status !== "idle") return current;
      const id = ++request.current;
      loader
        .current(current.after)
        .then((page) =>
          setState((latest) =>
            id === request.current
              ? {
                  ...latest,
                  items: [...latest.items, ...page.items],
                  after: page.after,
                  status: "idle",
                }
              : latest,
          ),
        )
        .catch(() =>
          setState((latest) =>
            id === request.current ? { ...latest, status: "idle" } : latest,
          ),
        );
      return { ...current, status: "more" };
    });
  }, []);

  /** Update loaded items in place (after an action such as mark-read). */
  const update = useCallback((change: (items: T[]) => T[]) => {
    setState((current) => ({ ...current, items: change(current.items) }));
  }, []);

  return { ...state, reload, more, update };
}
