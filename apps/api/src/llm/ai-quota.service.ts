import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntitlementKind, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface QuotaStatus {
  /** Free turns included every day. */
  dailyLimit: number;
  usedToday: number;
  freeRemaining: number;
  /** Purchased turns, available once the free ones are gone. */
  creditsRemaining: number;
  /** What the user can actually spend right now. */
  totalRemaining: number;
  /** True when the user supplied their own key and is not metered at all. */
  unlimited: boolean;
  resetsAt: string;
}

/**
 * Meters AI turns.
 *
 * The cap is a product decision before it is a cost one: unlimited generation
 * turns a writing tool into a slot machine, and the stories that come out of it
 * are nobody's. Three a day is enough to get unstuck and not enough to write
 * the book for you.
 *
 * Writing without AI is never metered.
 */
@Injectable()
export class AiQuotaService {
  private readonly dailyLimit: number;
  private readonly timeZone: string;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.dailyLimit = Number(this.config.get('AI_FREE_DAILY', 3));
    // The audience is Vietnamese, so the day should roll over at their
    // midnight, not UTC's.
    this.timeZone = this.config.get('AI_QUOTA_TZ', 'Asia/Ho_Chi_Minh');
  }

  private dayKey(userId: string): string {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return `ai:quota:${userId}:${date}`;
  }

  private nextReset(): Date {
    const now = new Date();
    const local = new Date(
      now.toLocaleString('en-US', { timeZone: this.timeZone }),
    );
    const midnight = new Date(local);
    midnight.setHours(24, 0, 0, 0);
    return new Date(now.getTime() + (midnight.getTime() - local.getTime()));
  }

  async status(user: User): Promise<QuotaStatus> {
    const resetsAt = this.nextReset().toISOString();

    // A user spending their own API key costs us nothing, so metering them
    // would be arbitrary. This is the pressure valve for heavy writers.
    if (user.byokKeyCipher) {
      return {
        dailyLimit: this.dailyLimit,
        usedToday: 0,
        freeRemaining: this.dailyLimit,
        creditsRemaining: 0,
        totalRemaining: Number.POSITIVE_INFINITY,
        unlimited: true,
        resetsAt,
      };
    }

    const raw = await this.redis.client.get(this.dayKey(user.id));
    const usedToday = Number(raw ?? 0);
    const freeRemaining = Math.max(0, this.dailyLimit - usedToday);
    const creditsRemaining = await this.credits(user.id);

    return {
      dailyLimit: this.dailyLimit,
      usedToday,
      freeRemaining,
      creditsRemaining,
      totalRemaining: freeRemaining + creditsRemaining,
      unlimited: false,
      resetsAt,
    };
  }

  private async credits(userId: string): Promise<number> {
    const rows = await this.prisma.entitlement.findMany({
      where: {
        userId,
        kind: EntitlementKind.AI_CREDITS,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { granted: true, consumed: true },
    });
    return rows.reduce((sum, r) => sum + (r.granted - r.consumed), 0);
  }

  /**
   * Spends one turn, or refuses. Called before generation starts - a refusal
   * has to arrive before any tokens stream, or the client has already been
   * given a 200 and cannot be shown a paywall.
   */
  async consume(user: User): Promise<QuotaStatus> {
    const status = await this.status(user);
    if (status.unlimited) return status;

    if (status.freeRemaining > 0) {
      const key = this.dayKey(user.id);
      // 48h covers the longest possible day plus timezone slack; the key is
      // date-stamped, so an over-long TTL can never leak into tomorrow.
      await this.redis.incrementWindow(key, 60 * 60 * 48);
      return this.status(user);
    }

    if (status.creditsRemaining > 0) {
      await this.spendCredit(user.id);
      return this.status(user);
    }

    throw new ForbiddenException({
      code: 'AI_QUOTA_EXCEEDED',
      message: `Bạn đã dùng hết ${this.dailyLimit} lượt AI hôm nay.`,
      hint: 'Tự viết tiếp, hoặc mua thêm lượt để dùng ngay.',
      dailyLimit: this.dailyLimit,
      resetsAt: status.resetsAt,
    });
  }

  private async spendCredit(userId: string): Promise<void> {
    // Oldest pack first, so anything with an expiry is used before it lapses.
    const pack = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        kind: EntitlementKind.AI_CREDITS,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!pack || pack.consumed >= pack.granted) return;

    await this.prisma.entitlement.update({
      where: { id: pack.id },
      data: { consumed: { increment: 1 } },
    });
  }

  /** Grants credits. Stands in for the payment webhook until checkout exists. */
  async grant(userId: string, amount: number): Promise<void> {
    await this.prisma.entitlement.create({
      data: { userId, kind: EntitlementKind.AI_CREDITS, granted: amount },
    });
  }
}
