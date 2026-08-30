import {
  CanActivate,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Hides routes that exist only until the real thing is built.
 *
 * The credit-granting endpoints stand in for checkout: they hand out paid
 * credits with no payment. That is fine while every caller resolves to the dev
 * user on localhost, and a disaster the moment real accounts and a public URL
 * exist - anyone could mint themselves unlimited credits and the paywall would
 * be decorative.
 *
 * Throws NotFound rather than Forbidden on purpose. Forbidden confirms the
 * route is there and worth attacking; NotFound says nothing at all, which is
 * what an endpoint that should not exist in production ought to say.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  private readonly logger = new Logger(DevOnlyGuard.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    // Opt-in, not opt-out. A missing variable in production must fail closed;
    // forgetting to set DEV_ENDPOINTS=false should not be what exposes these.
    this.enabled =
      config.get<string>('DEV_ENDPOINTS', 'false').toLowerCase() === 'true';

    if (this.enabled) {
      this.logger.warn(
        'DEV_ENDPOINTS=true - credit-granting stand-ins are reachable. Never set this in production.',
      );
    }
  }

  canActivate(): boolean {
    if (this.enabled) return true;
    throw new NotFoundException('Cannot POST');
  }
}
