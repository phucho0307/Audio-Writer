import {
  Catch,
  Injectable,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * Turns a failed Google handshake into a redirect instead of a JSON body.
 *
 * State verification fails inside the Passport guard, before the controller
 * method ever runs - so the controller's own try/catch cannot see it. Without
 * this the user, who is mid-redirect in a browser, lands on a raw 403 payload
 * and has no way back into the app.
 */
@Injectable()
@Catch()
export class OAuthFailureFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthFailureFilter.name);

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const web = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');

    this.logger.warn(
      `Google handshake rejected: ${(exception as Error)?.message ?? exception}`,
    );

    // A half-finished handshake is worthless; do not leave it to be retried.
    res.clearCookie('aw_oauth', { path: '/api/auth' });
    res.redirect(`${web}?auth_error=1`);
  }
}
