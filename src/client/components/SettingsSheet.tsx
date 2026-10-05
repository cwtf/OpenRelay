import { COMMENT_SORTS, type Prefs } from "../../shared/api";
import { usePrefs } from "../app/prefs";
import { sortLabel } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

type Option<T extends string> = { value: T; label: string; icon?: IconName };

const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        className={value === option.value ? "is-selected" : ""}
        onClick={() => onChange(option.value)}
      >
        {option.icon ? (
          <Icon name={value === option.value ? "check" : option.icon} />
        ) : null}
        {option.label}
      </button>
    ))}
  </div>
);

const Toggle = ({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) => (
  <button
    type="button"
    className="setting"
    role="switch"
    aria-checked={value}
    data-ripple
    onClick={() => onChange(!value)}
    style={{ width: "100%" }}
  >
    <span className="label">
      {label}
      {hint ? <small>{hint}</small> : null}
    </span>
    <span className={`switch${value ? " is-on" : ""}`} aria-hidden />
  </button>
);

const selectStyle = {
  background: "var(--surface-2)",
  border: "1px solid var(--outline)",
  borderRadius: 10,
  padding: "8px 10px",
} as const;

type PaneMode = Prefs["paneModePortrait"];

/** Relay's tabletModes list: Auto, Single Pane, Dual Pane. */
const PaneSelect = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PaneMode;
  onChange: (value: PaneMode) => void;
}) => (
  <select
    aria-label={label}
    value={value}
    onChange={(event) => onChange(event.target.value as PaneMode)}
    style={selectStyle}
  >
    <option value="auto">Auto</option>
    <option value="single">Single Pane</option>
    <option value="dual">Dual Pane</option>
  </select>
);

export const SettingsSheet = ({
  onClosed,
  synced,
}: {
  onClosed: () => void;
  synced: boolean;
}) => {
  const { prefs, update } = usePrefs();
  const set =
    <K extends keyof Prefs>(key: K) =>
    (value: Prefs[K]) =>
      update({ [key]: value } as Partial<Prefs>);

  return (
    <Sheet title="Settings" onClosed={onClosed}>
      {() => (
        <>
          <div className="sheet-section">Theme</div>
          <Segmented
            label="Theme"
            value={prefs.theme}
            onChange={set("theme")}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "black", label: "Black" },
            ]}
          />

          <div className="sheet-section">Feed layout</div>
          <div
            className="sheet-grid"
            role="radiogroup"
            aria-label="Feed layout"
          >
            {(
              [
                { value: "cards", label: "Cards", icon: "cards" },
                { value: "compact", label: "Compact", icon: "compact" },
                { value: "list", label: "List", icon: "list" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={prefs.layout === option.value}
                className={`tile${prefs.layout === option.value ? " is-selected" : ""}`}
                data-ripple
                onClick={() => update({ layout: option.value })}
              >
                <Icon name={option.icon} size={28} />
                {option.label}
              </button>
            ))}
          </div>
          <Toggle
            label="Thumbnails"
            hint="Show previews in compact and list layouts"
            value={prefs.showThumbnails}
            onChange={set("showThumbnails")}
          />

          <div className="sheet-section">Single or dual pane</div>
          <label className="setting">
            <span className="label">
              Portrait
              <small>Auto shows posts beside the feed from 840px wide</small>
            </span>
            <PaneSelect
              label="Portrait"
              value={prefs.paneModePortrait}
              onChange={set("paneModePortrait")}
            />
          </label>
          <label className="setting">
            <span className="label">
              Landscape
              <small>Auto shows posts beside the feed from 600px wide</small>
            </span>
            <PaneSelect
              label="Landscape"
              value={prefs.paneModeLandscape}
              onChange={set("paneModeLandscape")}
            />
          </label>

          <div className="sheet-section">Text size</div>
          <div className="range">
            <Icon name="text" size={18} />
            <input
              type="range"
              min={0.85}
              max={1.3}
              step={0.05}
              value={prefs.textScale}
              aria-label="Text size"
              onChange={(event) =>
                update({ textScale: Number(event.target.value) })
              }
            />
            <span
              style={{
                width: 42,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(prefs.textScale * 100)}%
            </span>
          </div>
          <div className="text-preview">
            Comments and posts use this size. Pick whatever is most comfortable
            for long threads.
          </div>

          <div className="sheet-section">Comments</div>
          <Segmented
            label="Depth colours"
            value={prefs.commentColors}
            onChange={set("commentColors")}
            options={[
              { value: "muted", label: "Muted" },
              { value: "vivid", label: "Vivid" },
              { value: "mono", label: "Mono" },
            ]}
          />
          <div
            style={{ display: "flex", gap: 4, padding: "0 20px 10px" }}
            aria-hidden
          >
            {[1, 2, 3, 4, 5, 6, 7].map((level) => (
              <span
                key={level}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: `var(--d${level})`,
                }}
              />
            ))}
          </div>
          <label className="setting">
            <span className="label">Default comment sort</span>
            <select
              value={prefs.commentSort}
              onChange={(event) =>
                update({
                  commentSort: event.target.value as Prefs["commentSort"],
                })
              }
              style={selectStyle}
            >
              {COMMENT_SORTS.map((option) => (
                <option key={option} value={option}>
                  {sortLabel[option]}
                </option>
              ))}
            </select>
          </label>

          <div className="sheet-section">Media</div>
          <Toggle
            label="Blur NSFW previews"
            value={prefs.blurNsfw}
            onChange={set("blurNsfw")}
          />
          <Toggle
            label="Blur spoiler previews"
            value={prefs.blurSpoilers}
            onChange={set("blurSpoilers")}
          />
          <Toggle
            label="Autoplay GIFs"
            hint="Muted loops play only while on screen"
            value={prefs.autoplayGifs}
            onChange={set("autoplayGifs")}
          />

          <div className="sheet-section">Accessibility</div>
          <Toggle
            label="Reduce motion"
            hint="Minimise transitions and animations"
            value={prefs.reduceMotion}
            onChange={set("reduceMotion")}
          />
          <p
            style={{
              padding: "8px 20px 0",
              margin: 0,
              fontSize: 12.5,
              color: "var(--text-3)",
            }}
          >
            {synced
              ? "Settings sync to your Reddit account across devices."
              : "Changes are saved automatically in this browser."}
          </p>
        </>
      )}
    </Sheet>
  );
};
