/**
 * The accounts kept for one site, as the reader stores them: names and
 * pictures only. The sign-ins themselves (cookies) stay with the host
 * (`ReaderHost.accounts`). Pure, so it's unit-tested without the reader.
 */

export type AccountEntry = {
  name: string;
  icon?: string;
  /** The site no longer accepts the saved sign-in; it needs signing in again. */
  expired?: boolean;
};

export type AccountState = {
  /** In the order shown; the first is the default. */
  list: AccountEntry[];
  /** The account the site is signed in with, `null` when signed out. */
  active: string | null;
  /** Signing in to add an account: the next new name is added. */
  adding?: boolean;
};

export const NO_ACCOUNTS: AccountState = { list: [], active: null };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const findAccount = (state: AccountState, name: string): AccountEntry | undefined =>
  state.list.find((entry) => same(entry.name, name));

/** Reads stored state, dropping anything malformed. */
export function parseAccounts(value: unknown): AccountState {
  if (!value || typeof value !== "object") return NO_ACCOUNTS;
  const raw = value as Partial<AccountState>;
  const list: AccountEntry[] = [];
  for (const item of Array.isArray(raw.list) ? raw.list : []) {
    if (!item || typeof item.name !== "string" || !/^[\w-]{1,64}$/.test(item.name)) continue;
    if (findAccount({ list, active: null }, item.name)) continue;
    const entry: AccountEntry = { name: item.name };
    if (typeof item.icon === "string") entry.icon = item.icon;
    if (item.expired === true) entry.expired = true;
    list.push(entry);
  }
  const active =
    typeof raw.active === "string" ? (findAccount({ list, active: null }, raw.active)?.name ?? null) : null;
  return raw.adding === true ? { list, active, adding: true } : { list, active };
}

/**
 * Follows the account the site says is signed in: the one being added, one
 * already listed (signed in on the site itself), or, once there's a list at
 * all, any other. Signed out keeps the list. A single account with no list
 * stays unlisted, so nothing changes until a second one is added.
 */
export function reconcile(
  state: AccountState,
  signedIn: { name: string; icon?: string | undefined } | null,
): AccountState {
  if (!signedIn) return state.active === null ? state : { ...state, active: null };
  const known = findAccount(state, signedIn.name);
  if (!known && !state.adding && !state.list.length) return state;
  const entry: AccountEntry = { name: known?.name ?? signedIn.name };
  const icon = signedIn.icon ?? known?.icon;
  if (icon) entry.icon = icon;
  const list = known
    ? state.list.map((item) => (item === known ? entry : item))
    : [...state.list, entry];
  return { list, active: entry.name };
}

/** Starts adding an account; the one signed in now is listed first so it can be switched back to. */
export function startAdding(
  state: AccountState,
  current: { name: string; icon?: string | undefined } | null,
): AccountState {
  const listed = current ? reconcile({ ...state, adding: true }, current) : state;
  return { list: listed.list, active: null, adding: true };
}

/** The account to switch to, now signed in. */
export const switchedTo = (state: AccountState, name: string): AccountState => ({
  list: state.list.map((item) => (same(item.name, name) && item.expired ? withoutExpired(item) : item)),
  active: findAccount(state, name)?.name ?? null,
});

const withoutExpired = ({ expired: _, ...item }: AccountEntry): AccountEntry => item;

/** Signed out, as when browsing signed out; the list stays. */
export const signedOut = (state: AccountState): AccountState => ({ list: state.list, active: null });

/** Marks a saved sign-in that the site no longer accepts or that's missing. */
export const markExpired = (state: AccountState, name: string): AccountState => ({
  ...state,
  list: state.list.map((item) => (same(item.name, name) ? { ...item, expired: true } : item)),
});

/** Moves an account to the top, making it the default. */
export function makeDefault(state: AccountState, name: string): AccountState {
  const entry = findAccount(state, name);
  if (!entry) return state;
  return { ...state, list: [entry, ...state.list.filter((item) => item !== entry)] };
}

/**
 * Drops an account from the list. The signed-in one can't be removed (the
 * site would still be signed in with it); switch away from it first. Once
 * one account is left, there's nothing to switch between and the list goes.
 */
export function removeAccount(state: AccountState, name: string): AccountState {
  if (state.active && same(state.active, name)) return state;
  const list = state.list.filter((item) => !same(item.name, name));
  if (list.length <= 1 && (!list[0] || (state.active && same(list[0].name, state.active))))
    return { list: [], active: null };
  return { ...state, list };
}

/** The accounts other than the signed-in one, for the drawer's header. */
export const otherAccounts = (state: AccountState): AccountEntry[] =>
  state.list.filter((item) => !state.active || !same(item.name, state.active));
