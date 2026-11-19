import { isPremium } from '../premium/premium';
import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AuthFailureLimiter, clientIp } from './auth-failure.limiter';
import { AuthService, normaliseEmail, type GoogleProfile } from './auth.service';
import { LoginLimiter } from './login-limiter';
import { EmailDto, LoginDto, RegisterDto, ResetDto, TokenDto } from './password.dto';
import { EmailFlowsService } from './email-flows.service';
import { CurrentUserService } from './current-user.service';
import { OAuthFailureFilter } from './oauth-failure.filter';
import { TokenService, type IssuedTokens } from './token.service';
import { Throttle } from '@nestjs/throttler';
import { AUTH_TIER } from '../throttler/tiers';

/** Scoped to the auth routes, so ordinary API traffic never carries it. */
const COOKIE = 'aw_refresh';
const COOKIE_PATH = '/api/auth';

/**
 * Every route here is on the tight limit. Sign-in and refresh are where
 * credential stuffing and token grinding go, and none of them is an endpoint
 * anybody legitimately calls in a loop.
 */
@Throttle(AUTH_TIER)
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly currentUser: CurrentUserService,
    private readonly failures: AuthFailureLimiter,
    private readonly logins: LoginLimiter,
    private readonly emails: EmailFlowsService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(COOKIE, token, {
      httpOnly: true, // JavaScript cannot read it, so XSS cannot exfiltrate it
      sameSite: 'lax', // not sent on cross-site requests
      secure: this.config.get('NODE_ENV') === 'production',
      path: COOKIE_PATH,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  private meta(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    };
  }

  // -------------------------------------------------------------------------

  /** Whether sign-in is available at all, so the UI can hide the button. */
  @Get('providers')
  providers() {
    return {
      google: Boolean(this.config.get<string>('GOOGLE_CLIENT_ID')),
      password: true,
      devUser:
        this.config.get<string>('AUTH_DEV_USER', 'false').toLowerCase() ===
        'true',
    };
  }

  /**
   * Kicks off the Google redirect. Passport handles the response.
   *
   * The guard also sets the handshake cookie carrying the `state` nonce and
   * the PKCE verifier, so a failure here has to redirect too.
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @UseFilters(OAuthFailureFilter)
  google(): void {
    /* redirected by the guard */
  }

  /**
   * Google sends the browser back here.
   *
   * Sets the refresh cookie and redirects to the web app carrying nothing
   * else - no token in the URL, which would otherwise land in browser history
   * and referrer headers. The client exchanges the cookie for an access token
   * on its next call.
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @UseFilters(OAuthFailureFilter)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const web = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');

    try {
      const profile = req.user as GoogleProfile;
      const user = await this.auth.fromGoogle(profile);
      const tokens = await this.tokens.issue(user, this.meta(req));

      this.setRefreshCookie(res, tokens.refreshToken);
      this.logger.log(`Signed in @${user.handle}`);
      return res.redirect(web);
    } catch (err) {
      this.logger.error(`Google sign-in failed: ${(err as Error).message}`);
      // The user is mid-redirect in a browser; a JSON error body would be a
      // dead end. Send them back with something the UI can explain.
      return res.redirect(`${web}?auth_error=1`);
    }
  }

  /**
   * Email sign-up. Signs the new account straight in: same cookie and same
   * body as a refresh, so the client handles both one way.
   */
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.logins.assertMayRegister(clientIp(req));
    const user = await this.auth.register(dto);
    await this.logins.countRegistration(clientIp(req));
    const tokens = await this.tokens.issue(user, this.meta(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    this.logger.log(`Registered @${user.handle}`);
    // The account works straight away; the email only proves the address.
    // A mail that fails to go out must not fail the sign-up - "gửi lại" exists.
    await this.emails.sendVerification(user).catch((err: Error) =>
      this.logger.warn(`verification mail for @${user.handle} not sent: ${err.message}`),
    );
    return this.body(tokens, user);
  }

  /** "Gửi lại email xác minh", for the signed-in owner of an unverified address. */
  @Post('verify/send')
  async resendVerification() {
    await this.emails.sendVerification(await this.currentUser.current());
    return { ok: true };
  }

  @Post('verify')
  verify(@Body() dto: TokenDto) {
    return this.emails.verify(dto.token);
  }

  /** Same answer whether or not the address has an account. */
  @Post('password/forgot')
  async forgot(@Body() dto: EmailDto) {
    await this.emails.forgot(dto.email);
    return { ok: true };
  }

  /** New password from an emailed link; signs out every other session and signs this one in. */
  @Post('password/reset')
  async reset(@Body() dto: ResetDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.emails.reset(dto.token, dto.password);
    const tokens = await this.tokens.issue(user, this.meta(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    return this.body(tokens, user);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const email = normaliseEmail(dto.email);
    const ip = clientIp(req);
    await this.logins.assertAllowed(email, ip);
    try {
      const user = await this.auth.login(dto);
      await this.logins.clear(email, ip);
      const tokens = await this.tokens.issue(user, this.meta(req));
      this.setRefreshCookie(res, tokens.refreshToken);
      return this.body(tokens, user);
    } catch (err) {
      if (err instanceof UnauthorizedException) await this.logins.recordFailure(email, ip);
      throw err;
    }
  }

  /**
   * Exchange the refresh cookie for an access token, rotating as we go.
   *
   * Also the app-boot call: the client holds no token in memory after a page
   * load, so this is how a signed-in session is picked back up.
   */
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE] as string | undefined;

    // No cookie is not a failed attempt - it is what every signed-out visitor
    // sends on page load, because the client cannot know whether a session
    // exists until it asks. Counting it would lock out ordinary browsing.
    if (!raw) {
      throw new UnauthorizedException({
        code: 'NO_SESSION',
        message: 'Chưa đăng nhập.',
      });
    }

    const ip = clientIp(req);
    await this.failures.assertNotLocked(ip, res);

    try {
      const { tokens, user } = await this.tokens.rotate(raw, this.meta(req));
      this.setRefreshCookie(res, tokens.refreshToken);
      await this.failures.clear(ip);
      return this.body(tokens, user);
    } catch (err) {
      // Invalid, expired, or reused: the cookie is worthless either way, so
      // clear it rather than leaving the client to retry with it forever.
      this.clearRefreshCookie(res);
      await this.failures.record(err, ip);
      throw err;
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE] as string | undefined;
    if (raw) await this.tokens.revoke(raw);
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  /** Whoever is calling, or null. Never 401s - the client uses it to decide. */
  @Get('me')
  async me() {
    const user = await this.currentUser.optional();
    if (!user) return { user: null };
    return { user: this.publicUser(user) };
  }

  // -------------------------------------------------------------------------

  private body(tokens: IssuedTokens, user: { id: string } & object) {
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user: this.publicUser(user as never),
    };
  }

  /** Never return googleSub, byokKeyCipher, or passwordHash. */
  private publicUser(user: {
    id: string;
    handle: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    locale: string;
    role: Role;
    emailVerifiedAt?: Date | null;
    premiumUntil?: Date | null;
  }) {
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      premium: isPremium(user),
      premiumUntil: user.premiumUntil ?? null,
    };
  }
}
