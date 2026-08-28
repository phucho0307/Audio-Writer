import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEV_HANDLE = 'dev';

/**
 * The auth seam.
 *
 * Auth is deliberately not built yet - a login screen validates nothing about
 * whether the product is any good, and the writing loop is what needs testing.
 * So every route asks this service who the user is, and today the answer is
 * always the same seeded account.
 *
 * When real auth lands, only `current()` changes: it reads the JWT off the
 * request instead of the database. No route, service, or query has to move.
 */
@Injectable()
export class CurrentUserService {
  private readonly logger = new Logger(CurrentUserService.name);
  private cached: User | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<User> {
    if (this.cached) return this.cached;

    let user = await this.prisma.user.findUnique({
      where: { handle: DEV_HANDLE },
    });

    // Self-healing so a fresh clone or a wiped database still works without
    // anyone having to remember to run a seed script first.
    if (!user) {
      this.logger.warn(`No "${DEV_HANDLE}" user found - creating one.`);
      user = await this.prisma.user.create({
        data: {
          handle: DEV_HANDLE,
          email: 'dev@audiowriter.local',
          displayName: 'Dev',
          locale: 'vi',
        },
      });
    }

    this.cached = user;
    return user;
  }
}
