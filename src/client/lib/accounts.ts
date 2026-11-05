import { useSyncExternalStore } from "react";
import type { Account } from "../../shared/api";
import { offlineMode, pageUrl } from "../../extension/bridge";
import { REDDIT_HOME, REDDIT_LOGIN, instanceHome } from "../../extension/sources";
import { providerOf } from "../../providers/hosts";
import { readerHost } from "../../hosts/reader";
import { openSource } from "./api";
import {
  NO_ACCOUNTS,
  makeDefault,
  markExpired,
  parseAccounts,
  reconcile,
  removeAccount as dropAccount,
  signedOut,
  startAdding,
  switchedTo,
  type AccountState,
} from "./accountState";
import { flushStorage, readJson, removeKey, watchKey, writeJson } from "./storage";
import { hostKey } from "./site";

/**
 * Switching between accounts, Relay-style. The host keeps each account's
 * sign-in (its cookies for the site) and puts it back on switch; this keeps
 * the names, per site, and reloads the tab so the page, the content script
 * and its modhash all start over signed in as the new account.
 */

const KEY = "accounts";
const keyFor = (host: string) => hostKey(host, KEY);
/** The host name of the site this reader is on; Reddit's hosts share one list. */
const here = (): string => pageUrl.hostname;
const isReddit = (host: string) => providerOf(`https://${host}/`) === "reddit";

export const accountsFor = (host: string): AccountState =>
  parseAccounts(readJson<unknown>(keyFor(host), null));

const listeners = new Set<() => void>();
let cached: AccountState | null = null;
const emit = () => {
  cached = null;
  for (const listener of listeners) listener();
};
const write = (host: string, state: AccountState) => {
  writeJson(keyFor(host), state);
  if (host === here() || (isReddit(host) && isReddit(here()))) emit();
};
const current = (): AccountState => (cached ??= accountsFor(here()));

/** Whether this app can keep more than one account. */
export const canSwitchAccounts = (): boolean => !offlineMode && Boolean(readerHost().accounts);

export const useAccounts = (): AccountState =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    const stop = watchKey(keyFor(here()), emit);
    return () => {
      listeners.delete(listener);
      stop?.();
    };
  }, current);

/**
 * Follows the account the site says is signed in (from `ensureAccount`):
 * finishing an add, or a sign-in made on the site itself. Each account's
 * sign-in is saved again while it's in use, so the copy stays fresh.
 */
export function followSignedIn(account: Account | null): void {
  const sessions = readerHost().accounts;
  if (!sessions || offlineMode) return;
  const before = current();
  const after = reconcile(before, account ? { name: account.name, icon: account.icon } : null);
  if (after !== before) write(here(), after);
  if (account && after.list.length) void sessions.save(here(), after.active ?? account.name).catch(() => undefined);
}

/** Loads the site's front page, or its sign-in page, in this tab. */
async function reload(host: string, login = false): Promise<void> {
  await flushStorage().catch(() => undefined);
  const url = isReddit(host)
    ? login
      ? REDDIT_LOGIN
      : REDDIT_HOME
    : instanceHome(host) + (login ? "login" : "");
  await openSource(url);
}

/** Drops what belongs to the account being left, so the next one loads its own. */
function forgetAccountData(host: string, next: { name: string; icon?: string } | null): void {
  writeJson(hostKey(host, "account"), { at: 0, account: next });
  removeKey(hostKey(host, "subscriptions"));
}

/**
 * Adds an account: saves the current one's sign-in, signs the site out and
 * opens its sign-in page here. The new account is listed when the reader
 * loads again signed in. Call straight from the click handler: the extension
 * asks for cookie access first.
 */
export async function addAccount(host: string, signedIn: Account | null): Promise<"declined" | void> {
  const sessions = readerHost().accounts;
  if (!sessions) return;
  if ((await sessions.allow(host)) === "declined") return "declined";
  if (signedIn) await sessions.save(host, signedIn.name);
  write(host, startAdding(accountsFor(host), signedIn ? { name: signedIn.name, icon: signedIn.icon } : null));
  await sessions.clear(host);
  forgetAccountData(host, null);
  await reload(host, true);
}

/**
 * Switches `host` to a listed account and loads its front page here.
 * `false` when its saved sign-in is gone, which marks it to sign in again.
 */
export async function switchAccount(host: string, name: string): Promise<boolean> {
  const sessions = readerHost().accounts;
  if (!sessions) return false;
  const state = accountsFor(host);
  const entry = state.list.find((item) => item.name === name);
  if (!entry) return false;
  if (state.active) await sessions.save(host, state.active).catch(() => undefined);
  if (!(await sessions.restore(host, name))) {
    write(host, markExpired(state, name));
    return false;
  }
  write(host, switchedTo(state, name));
  forgetAccountData(host, entry.icon ? { name, icon: entry.icon } : { name });
  await reload(host);
  return true;
}

/** Signs the site out here, keeping every account to switch back to. */
export async function browseSignedOut(host: string): Promise<void> {
  const sessions = readerHost().accounts;
  if (!sessions) return;
  const state = accountsFor(host);
  if (state.active) await sessions.save(host, state.active).catch(() => undefined);
  await sessions.clear(host);
  write(host, signedOut(state));
  forgetAccountData(host, null);
  await reload(host);
}

/**
 * Signs in again to an account whose saved sign-in stopped working: as
 * adding, the next sign-in replaces it.
 */
export const signInAgain = (host: string, signedIn: Account | null) => addAccount(host, signedIn);

/** Forgets an account. Once nothing is left to switch between, cookie access is given back. */
export async function removeAccount(host: string, name: string): Promise<void> {
  const sessions = readerHost().accounts;
  const before = accountsFor(host);
  const after = dropAccount(before, name);
  if (after === before) return;
  write(host, after);
  await sessions?.forget(host, name).catch(() => undefined);
  if (!after.list.length) {
    if (before.active) await sessions?.forget(host, before.active).catch(() => undefined);
    await sessions?.revoke?.(host).catch(() => undefined);
  }
}

/**
 * Forgets every account on these sites and gives cookie access back. Each
 * site stays signed in with the account it uses now.
 */
export async function forgetAllAccounts(hosts: string[]): Promise<void> {
  const sessions = readerHost().accounts;
  for (const host of hosts) {
    const state = accountsFor(host);
    if (!state.list.length) continue;
    write(host, NO_ACCOUNTS);
    await sessions?.revoke?.(host).catch(() => undefined);
  }
}

export const makeDefaultAccount = (host: string, name: string): void =>
  write(host, makeDefault(accountsFor(host), name));

/** Whether a stored list has anything to show. */
export const hasAccounts = (state: AccountState): boolean => state.list.length > 0;

export { NO_ACCOUNTS };
