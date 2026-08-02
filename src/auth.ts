// Supabase auth: Google OAuth and passwordless email links.
//
// The publishable (anon) key is meant to ship in the client — every table is
// protected by row level security on the server, so this key alone grants no
// access to anyone else's rows. See supabase/schema.sql.

import { createClient, type Session } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iayngkirvbjlsmgtymnl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9cBv22ifdlp-nFn_d4VhoQ_qoNoQOvF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

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

/** Read any existing session and keep it in sync from then on. */
export async function initAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  listeners.forEach((fn) => fn(session));
  supabase.auth.onAuthStateChange((_event, s) => {
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
  await supabase.auth.signOut();
}
