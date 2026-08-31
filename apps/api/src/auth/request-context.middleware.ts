import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  handle: string;
}

/**
 * Reads the access token off the request and opens a context for it.
 *
 * Deliberately does not reject anything - it only records who is calling.
 * Refusing unauthenticated requests is `CurrentUserService`'s job, so public
 * routes (browsing, reading) keep working without a token while anything that
 * needs an identity fails loudly when there is none.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    let userId: string | null = null;

    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      try {
        const payload = this.jwt.verify<AccessTokenPayload>(token, {
          secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        });
        userId = payload.sub;
      } catch {
        // Expired or forged. Left unauthenticated rather than thrown: the
        // client's job on a 401 is to refresh and retry, and a malformed
        // token on a public route should not break the page.
      }
    }

    requestContext.run({ userId }, () => next());
  }
}
