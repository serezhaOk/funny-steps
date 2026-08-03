// Supabase auth: Google OAuth and passwordless email links.
//
// The publishable (anon) key is meant to ship in the client — every table is
// protected by row level security on the server, so this key alone grants no
// access to anyone else's rows. See supabase/schema.sql.

import {
  createClient,
  isAuthRetryableFetchError,
  type Session,
} from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iayngkirvbjlsmgtymnl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9cBv22ifdlp-nFn_d4VhoQ_qoNoQOvF';

// Our own storage key, so we can read the cached session before the client
// boots. Sessions written under the library's default key are migrated once.
const STORAGE_KEY = 'sqia-auth';
const LEGACY_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

try {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && !localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, legacy);
  }
} catch {
  // Private mode with storage disabled: sign-in still works for this visit.
}

// Why the last refresh was turned down, straight from the server. The client
// reports a rejected refresh as a plain signed-out state with no reason
// attached, and the reason is the whole diagnosis: "Already Used" means two
// refreshes raced, "session expired" means a session policy ended it.
let refreshRejection: string | null = null;

async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
  if (!res.ok && url.includes('/auth/v1/token')) {
    try {
      const body = (await res.clone().json()) as {
        error_description?: string;
        msg?: string;
        message?: string;
      };
      refreshRejection =
        body.error_description ?? body.msg ?? body.message ?? `HTTP ${res.status}`;
    } catch {
      refreshRejection = `HTTP ${res.status}`;
    }
  }
  return res;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: trackedFetch },
  auth: {
    storageKey: STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Is a session cached on this device? Read straight from storage, with no
 * network round trip, so a returning user goes to the library instead of
 * watching the sign-in screen while the token is confirmed.
 */
export function peekSession(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { refresh_token?: unknown };
    return typeof parsed?.refresh_token === 'string';
  } catch {
    return false;
  }
}

/** Where the provider sends the user back — works on Pages and locally. */
const redirectTo = () => `${location.origin}${location.pathname}`;

let session: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function currentSession(): Session | null {
  return session;
}

export function isSignedIn(): boolean {
  return session !== null;
}

export function onAuthChange(fn: (s: Session | null) => void): void {
  listeners.add(fn);
  fn(session);
}

/**
 * Providers report failures by redirecting back with error params (in the
 * query string, the hash, or both). Pull the message out so the UI can show
 * it instead of silently bouncing to the sign-in form.
 */
export function consumeAuthError(): string | null {
  const fromQuery = new URLSearchParams(location.search);
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const desc =
    fromQuery.get('error_description') ?? fromHash.get('error_description');
  const code = fromQuery.get('error_code') ?? fromHash.get('error_code');
  const err = fromQuery.get('error') ?? fromHash.get('error');
  if (!desc && !err) return null;
  history.replaceState(null, '', redirectTo());
  const text = decodeURIComponent(desc ?? err ?? 'Sign-in failed');
  return code ? `${text} (${code})` : text;
}

let retryArmed = false;

function retryWhenOnline(): void {
  if (retryArmed) return;
  retryArmed = true;
  window.addEventListener(
    'online',
    () => {
      retryArmed = false;
      void supabase.auth.refreshSession();
    },
    { once: true }
  );
}

// Losing a stored session is otherwise silent — the user just meets the
// sign-in screen again with no idea why. Record the reason so the landing
// can show it, and so we can tell a rejected refresh token (a server-side
// session policy) apart from a signing-out user.
const ISSUE_KEY = 'sqia-auth-issue';
let signingOut = false;

function noteIssue(reason: string): void {
  try {
    localStorage.setItem(ISSUE_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    // Nothing to report from if storage is unavailable.
  }
}

/** Why the last session ended, if it ended on its own. Reads once. */
export function consumeAuthIssue(): string | null {
  try {
    const raw = localStorage.getItem(ISSUE_KEY);
    if (!raw) return null;
    localStorage.removeItem(ISSUE_KEY);
    const { reason, at } = JSON.parse(raw) as { reason: string; at: number };
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins > 24 * 60) return null; // too old to be about this visit
    const when = mins < 2 ? 'just now' : `${mins} min ago`;
    return `Session ended ${when}: ${reason}`;
  } catch {
    return null;
  }
}

/** Read any existing session and keep it in sync from then on. */
export async function initAuth(): Promise<void> {
  const cached = peekSession();
  // Past its hour, getSession() spends the refresh token to mint a new one.
  // That is the step that quietly fails, so keep hold of the error.
  const { data, error } = await supabase.auth.getSession();
  session = data.session;
  if (!session && cached && isAuthRetryableFetchError(error)) {
    // The refresh never reached the server, so nothing says the stored
    // sign-in is bad. Keep quiet and try again instead of announcing a
    // signed-out state the user would see as the sign-in screen.
    retryWhenOnline();
    setTimeout(() => void supabase.auth.refreshSession(), 5_000);
    setTimeout(() => void supabase.auth.refreshSession(), 20_000);
  } else {
    if (cached && !session) {
      noteIssue(
        refreshRejection ?? error?.message ?? 'the stored sign-in was rejected'
      );
    }
    listeners.forEach((fn) => fn(session));
  }
  supabase.auth.onAuthStateChange((event, s) => {
    // A token refresh that failed because the device is offline must not
    // throw the user back to the sign-in screen: the refresh token on disk
    // is still good, so hold the session and retry once we're back.
    if (!s && session && !navigator.onLine) {
      retryWhenOnline();
      return;
    }
    if (!s && event !== 'SIGNED_OUT' && event !== 'INITIAL_SESSION') return;
    if (!s && session && !signingOut) {
      noteIssue(refreshRejection ?? 'this device’s sign-in was rejected');
    }
    session = s;
    listeners.forEach((fn) => fn(session));
  });
  // Drop the OAuth fragment so a refresh doesn't re-parse a used token.
  if (location.hash.includes('access_token')) {
    history.replaceState(null, '', redirectTo());
  }
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
  });
  if (error) throw error;
}

/** Passwordless: Supabase emails a sign-in link back to the app. */
export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  signingOut = true;
  try {
    // Local only: ending every session would sign the user's other devices
    // out too, which is not what the menu item says.
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    signingOut = false;
  }
}
