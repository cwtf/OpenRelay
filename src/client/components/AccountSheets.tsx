import type { ReactNode } from "react";
import { pageUrl } from "../../extension/bridge";
import { readerHost } from "../../hosts/reader";
import { useAccount } from "../lib/account";
import type { AccountEntry } from "../lib/accountState";
import {
  accountsFor,
  addAccount,
  forgetAllAccounts,
  makeDefaultAccount,
  removeAccount,
  switchAccount,
  useAccounts,
} from "../lib/accounts";
import { site } from "../lib/api";
import { toast } from "../lib/platform";
import { readJson, writeJson } from "../lib/storage";
import { useSources, type Source } from "../lib/sources";
import { Avatar } from "../screens/FeedScreen";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** The host a source's accounts are kept for; Reddit's hosts share one list. */
export const hostOf = (source: Source): string =>
  source.kind === "lemmy" ? source.id : "www.reddit.com";

/** The host of the site this reader is on. */
export const hereHost = (): string => pageUrl.hostname;

const isExtension = () => readerHost().name === "extension";
const cookieDomain = (host: string) => (host.endsWith("reddit.com") ? "reddit.com" : host);

/** An account name as its own site shows it; the reader only knows its own site's style. */
export const nameOn = (host: string, name: string) =>
  host === hereHost() ? site.userLabel(name) : name;

const failed = (error: unknown, fallback: string) =>
  toast(error instanceof Error ? error.message : fallback);

export const AccountAvatar = ({
  entry,
  size,
}: {
  entry: AccountEntry;
  size?: "small" | "large";
}) => <Avatar name={entry.name} size={size} src={entry.icon} />;

/**
 * Switches `host` to `name`. The extension's first switch explains that the
 * browser keeps one sign-in per site, so every tab of it switches too.
 */
export function switchTo(
  openSheet: (render: (onClosed: () => void) => ReactNode) => void,
  host: string,
  name: string,
): void {
  const run = () =>
    void switchAccount(host, name)
      .then((switched) => {
        if (!switched) toast(`Sign in to ${site.userLabel(name)} again`);
      })
      .catch((error: unknown) => failed(error, "Could not switch accounts"));
  if (!isExtension() || readJson("account-switch-seen", false)) return run();
  openSheet((onClosed) => <SwitchNoticeSheet name={name} onSwitch={run} onClosed={onClosed} />);
}

const SwitchNoticeSheet = ({
  name,
  onSwitch,
  onClosed,
}: {
  name: string;
  onSwitch: () => void;
  onClosed: () => void;
}) => (
  <Sheet title={`Switch to ${site.userLabel(name)}?`} onClosed={onClosed}>
    {(close) => (
      <>
        <p className="account-note is-warning">
          <Icon name="info" size={20} />
          <span>
            Your browser keeps one {site.name} sign-in, so every {site.name} tab in
            this window switches too. Other tabs change the next time they load.
          </span>
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn is-text" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              writeJson("account-switch-seen", true);
              close();
              onSwitch();
            }}
          >
            Switch
          </button>
        </div>
      </>
    )}
  </Sheet>
);

/**
 * Explains adding an account before the sign-in page opens, and on the
 * extension, before the browser asks for cookie access.
 */
export const AddAccountSheet = ({ onClosed }: { onClosed: () => void }) => {
  const account = useAccount();
  const host = hereHost();
  return (
    <Sheet title={`Add a ${site.name} account`} onClosed={onClosed}>
      {(close) => (
        <>
          <p className="sheet-text">
            {site.name}'s sign-in page opens in this tab. When you're back, the
            account is in the drawer.
            {account ? ` ${site.userLabel(account.name)} stays saved on this device.` : ""}
          </p>
          <p className="account-note">
            <Icon name="lock" size={20} />
            <span>
              OpenRelay never sees your password. It keeps each account's{" "}
              {site.name} sign-in cookies on this device only
              {isExtension()
                ? `, and your browser asks to let it manage ${cookieDomain(host)} cookies.`
                : "."}
            </span>
          </p>
          <div className="sheet-actions">
            <button type="button" className="btn is-text" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                // No await before this: the browser's prompt needs the click.
                void addAccount(host, account)
                  .then((result) => {
                    if (result === "declined")
                      toast(`Allow cookie access to keep more than one ${site.name} account`);
                    else close();
                  })
                  .catch((error: unknown) => failed(error, "Could not add the account"));
              }}
            >
              Continue to {site.name}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
};

/** Settings › Accounts: every site's accounts, to reorder, remove or sign in again. */
export const AccountsSheet = ({
  onClosed,
  openSheet,
}: {
  onClosed: () => void;
  openSheet: (render: (onClosed: () => void) => ReactNode) => void;
}) => {
  const here = useAccounts();
  const sources = useSources();
  const hosts = [...new Set([hereHost(), ...sources.map(hostOf)])];
  const sites = hosts
    .map((host) => ({
      host,
      label: sources.find((source) => hostOf(source) === host)?.label ?? host,
      state: host === hereHost() ? here : accountsFor(host),
    }))
    .filter((entry) => entry.state.list.length);
  return (
    <Sheet title="Accounts" onClosed={onClosed}>
      {(close) => (
        <>
          {!sites.length ? (
            <p className="sheet-text">
              Add a second account from the drawer: tap your name at the top.
            </p>
          ) : null}
          {sites.map(({ host, label, state }) => (
            <div key={host}>
              <div className="sheet-section">{label}</div>
              {state.list.map((entry, index) => {
                const active = entry.name === state.active;
                return (
                  <div className="account-row" key={entry.name}>
                    <AccountAvatar entry={entry} size="small" />
                    <span className="label">
                      {nameOn(host, entry.name)}
                      <small className={entry.expired ? "is-error" : undefined}>
                        {active
                          ? index === 0
                            ? "Signed in · default"
                            : "Signed in"
                          : entry.expired
                            ? "Signed out by the site"
                            : index === 0
                              ? "Default"
                              : ""}
                      </small>
                    </span>
                    {entry.expired && host === hereHost() ? (
                      <button
                        type="button"
                        className="btn is-tonal is-small"
                        onClick={() => {
                          close();
                          openSheet((onSheetClosed) => <AddAccountSheet onClosed={onSheetClosed} />);
                        }}
                      >
                        Sign in again
                      </button>
                    ) : null}
                    {index > 0 ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Make ${site.userLabel(entry.name)} the default`}
                        title="Make default"
                        onClick={() => makeDefaultAccount(host, entry.name)}
                      >
                        <Icon name="pin" size={20} />
                      </button>
                    ) : null}
                    {!active ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${site.userLabel(entry.name)}`}
                        title="Remove"
                        onClick={() => void removeAccount(host, entry.name)}
                      >
                        <Icon name="trash" size={20} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {isExtension() && sites.length ? (
            <>
              <div className="sheet-section">Cookie access</div>
              <div className="account-row">
                <span className="label">
                  Used only to switch accounts
                  <small>
                    Revoking forgets every saved account. Each site stays signed in
                    with the account it uses now.
                  </small>
                </span>
                <button
                  type="button"
                  className="btn is-tonal is-small"
                  onClick={() =>
                    void forgetAllAccounts(sites.map((entry) => entry.host)).then(() =>
                      toast("Saved accounts forgotten"),
                    )
                  }
                >
                  Revoke
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  );
};
