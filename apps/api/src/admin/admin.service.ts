import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUserService } from '../auth/current-user.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;

/** A person, not the owner and not a seeded account. */
const REAL = { role: { not: Role.ADMIN }, NOT: { email: { endsWith: '.local' } } };

/**
 * The numbers that decide whether the trial run becomes a paid deployment:
 * the plan is to pay for real hosting once twenty people use the site.
 *
 * "Use" means came back, not signed up: a person counts as a returning
 * reader once they have been active on two different days. Activity is a
 * session being issued, which happens at sign-in and every time the access
 * token is refreshed, so any visit by a signed-in reader leaves one.
 *
 * Admins are left out of every count, and so are the seeded accounts
 * (`@audiowriter.local`, from prisma/seed-stories.ts): the owner testing the
 * site is not a user.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async stats() {
    const me = await this.currentUser.current();
    // 404, not 403: the page should not announce that it exists.
    if (me.role !== Role.ADMIN) throw new NotFoundException();

    const now = Date.now();
    const since = (days: number) => new Date(now - days * DAY);
    const notAdmin = { user: REAL };

    // Distinct (user, day) pairs over the last 30 days, in the site's own
    // timezone, so a late-night session is not split across two dates.
    const days = await this.prisma.$queryRaw<{ userId: string; days: bigint; last: Date }[]>`
      SELECT s."userId", COUNT(DISTINCT (s."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS days,
             MAX(s."createdAt") AS last
      FROM sessions s JOIN users u ON u.id = s."userId"
      WHERE u.role <> 'ADMIN' AND u.email NOT LIKE '%.local' AND s."createdAt" > ${since(30)}
      GROUP BY s."userId"`;
    const activeWithin = (d: number) => days.filter((r) => r.last > since(d)).length;

    const [users, newWeek, verified, listeners, comments, follows, ratings, signups] = await Promise.all([
      this.prisma.user.count({ where: REAL }),
      this.prisma.user.count({ where: { ...REAL, createdAt: { gt: since(7) } } }),
      this.prisma.user.count({ where: { ...REAL, emailVerifiedAt: { not: null } } }),
      this.prisma.readingProgress
        .groupBy({ by: ['userId'], where: { ...notAdmin, updatedAt: { gt: since(7) } } })
        .then((r) => r.length),
      this.prisma.comment.count({ where: { ...notAdmin, createdAt: { gt: since(7) } } }),
      this.prisma.storyFollow.count({ where: { ...notAdmin, createdAt: { gt: since(7) } } }),
      this.prisma.storyRating.count({ where: { ...notAdmin, createdAt: { gt: since(7) } } }),
      this.prisma.user.findMany({
        where: REAL,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { handle: true, displayName: true, createdAt: true },
      }),
    ]);

    return {
      goal: 20,
      returning: days.filter((r) => Number(r.days) >= 2).length,
      users,
      newWeek,
      verified,
      active: { day: activeWithin(1), week: activeWithin(7), month: activeWithin(30) },
      week: { listeners, comments, follows, ratings },
      signups,
    };
  }
}
