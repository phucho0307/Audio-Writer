import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EVERY = 6 * 60 * 60 * 1000;

/**
 * Deletes sessions that can no longer authenticate anyone.
 *
 * Rotation writes a new row on every refresh, so an active reader produces
 * roughly one row per fifteen minutes and almost all of them are revoked
 * within the hour. Left alone the table only grows.
 *
 * The rule is `expiresAt < now`, and deliberately NOT "revoked". A revoked row
 * is what makes reuse detection work: when a stolen token is presented,
 * TokenService finds the revoked row and burns every session for that user.
 * Delete revoked rows eagerly and that same token comes back INVALID_REFRESH -
 * a quiet rejection instead of a break-glass - and the thief keeps whatever
 * other sessions they opened. So a row is kept for exactly as long as the
 * token it represents could still be presented, which is its own expiry.
 *
 * A plain interval rather than @nestjs/schedule: one job does not justify a
 * dependency, and this moves to BullMQ when that arrives for narration.
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.prune(); // once at boot, so a long-idle instance starts clean
    this.timer = setInterval(() => void this.prune(), EVERY);
    // Do not keep the process alive just for this.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async prune(): Promise<number> {
    try {
      const { count } = await this.prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) this.logger.log(`Pruned ${count} expired session(s)`);
      return count;
    } catch (err) {
      // Never take the app down over housekeeping.
      this.logger.error(`Session prune failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
