import { API } from './env';

export type AuthUser = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  locale: string;
  role: 'USER' | 'ADMIN';
};

export type Providers = { google: boolean; password?: boolean; devUser: boolean };

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

/**
 * Wait until the page knows who is signed in.
 *
 * The access token lives in memory, so every page load starts without one,
 * and `call()` only renews on a 401. But a private story fetched anonymously
 * is a 404, not a 401 - deliberately, so its existence is not confirmed to
 * strangers - which meant no renewal ever happened: creating a story (private
 * by default) and landing on its page showed "Story not found" to its own
 * author, as did reloading any private story. The first request of a page
 * now waits for the session to be restored. Single-flighted through
 * `refresh`, and a no-op once settled, so it costs one round trip per load.
 */
export async function ensureSession(): Promise<void> {
  if (!ready) await refresh();
}

// ---------------------------------------------------------------- the dialog

export type DialogState = { open: boolean; mode: 'signin' | 'signup'; reason: string | null };
let dialog: DialogState = { open: false, mode: 'signin', reason: null };
const dialogListeners = new Set<() => void>();

export function subscribeDialog(fn: () => void): () => void {
  dialogListeners.add(fn);
  return () => dialogListeners.delete(fn);
}
export function getDialog(): DialogState {
  return dialog;
}
const CLOSED: DialogState = { open: false, mode: 'signin', reason: null };
export function getServerDialog(): DialogState {
  return CLOSED;
}
function setDialog(next: DialogState): void {
  dialog = next;
  for (const l of dialogListeners) l();
}

/**
 * Ask the reader to sign in, in a dialog over whatever they were doing.
 *
 * Every action that needs an account calls this: rating, forking, the
 * account button. `reason` says what they were trying to do ("Đăng nhập để
 * chấm sao"), which is the difference between a prompt and a wall. Safe to
 * pass straight to onClick - an event is not a string and is ignored.
 */
export function signIn(reason?: unknown, mode: 'signin' | 'signup' = 'signin'): void {
  setDialog({ open: true, mode, reason: typeof reason === 'string' ? reason : null });
}

export function closeSignIn(): void {
  setDialog({ ...dialog, open: false });
}

export function setSignInMode(mode: 'signin' | 'signup'): void {
  setDialog({ ...dialog, mode });
}

/** Thrown with the API's own message, which is already in Vietnamese. */
export class AuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function passwordCall(path: 'login' | 'register', body: object): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}/auth/${path}`, {
      method: 'POST',
      credentials: 'include', // so the refresh cookie it sets is kept
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Không kết nối được máy chủ. Thử lại sau.');
  }
  const json = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    expiresIn?: number;
    user?: AuthUser;
    message?: string | string[];
    code?: string;
  };
  if (!res.ok || !json.accessToken || !json.user) {
    const msg = Array.isArray(json.message) ? json.message[0] : json.message;
    throw new AuthError(msg || 'Có lỗi xảy ra. Thử lại sau.', json.code);
  }
  setSession(json.accessToken, json.user, json.expiresIn);
  closeSignIn();
}

export function signInWithPassword(email: string, password: string): Promise<void> {
  return passwordCall('login', { email, password });
}

export function signUpWithPassword(email: string, password: string, displayName: string): Promise<void> {
  return passwordCall('register', { email, password, displayName });
}

/** Full-page navigation, not fetch: the browser has to follow Google's redirects. */
export function signInWithGoogle(): void {
  // Google's round trip ends on the site's front page, wherever it started.
  // Remember where the reader was - a share link, a chapter - so they can be
  // put back there afterwards instead of losing it.
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);
  } catch {
    // Storage blocked: they land on the front page, as before.
  }
  window.location.href = `${API}/auth/google`;
}

const RETURN_KEY = 'aw-return-to';

/** After sign-in: the page the reader left for it, once, if any. */
export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    // Same-site paths only - never a full URL.
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
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
