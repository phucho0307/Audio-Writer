import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentContext } from './request-context';

export const DEV_HANDLE = 'dev';

/**
 * Who the caller is.
 *
 * This was the auth seam while auth did not exist - it always answered with a
 * seeded account. It now reads the authenticated user off the request context,
 * and nothing that depends on it had to change: not a route, not a service,
 * not a query. That was the point of routing every caller through one function.
 *
 * The dev fallback survives behind AUTH_DEV_USER so the app still runs with no
 * Google credentials configured.
 */
@Injectable()
export class CurrentUserService {
  private readonly logger = new Logger(CurrentUserService.name);
  private readonly allowDevUser: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.allowDevUser =
      config.get<string>('AUTH_DEV_USER', 'false').toLowerCase() === 'true';
  }

  /** The caller, or null when nobody is signed in. */
  async optional(): Promise<User | null> {
    const ctx = currentContext();

    // Memoised for the life of the request: several services ask on a single
    // call and there is no reason to load the row more than once.
    if (ctx?.user) return ctx.user;

    if (ctx?.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
      });
      // A valid token for a deleted account is not an identity.
      if (user && ctx) ctx.user = user;
      return user;
    }

    if (this.allowDevUser) {
      const dev = await this.devUser();
      if (ctx) ctx.user = dev;
      return dev;
    }

    return null;
  }

  /** The caller, or a 401. Use this anywhere an identity is required. */
  async current(): Promise<User> {
    const user = await this.optional();
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Bạn cần đăng nhập để làm việc này.',
      });
    }
    return user;
  }

  /**
   * Self-healing so a fresh clone or a wiped database still works without
   * anyone having to remember to seed first.
   */
  private async devUser(): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { handle: DEV_HANDLE },
    });
    if (existing) return existing;

    this.logger.warn(`No "${DEV_HANDLE}" user found - creating one.`);
    return this.prisma.user.create({
      data: {
        handle: DEV_HANDLE,
        email: 'dev@audiowriter.local',
        displayName: 'Dev',
        locale: 'vi',
      },
    });
  }
}
