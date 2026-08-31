import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Short-lived, single-use, and scoped to the auth routes. */
const COOKIE = 'aw_oauth';
const COOKIE_PATH = '/api/auth';
const TTL_MS = 10 * 60 * 1000;

type StoreCallback = (err: Error | null, handle?: string) => void;
type VerifyCallback = (
  err: Error | null,
  ok?: string | boolean,
  state?: unknown,
) => void;

interface Handshake {
  /** Random nonce, echoed through Google as the `state` parameter. */
  h: string;
  /** PKCE code_verifier. Passport generates it; we only have to keep it. */
  v?: string;
  /** Absolute expiry, epoch ms. */
  e: number;
}

/**
 * State + PKCE storage for the Google handshake, backed by a signed cookie.
 *
 * Passport's own store needs express-session. Adding a session store for a
 * value that lives ten minutes and is read exactly once would mean either
 * server memory that breaks across replicas, or a Redis round trip per login.
 * A signed cookie is stateless, survives a restart, and scales for free.
 *
 * Without this the strategy falls back to passport's NullStore, whose `verify`
 * returns true unconditionally - no state is sent and none is checked, which
 * leaves login CSRF wide open: an attacker completes a handshake for their own
 * account and hands the victim the callback URL, silently signing the victim
 * into the attacker's account.
 */
export class CookieOAuthStateStore {
  constructor(
    private readonly secret: string,
    private readonly secure: boolean,
  ) {}

  private sign(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');
  }

  private static equal(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  /**
   * Arity 5, deliberately.
   *
   * Passport dispatches on `store.length` and only passes the PKCE verifier at
   * this exact signature (strategy.js:289). Adding or removing a parameter
   * silently selects a different overload and drops the verifier.
   */
  store(
    req: Request,
    verifier: string,
    _state: unknown,
    _meta: unknown,
    cb: StoreCallback,
  ): void {
    const res = req.res;
    if (!res) return cb(new Error('No response bound to request'));

    const handshake: Handshake = {
      h: randomBytes(18).toString('base64url'),
      v: verifier,
      e: Date.now() + TTL_MS,
    };
    const payload = Buffer.from(JSON.stringify(handshake)).toString('base64url');

    res.cookie(COOKIE, `${payload}.${this.sign(payload)}`, {
      httpOnly: true,
      // Lax, never Strict: Google's callback is a cross-site top-level
      // navigation, which is exactly where Strict withholds the cookie. The
      // handshake would then fail every time, for everyone.
      sameSite: 'lax',
      secure: this.secure,
      path: COOKIE_PATH,
      maxAge: TTL_MS,
    });

    cb(null, handshake.h);
  }

  /** Arity 3 (strategy.js:218). Same warning as `store`. */
  verify(req: Request, providedState: string, cb: VerifyCallback): void {
    const raw = (req.cookies as Record<string, string> | undefined)?.[COOKIE];

    // Retire the handshake however this turns out, so a stale cookie is not
    // left sitting in the browser for ten minutes after a failed login.
    //
    // Note this is browser-side only - being stateless, we cannot refuse a
    // second presentation of the same cookie. That is acceptable: replay needs
    // the authorization code too, and Google spends codes on first exchange
    // (and revokes the issued tokens if one is reused). Enforcing it server
    // side would mean a spent-nonce set in Redis for no additional safety.
    req.res?.clearCookie(COOKIE, { path: COOKIE_PATH });

    const fail = (message: string) => cb(null, false, { message });
    if (!raw) return fail('No handshake cookie');

    const dot = raw.lastIndexOf('.');
    if (dot < 0) return fail('Malformed handshake');

    const payload = raw.slice(0, dot);
    // Signature first. Cookies are not origin-bound, so a compromised
    // sibling subdomain could otherwise plant a handshake of its choosing.
    if (!CookieOAuthStateStore.equal(raw.slice(dot + 1), this.sign(payload))) {
      return fail('Bad handshake signature');
    }

    let handshake: Handshake;
    try {
      handshake = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Handshake;
    } catch {
      return fail('Unreadable handshake');
    }

    if (Date.now() > handshake.e) return fail('Handshake expired');
    if (
      !providedState ||
      !CookieOAuthStateStore.equal(providedState, handshake.h)
    ) {
      return fail('State mismatch');
    }

    // Passport reads a string result as the PKCE code_verifier and sends it in
    // the token exchange. `true` keeps the store working if PKCE is ever off.
    cb(null, handshake.v ?? true);
  }
}
