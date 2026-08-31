import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { currentContext } from '../auth/request-context';

/**
 * Rate limiting keyed to the caller, not the connection.
 *
 * IP alone is wrong in both directions here. A university or an office shares
 * one address, so a single heavy reader would throttle everyone behind it;
 * and anyone with a handful of addresses sidesteps the limit entirely. A
 * signed-in user has an id that follows them across networks, which is the
 * thing actually worth counting.
 *
 * IP remains the fallback, because signed-out reading is most of the traffic
 * and has to be limited somehow.
 */
@Injectable()
export class AwThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const userId = currentContext()?.userId;
    if (userId) return `u:${userId}`;

    // `req.ips` is populated only behind a trusted proxy; the first entry is
    // the client rather than the load balancer.
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return `ip:${ip ?? 'unknown'}`;
  }

  protected async throwThrottlingException(
    _context: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The default message is "ThrottlerException: Too Many Requests", which
    // tells a Vietnamese reader nothing and gives the client nothing to branch
    // on. Retry-After is already set by the base guard.
    throw new ThrottlerException(
      JSON.stringify({
        code: 'RATE_LIMITED',
        message: `Bạn thao tác hơi nhanh. Thử lại sau ${detail.timeToBlockExpire || detail.ttl} giây.`,
        retryAfter: detail.timeToBlockExpire || detail.ttl,
      }),
    );
  }
}
