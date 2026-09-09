import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service';

/**
 * The package does not re-export this from its index, only from a path inside
 * `dist`. Declaring it here keeps the import surface to published entry points
 * - structural typing means an identical shape still satisfies the interface.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

const PREFIX = 'throttle';

/**
 * Rate-limit counters in Redis rather than in process memory.
 *
 * The default storage is a Map on the instance, which means every replica
 * enforces its own limit: two replicas behind a load balancer let through
 * twice the traffic, and a deploy resets everyone's counter to zero. Neither
 * is acceptable for a limit that exists to stop abuse.
 *
 * Both the hit counter and the block flag are single round trips. `INCR` plus
 * `EXPIRE ... NX` is atomic enough for this: the key either exists with a TTL
 * already set, or this call created it and sets one. A race between two
 * requests on a brand-new key can only ever set the same TTL twice.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ThrottlerRedisStorage.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Redis is down. Every route fails open.
   *
   * This is a policy decision, not an oversight, and it is the opposite of what
   * the usual advice says. Fail-closed is right for a password endpoint: if you
   * cannot count guesses, do not allow guesses, because a password is
   * guessable. Nothing here is. Sign-in belongs to Google, and the only
   * grindable secret we hold is 48 bytes of CSPRNG output, so an unmetered
   * window costs us database load rather than accounts.
   *
   * Failing closed would instead convert a cache outage into a total outage -
   * nobody browses, nobody refreshes, everyone is logged out. Availability wins
   * on that trade, and the edge limiter in front of a deployed instance is the
   * backstop. Revisit the moment a password exists anywhere in this system.
   */
  private openRecord(ttl: number): ThrottlerStorageRecord {
    return {
      totalHits: 0,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.count(key, ttl, limit, blockDuration, throttlerName);
    } catch (err) {
      this.logger.error(
        `Redis unavailable, rate limit not enforced: ${(err as Error).message}`,
      );
      return this.openRecord(ttl);
    }
  }

  private async count(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.client;
    const hits = `${PREFIX}:${throttlerName}:${key}`;
    const block = `${PREFIX}:${throttlerName}:${key}:blocked`;

    // Already blocked: say so without touching the counter, so hammering a
    // blocked key cannot extend its own punishment indefinitely.
    const blockedFor = await client.pttl(block);
    if (blockedFor > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedFor / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedFor / 1000),
      };
    }

    const res = await client
      .multi()
      .incr(hits)
      .pexpire(hits, ttl, 'NX')
      .pttl(hits)
      .exec();

    const totalHits = Number(res?.[0]?.[1] ?? 0);
    const remainingMs = Number(res?.[2]?.[1] ?? ttl);

    if (totalHits > limit) {
      // Blocking is what makes the limit bite: without it a caller simply
      // resumes the moment the window rolls, which for a login endpoint is a
      // rate limit in name only.
      await client.psetex(block, blockDuration, '1');
      return {
        totalHits,
        timeToExpire: Math.ceil(blockDuration / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(Math.max(remainingMs, 0) / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
