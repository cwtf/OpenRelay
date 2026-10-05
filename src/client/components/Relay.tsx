// Shared pieces for the account screens, after Relay's layouts: a top app bar
// whose title opens a section picker, a bottom app bar of icon-over-label
// buttons with an optional FAB, per-row action strips, and filled text fields.

import { useEffect, useRef, type ReactNode } from "react";
import { setBottomInset } from "../../extension/bridge";
import { useNav } from "../app/nav";
import { runAction } from "../lib/api";
import { toast } from "../lib/platform";
import { Icon, type IconName } from "./Icon";
import { Sheet, SheetItem } from "./Sheet";

export const ScreenHeader = ({
  title,
  subtitle,
  onTitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  /** Tapping the title opens the section picker, as in Relay. */
  onTitle?: (() => void) | undefined;
  actions?: ReactNode;
}) => {
  const nav = useNav();
  const heading = (
    <>
      <span className="name">{title}</span>
      {subtitle ? (
        <span className="sub">
          {subtitle}
          {onTitle ? <Icon name="chevronDown" size={16} /> : null}
        </span>
      ) : null}
    </>
  );
  return (
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
      {onTitle ? (
        <button
          type="button"
          className="appbar-title"
          data-ripple
          onClick={onTitle}
          aria-label={`${title}${subtitle ? `, ${subtitle}` : ""}. Change section`}
        >
          {heading}
        </button>
      ) : (
        <div className="appbar-title">{heading}</div>
      )}
      {actions}
    </header>
  );
};

export type BarAction = {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

let bars = 0;
/** Lift the page's "Original Reddit" button while any bottom bar is shown. */
const useBottomInset = () =>
  useEffect(() => {
    if (++bars === 1) setBottomInset(56);
    return () => {
      if (--bars === 0) setBottomInset(0);
    };
  }, []);

/** Relay's bottom app bar: evenly spaced icon-over-label buttons. */
export const BottomBar = ({
  actions,
  fab,
  fabIndex = actions.length,
}: {
  actions: BarAction[];
  fab?: BarAction | undefined;
  fabIndex?: number;
}) => {
  useBottomInset();
  const items: ReactNode[] = actions.map((action) => (
    <button
      key={action.label}
      type="button"
      className="bar-btn"
      data-ripple
      disabled={action.disabled}
      onClick={action.onClick}
    >
      <Icon name={action.icon} />
      <span>{action.label}</span>
    </button>
  ));
  if (fab)
    items.splice(
      fabIndex,
      0,
      <button
        key="fab"
        type="button"
        className="fab"
        data-ripple
        aria-label={fab.label}
        title={fab.label}
        disabled={fab.disabled}
        onClick={fab.onClick}
      >
        <Icon name={fab.icon} />
      </button>,
    );
  return (
    <nav className="bottom-bar" aria-label="Actions">
      {items}
    </nav>
  );
};

/** The row of swipe actions Relay reveals on a list item. */
export const ActionStrip = ({ actions }: { actions: BarAction[] }) => (
  <div className="action-strip" onClick={(event) => event.stopPropagation()}>
    {actions.map((action) => (
      <button
        key={action.label}
        type="button"
        className="strip-btn"
        data-ripple
        disabled={action.disabled}
        onClick={action.onClick}
      >
        <Icon name={action.icon} size={20} />
        <span>{action.label}</span>
      </button>
    ))}
  </div>
);

/** Loading, error, empty and paging states; pages load as the end scrolls in. */
export const ListFooter = ({
  status,
  error,
  count,
  hasMore,
  onMore,
  onRetry,
  empty,
}: {
  status: "loading" | "idle" | "more" | "error";
  error: string;
  count: number;
  hasMore: boolean;
  onMore: () => void;
  onRetry: () => void;
  empty: string;
}) => {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || status !== "idle") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, status, onMore]);

  if (status === "loading")
    return (
      <div className="feed-end">
        <div className="spinner" />
      </div>
    );
  if (status === "error")
    return (
      <div className="feed-state">
        <strong>Couldn’t load this list</strong>
        <span>{error}</span>
        <button type="button" className="btn is-tonal" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  if (!count)
    return (
      <div className="feed-state">
        <span>{empty}</span>
      </div>
    );
  return (
    <div className="feed-end" ref={sentinel}>
      {status === "more" ? <div className="spinner" /> : hasMore ? null : "That’s everything"}
    </div>
  );
};

/** Relay's filled text field: 12px corners, a leading icon and a label. */
export const Field = ({
  icon,
  label,
  value,
  onChange,
  multiline,
  max,
  autoFocus,
  type = "text",
  prefix,
}: {
  icon?: IconName;
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  max?: number;
  autoFocus?: boolean;
  type?: "text" | "url";
  prefix?: string;
}) => (
  <label className={`field${multiline ? " is-multiline" : ""}`}>
    {icon ? <Icon name={icon} size={20} /> : null}
    <span className="field-body">
      <span className="field-label">{label}</span>
      <span className="field-input">
        {prefix ? <span className="field-prefix">{prefix}</span> : null}
        {multiline ? (
          <textarea
            value={value}
            maxLength={max}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            type={type}
            value={value}
            maxLength={max}
            autoFocus={autoFocus}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={type !== "url" && !prefix}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </span>
    </span>
    {max ? (
      <span className="field-count">
        {value.length}/{max}
      </span>
    ) : null}
  </label>
);

export type Choice<T extends string> = { value: T; label: string; icon: IconName };

/** A sheet listing Relay's menu entries (sections, sorts, filters). */
export const ChoiceSheet = <T extends string>({
  title,
  choices,
  selected,
  onPick,
  onClosed,
}: {
  title: string;
  choices: Choice<T>[];
  selected: T;
  onPick: (value: T) => void;
  onClosed: () => void;
}) => (
  <Sheet title={title} onClosed={onClosed}>
    {(close) =>
      choices.map((choice) => (
        <SheetItem
          key={choice.value}
          icon={choice.icon}
          label={choice.label}
          selected={choice.value === selected}
          onClick={() => {
            onPick(choice.value);
            close();
          }}
        />
      ))
    }
  </Sheet>
);

/** Ask before an action that cannot be undone from the reader. */
export const ConfirmSheet = ({
  title,
  message,
  confirm,
  onConfirm,
  onClosed,
}: {
  title: string;
  message: string;
  confirm: string;
  onConfirm: () => void;
  onClosed: () => void;
}) => (
  <Sheet title={title} onClosed={onClosed}>
    {(close) => (
      <div className="composer">
        <p style={{ margin: 0, color: "var(--text-2)" }}>{message}</p>
        <div className="row-actions">
          <span className="grow" />
          <button type="button" className="btn is-text" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    )}
  </Sheet>
);

/** Relay's "Mod" swipe action: moderate one post or comment. */
export const ModActionsSheet = ({
  id,
  onClosed,
}: {
  id: string;
  onClosed: () => void;
}) => {
  const act = (op: string, args: Record<string, unknown>, done: string) =>
    runAction(op, { id, ...args })
      .then(() => toast(done))
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : "Reddit could not do that."),
      );
  return (
    <Sheet title="Moderate" onClosed={onClosed}>
      {(close) => (
        <>
          <SheetItem icon="check" label="Approve" onClick={() => { close(); void act("approve", {}, "Approved"); }} />
          <SheetItem icon="removeCircle" label="Remove" onClick={() => { close(); void act("remove", { spam: false }, "Removed"); }} />
          <SheetItem icon="spam" label="Remove as spam" onClick={() => { close(); void act("remove", { spam: true }, "Removed as spam"); }} />
          <SheetItem icon="flag" label="Ignore reports" onClick={() => { close(); void act("ignore_reports", {}, "Reports ignored"); }} />
        </>
      )}
    </Sheet>
  );
};
