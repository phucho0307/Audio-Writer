import { Injectable } from '@nestjs/common';
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
  constructor(private readonly redis: RedisService) {}

  async increment(
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
