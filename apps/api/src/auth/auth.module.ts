import {
  Global,
  Logger,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CurrentUserService } from './current-user.service';
import { DevOnlyGuard } from './dev-only.guard';
import { GoogleStrategy } from './google.strategy';
import { OAuthFailureFilter } from './oauth-failure.filter';
import { RequestContextMiddleware } from './request-context.middleware';
import { SessionCleanupService } from './session-cleanup.service';
import { TokenService } from './token.service';

/**
 * Registered only when credentials exist.
 *
 * Passport's OAuth2 strategy throws in its constructor without a clientID, so
 * importing it unconditionally made the whole API refuse to boot on a fresh
 * clone - which defeats the point of the dev-user fallback. A factory lets the
 * strategy simply not exist until it is configured; `/auth/google` then reports
 * that clearly instead of the process dying.
 */
const GOOGLE_STRATEGY = {
  provide: GoogleStrategy,
  useFactory: (config: ConfigService): GoogleStrategy | null => {
    if (!config.get<string>('GOOGLE_CLIENT_ID')) {
      new Logger('AuthModule').warn(
        'GOOGLE_CLIENT_ID not set - Google sign-in is disabled.',
      );
      return null;
    }
    return new GoogleStrategy(config);
  },
  inject: [ConfigService],
};

@Global()
@Module({
  imports: [
    ConfigModule,
    // No Passport session cookie: it only carries the profile from Google's
    // callback into our controller, and we issue our own tokens there.
    PassportModule.register({ session: false }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    CurrentUserService,
    TokenService,
    AuthService,
    OAuthFailureFilter,
    SessionCleanupService,
    DevOnlyGuard,
    GOOGLE_STRATEGY,
  ],
  exports: [CurrentUserService, TokenService, DevOnlyGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including public ones: the middleware only records who is
    // calling, it never rejects. Reading a story with no token must keep
    // working.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
