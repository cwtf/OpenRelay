import { useEffect, useRef, useState } from "react";
import type { PostSummary, SearchSort } from "../../shared/api";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { Icon } from "../components/Icon";
import { PostCard } from "../components/PostCard";
import { fetchSearch, entryRoute } from "../lib/api";
import { sortLabel } from "../lib/format";
import { readJson, writeJson } from "../lib/storage";

const SORTS: SearchSort[] = ["relevance", "new", "top", "comments"];

export const SearchScreen = ({ sub }: { sub: string }) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const [draft, setDraft] = useState(entryRoute.query ?? "");
  const [query, setQuery] = useState(entryRoute.query ?? "");
  const [sort, setSort] = useState<SearchSort>(
    SORTS.includes(entryRoute.searchSort as SearchSort)
      ? (entryRoute.searchSort as SearchSort)
      : "relevance",
  );
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>(() =>
    readJson<string[]>("search-history", []),
  );
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 340);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!query) return;
    const id = ++request.current;
    fetchSearch(sub, query, sort)
      .then((page) => {
        if (id !== request.current) return;
        setPosts(page.posts);
        setAfter(page.after);
        setStatus("idle");
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        setError(err instanceof Error ? err.message : "Search failed");
        setStatus("error");
      });
  }, [sub, query, sort]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    input.current?.blur();
    if (trimmed !== query) {
      setStatus("loading");
      setPosts([]);
    }
    setQuery(trimmed);
    const next = [
      trimmed,
      ...history.filter((entry) => entry !== trimmed),
    ].slice(0, 8);
    setHistory(next);
    writeJson("search-history", next);
  };

  const more = () => {
    if (!after || status !== "idle") return;
    const id = ++request.current;
    setStatus("more");
    fetchSearch(sub, query, sort, after)
      .then((page) => {
        if (id !== request.current) return;
        setPosts((current) => {
          const seen = new Set(current.map((post) => post.id));
          return [
            ...current,
            ...page.posts.filter((post) => !seen.has(post.id)),
          ];
        });
        setAfter(page.after);
        setStatus("idle");
      })
      .catch(() => {
        if (id === request.current) setStatus("idle");
      });
  };

  return (
    <>
      <header className="appbar is-static is-raised">
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Back"
          onClick={nav.back}
        >
          <Icon name="back" />
        </button>
        <form
          style={{ flex: 1, display: "flex" }}
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <input
            ref={input}
            className="appbar-search"
            type="search"
            enterKeyHint="search"
            placeholder={`Search r/${sub}`}
            value={draft}
            aria-label={`Search r/${sub}`}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        {draft ? (
          <button
            type="button"
            className="icon-btn"
            data-ripple
            aria-label="Clear"
            onClick={() => {
              setDraft("");
              input.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </header>
      <div className="scroller">
        <div
          className="feed"
          data-layout={prefs.layout}
          style={{ paddingTop: 8 }}
        >
          {query ? (
            <nav className="sort-strip" aria-label="Sort results">
              {SORTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`filter-chip${sort === option ? " is-selected" : ""}`}
                  data-ripple
                  aria-pressed={sort === option}
                  onClick={() => {
                    if (option === sort) return;
                    setStatus("loading");
                    setPosts([]);
                    setSort(option);
                  }}
                >
                  {sort === option ? <Icon name="check" /> : null}
                  {sortLabel[option]}
                </button>
              ))}
            </nav>
          ) : history.length ? (
            <>
              <div className="sheet-section">Recent searches</div>
              <div className="sort-strip" style={{ flexWrap: "wrap" }}>
                {history.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="filter-chip"
                    data-ripple
                    onClick={() => {
                      setDraft(entry);
                      submit(entry);
                    }}
                  >
                    <Icon name="clock" /> {entry}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="feed-state">
              <div className="glyph">
                <Icon name="search" size={30} />
              </div>
              <strong>Search r/{sub}</strong>
              <span>Find posts by title and text.</span>
            </div>
          )}

          {status === "loading" ? (
            <div className="feed-end">
              <div className="spinner" />
            </div>
          ) : null}
          {status === "error" ? <div className="feed-end">{error}</div> : null}
          {query && status === "idle" && !posts.length ? (
            <div className="feed-state">
              <strong>No results</strong>
              <span>
                Nothing in r/{sub} matched “{query}”.
              </span>
            </div>
          ) : null}
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              layout={prefs.layout}
              showThumbnails={prefs.showThumbnails}
              showSub={false}
            />
          ))}
          {after && posts.length ? (
            <div className="feed-end">
              <button
                type="button"
                className="btn is-tonal"
                data-ripple
                onClick={more}
                disabled={status === "more"}
              >
                {status === "more" ? "Loading…" : "More results"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};
