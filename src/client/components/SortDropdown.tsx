import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FEED_SORTS, TIMEFRAMES, type FeedSort, type Timeframe } from "../../shared/api";
import { sortLabel, timeframeLabel } from "../lib/format";
import { Icon, type IconName } from "./Icon";

const SORT_ICONS: Record<FeedSort, IconName> = {
  hot: "hot",
  new: "new",
  top: "top",
  rising: "rising",
  controversial: "controversial",
};

/** Sorts that also take a timeframe ("Top posts from this week"). */
const timed = (sort: FeedSort) => sort === "top" || sort === "controversial";

type Props = {
  sort: FeedSort;
  timeframe: Timeframe;
  onSort: (sort: FeedSort, timeframe: Timeframe) => void;
};

/** The feed's sort as one chip that opens a menu. Top and Controversial step
    into their timeframes inside the same menu. */
export const SortDropdown = ({ sort, timeframe, onSort }: Props) => {
  const [open, setOpen] = useState(false);
  // The timed sort whose timeframes are showing, or null for the sorts.
  const [step, setStep] = useState<FeedSort | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    setStep(null);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Focus the current choice (or the first item) whenever the list changes.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const target =
      menu?.querySelector<HTMLElement>("[data-current]") ??
      menu?.querySelector<HTMLElement>("[role^='menuitem']");
    target?.focus({ preventScroll: true });
  }, [open, step]);

  const choose = (next: FeedSort, nextTimeframe: Timeframe) => {
    close(true);
    onSort(next, nextTimeframe);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (step) setStep(null);
      else close(true);
      return;
    }
    if (event.key === "ArrowLeft" && step) {
      setStep(null);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = event.key === "ArrowDown" ? 1 : -1;
    items[(at + move + items.length) % items.length]?.focus();
  };

  const label = timed(sort)
    ? `${sortLabel[sort]} · ${timeframeLabel[timeframe]}`
    : sortLabel[sort];

  return (
    <div className="sort-dropdown" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`filter-chip is-selected${open ? " is-open" : ""}`}
        data-ripple
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sort: ${label}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name={SORT_ICONS[sort]} />
        {label}
        <Icon name="chevronDown" size={16} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="sort-menu"
          role="menu"
          aria-label={step ? `${sortLabel[step]} posts from` : "Sort posts"}
          data-no-swipe
        >
          {step ? (
            <>
              <div className="sort-menu-head">
                <button
                  type="button"
                  className="icon-btn"
                  data-ripple
                  aria-label="Back to sorts"
                  onClick={() => setStep(null)}
                >
                  <Icon name="back" size={20} />
                </button>
                {sortLabel[step]} posts from…
              </div>
              {TIMEFRAMES.map((t) => {
                const current = sort === step && timeframe === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`sheet-item${current ? " is-selected" : ""}`}
                    data-ripple
                    role="menuitemradio"
                    aria-checked={current}
                    data-current={current || undefined}
                    onClick={() => choose(step, t)}
                  >
                    <Icon name="clock" />
                    <span className="label">{timeframeLabel[t]}</span>
                    {current ? <Icon name="check" size={20} /> : null}
                  </button>
                );
              })}
            </>
          ) : (
            FEED_SORTS.map((option) => {
              const current = sort === option;
              return timed(option) ? (
                <button
                  key={option}
                  type="button"
                  className={`sheet-item${current ? " is-selected" : ""}`}
                  data-ripple
                  role="menuitem"
                  aria-haspopup="menu"
                  data-current={current || undefined}
                  onClick={() => setStep(option)}
                >
                  <Icon name={SORT_ICONS[option]} />
                  <span className="label">{sortLabel[option]}</span>
                  {current ? (
                    <span className="sort-menu-hint">{timeframeLabel[timeframe]}</span>
                  ) : null}
                  <Icon name="chevronRight" size={18} />
                </button>
              ) : (
                <button
                  key={option}
                  type="button"
                  className={`sheet-item${current ? " is-selected" : ""}`}
                  data-ripple
                  role="menuitemradio"
                  aria-checked={current}
                  data-current={current || undefined}
                  onClick={() => choose(option, timeframe)}
                >
                  <Icon name={SORT_ICONS[option]} />
                  <span className="label">{sortLabel[option]}</span>
                  {current ? <Icon name="check" size={20} /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
};
