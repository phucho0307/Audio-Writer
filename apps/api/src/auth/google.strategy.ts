import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type { StateStore } from 'passport-oauth2';
import type { GoogleProfile } from './auth.service';
import { CookieOAuthStateStore } from './oauth-state.store';

/**
 * Google OAuth.
 *
 * Only `profile` and `email` are requested. Anything more would widen the
 * consent screen and give us data we have no use for, which is both a worse
 * first impression and more to protect.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID', ''),
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET', ''),
      callbackURL: config.get<string>(
        'GOOGLE_CALLBACK_URL',
        'http://localhost:4000/api/auth/google/callback',
      ),
      scope: ['profile', 'email'],

      // `state` binds the callback to the browser that started the login.
      // Without it any completed handshake can be replayed at any victim, and
      // passport's default is to skip the check entirely.
      state: true,
      // PKCE binds the authorization code to the browser session it was issued
      // for. Not redundant with the client secret, despite us being a
      // confidential client: the secret only stops an attacker exchanging a
      // stolen code from their OWN server. It is no help against code
      // injection, where the attacker runs a real login here and swaps in a
      // leaked code at the callback - their `state` is genuine and our own
      // server hands Google the secret on their behalf. Only the verifier
      // mismatch catches that. See RFC 9700 s2.1.1.
      // `true` means S256; passport rejects `pkce` without `state`.
      pkce: true,
      // Signed cookie instead of express-session. See the store for why.
      // Cast: the shipped typings omit passport's 5-arity PKCE overload.
      store: new CookieOAuthStateStore(
        config.get<string>('JWT_REFRESH_SECRET', 'dev-oauth-secret'),
        config.get<string>('NODE_ENV') === 'production',
      ) as unknown as StateStore,
    });
  }

  /**
   * Passport hands us the verified profile; we hand back a plain object.
   *
   * No database work here on purpose - this runs inside Passport's callback,
   * where a thrown error becomes an opaque 500. Resolving the account happens
   * in the controller where failures can be redirected properly.
   */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0];

    const mapped: GoogleProfile = {
      googleSub: profile.id,
      email: email?.value ?? '',
      // The typings omit it, but Google sends verified status per address.
      emailVerified:
        (email as { verified?: boolean | string } | undefined)?.verified ===
          true ||
        (email as { verified?: boolean | string } | undefined)?.verified ===
          'true',
      displayName: profile.displayName ?? '',
      avatarUrl: profile.photos?.[0]?.value,
    };

    done(null, mapped);
  }
}
