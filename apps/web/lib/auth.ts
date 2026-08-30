import { API } from './env';

export type AuthUser = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  locale: string;
};

export type Providers = { google: boolean; devUser: boolean };

/**
 * The access token lives here - a module variable, not React state and not
 * storage.
 *
 * `localStorage` would survive a tab close, which sounds convenient and is
 * exactly the problem: anything that manages to run script on the page can
 * read it. Memory dies with the tab, and the refresh cookie (which script
 * cannot touch) is what brings the session back. That is the whole reason the
 * cookie is httpOnly and the token is not.
 *
 * It is a module singleton rather than context because `call()` in api.ts is a
 * plain function, not a hook - the same reasoning as AsyncLocalStorage on the
 * API. React subscribes to it through `useSyncExternalStore`.
 */
let accessToken: string | null = null;
let user: AuthUser | null = null;
let ready = false;

const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  // A new object each time, so useSyncExternalStore sees a changed snapshot.
  snapshot = { user, ready };
  for (const l of listeners) l();
}

let snapshot: { user: AuthUser | null; ready: boolean } = { user, ready };

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  return snapshot;
}

/** Server render has no session; this must be referentially stable. */
const SERVER_SNAPSHOT = { user: null, ready: false };
export function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

export function getToken(): string | null {
  return accessToken;
}

function setSession(
  token: string | null,
  nextUser: AuthUser | null,
  expiresIn?: number,
): void {
  accessToken = token;
  user = nextUser;
  ready = true;

  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;

  // Renew a minute early rather than waiting for a 401. Without this, someone
  // reading a chapter for fifteen minutes gets a failed request the moment
  // they act - the retry would recover it, but the pause is visible.
  if (token && expiresIn && expiresIn > 90) {
    refreshTimer = setTimeout(() => void refresh(), (expiresIn - 60) * 1000);
  }

  emit();
}

let inflight: Promise<string | null> | null = null;

/**
 * Trade the refresh cookie for an access token.
 *
 * Single-flighted: three components mounting at once, or a burst of parallel
 * requests all hitting 401, must not each rotate the token. Rotation
 * invalidates the previous token, so concurrent refreshes would look exactly
 * like the reuse-detection case on the API and log the user out.
 */
export function refresh(): Promise<string | null> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // the whole point - send the httpOnly cookie
        cache: 'no-store',
      });

      if (!res.ok) {
        setSession(null, null);
        return null;
      }

      const body = (await res.json()) as {
        accessToken: string;
        expiresIn: number;
        user: AuthUser;
      };
      setSession(body.accessToken, body.user, body.expiresIn);
      return body.accessToken;
    } catch {
      // Network failure, not a rejection. Still no token to work with.
      setSession(null, null);
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Full-page navigation, not fetch: the browser has to follow Google's redirects. */
export function signIn(): void {
  window.location.href = `${API}/auth/google`;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    // Clear locally even if the call failed - the token expires in minutes and
    // leaving the UI signed in would be a lie.
    setSession(null, null);
  }
}

export async function fetchProviders(): Promise<Providers> {
  try {
    const res = await fetch(`${API}/auth/providers`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    return (await res.json()) as Providers;
  } catch {
    return { google: false, devUser: false };
  }
}
