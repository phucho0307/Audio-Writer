import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';

const PREFIX = 'authfail';

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 30 * 60_000;

/**
 * Deliberately small, and measured over a long window. A real visitor produces
 * roughly zero of these; someone guessing refresh tokens produces nothing else.
 */
const IDENTITY_LIMIT = 5;

/**
 * An IPv4 /24 is an organisation, not a person - a school, an office, a small
 * ISP pool. Wider than one address because it legitimately holds more people,
 * but far below 254 x 5, which is what an attacker holding the whole range
 * would otherwise get.
 */
const NETWORK_LIMIT = 20;

/**
 * The failures worth counting.
 *
 * INVALID_REFRESH is the attacker's signature: a token we have never issued.
 * REFRESH_EXPIRED joins it because a pruned session looks identical from the
 * outside, and a real user hits it once a month at most.
 *
 * REFRESH_REUSED is deliberately absent, for two reasons. It already triggers
 * the strongest response we have - every session for that user is revoked - so
 * a rate limit adds nothing. And it is the one failure an honest user can
 * produce in a burst: restore a window with five tabs, all five call refresh
 * with the same cookie, the first one rotates it and the other four are now
 * presenting a revoked token. Counting that would lock people out for tidying
 * their browser.
 */
const COUNTED = new Set(['INVALID_REFRESH', 'REFRESH_EXPIRED']);

/**
 * `req.ips` is populated only behind a trusted proxy, and its first entry is
 * the client rather than the load balancer. Same rule as the throttler's
 * tracker - if these two ever disagree, one of the limits is counting the
 * wrong person.
 */
export function clientIp(req: Request): string {
  const ip = req.ips?.length ? req.ips[0] : req.ip;
  return ip ?? 'unknown';
}

/**
 * The first four hextets, zero-padded, with `::` expanded.
 *
 * Naive splitting is wrong: `2001:db8::1` splits into four groups, but its /64
 * prefix is `2001:0db8:0000:0000`. Compression has to be expanded first or the
 * prefix silently includes the wrong bits.
 */
function prefix64(addr: string): string {
  const groups = addr.includes('::')
    ? (() => {
        const [head, tail] = addr.split('::');
        const l = head ? head.split(':') : [];
        const r = tail ? tail.split(':') : [];
        const fill: string[] = new Array(Math.max(0, 8 - l.length - r.length));
        return [...l, ...fill.fill('0'), ...r];
      })()
    : addr.split(':');

  return groups
    .slice(0, 4)
    .map((g) => (g || '0').padStart(4, '0'))
    .join(':');
}

interface Bucket {
  key: string;
  limit: number;
  /** Whether a successful refresh wipes this counter. See `clear()`. */
  personal: boolean;
}

/**
 * The keys one caller is counted against. Every one is checked, and any one of
 * them going over locks the caller out.
 *
 * Large platforms count logins on several axes at once - address, account,
 * device, subnet - and the reason is that any single axis is cheap for an
 * attacker to change. Two of those axes do not exist here and are deliberately
 * not invented: there is no password, and a refresh request names no account,
 * so there is nothing for an attacker to target and no account dimension to
 * count. What is left is the network, and that is worth splitting properly.
 *
 * IPv4 and IPv6 need opposite treatment:
 *
 * - An IPv4 address is roughly one customer, so it is the personal key, with
 *   the /24 above it as a second, looser ceiling on the whole organisation.
 * - An IPv6 /64 is what a single customer is normally delegated - one household
 *   or one site - and the addresses inside it are free and effectively
 *   unlimited. Counting the full address would hand an attacker eighteen
 *   quintillion fresh buckets, so the /64 *is* the personal key.
 */
export function bucketsFor(ip: string): Bucket[] {
  const bare = ip.replace(/%.*$/, '').replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  const addr = mapped ? mapped[1] : bare;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(addr);
  if (v4) {
    return [
      { key: `ip:${addr}`, limit: IDENTITY_LIMIT, personal: true },
      {
        key: `net:${v4[1]}.${v4[2]}.${v4[3]}.0/24`,
        limit: NETWORK_LIMIT,
        personal: false,
      },
    ];
  }

  if (addr.includes(':')) {
    return [
      { key: `net6:${prefix64(addr)}::/64`, limit: IDENTITY_LIMIT, personal: true },
    ];
  }

  return [{ key: `ip:${addr}`, limit: IDENTITY_LIMIT, personal: true }];
}

/**
 * A second, much tighter limit on `POST /auth/refresh` that counts only
 * FAILURES.
 *
 * The throttler in front of this caps all auth traffic at 10/min, which has to
 * stay loose because our own client calls these routes: every page load fires
 * refresh and /auth/me, and a proactive renew lands every fifteen minutes. One
 * budget shared between the app's own boot calls and an attack means the number
 * gets tuned for the app and is therefore useless against the attack.
 *
 * Counting failures separates them. An attacker guessing refresh tokens
 * produces nothing but failures, so five is all they ever get. A real user
 * produces essentially none, so they never see this at all - which is what lets
 * the threshold be this low.
 *
 * Keyed by network rather than user id, because a failed refresh has by
 * definition no authenticated user - that is what failed.
 */
@Injectable()
export class AuthFailureLimiter {
  private readonly logger = new Logger(AuthFailureLimiter.name);

  constructor(private readonly redis: RedisService) {}

  private lockKey(bucket: string): string {
    return `${PREFIX}:${bucket}:locked`;
  }

  /** Call before touching the token at all, so a locked caller costs us no DB read. */
  async assertNotLocked(ip: string, res: Response): Promise<void> {
    const buckets = bucketsFor(ip);

    let ms = 0;
    try {
      const pipe = this.redis.client.pipeline();
      for (const b of buckets) pipe.pttl(this.lockKey(b.key));
      const results = await pipe.exec();
      for (const r of results ?? []) ms = Math.max(ms, Number(r?.[1] ?? 0));
    } catch (err) {
      // Fail open, loudly. See the note on `record()` - with no password
      // anywhere in this system, a Redis outage that blocked every refresh
      // would log out every signed-in user, which is a far worse failure than
      // an unmetered hour on an endpoint whose secret is 384 bits of entropy.
      this.logger.error(
        `Redis unavailable, auth failure limit not enforced: ${(err as Error).message}`,
      );
      return;
    }

    if (ms <= 0) return;

    const retryAfter = Math.ceil(ms / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        code: 'TOO_MANY_ATTEMPTS',
        message: `Quá nhiều lần thử không hợp lệ. Vui lòng thử lại sau ${Math.ceil(retryAfter / 60)} phút.`,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Count a rejection, if it is the caller's fault and of a kind worth
   * counting. Deciding that here rather than in the controller keeps the whole
   * policy in one file.
   */
  async record(err: unknown, ip: string): Promise<void> {
    // A database outage rejects every refresh too. Locking users out for our
    // own downtime would turn a blip into an outage with a thirty-minute tail.
    if (!(err instanceof UnauthorizedException)) return;

    const body = err.getResponse();
    const code =
      typeof body === 'object' && body !== null
        ? (body as { code?: string }).code
        : undefined;
    if (!code || !COUNTED.has(code)) return;

    const buckets = bucketsFor(ip);

    try {
      const pipe = this.redis.client.pipeline();
      for (const b of buckets) {
        pipe.incr(`${PREFIX}:${b.key}`);
        pipe.pexpire(`${PREFIX}:${b.key}`, WINDOW_MS, 'NX');
      }
      const results = await pipe.exec();

      for (const [i, b] of buckets.entries()) {
        const total = Number(results?.[i * 2]?.[1] ?? 0);
        if (total < b.limit) continue;

        // Drop the counter with the lock, so the half hour is served once
        // rather than re-armed by the next request after it expires.
        await this.redis.client.psetex(this.lockKey(b.key), LOCK_MS, '1');
        await this.redis.client.del(`${PREFIX}:${b.key}`);
        this.logger.warn(
          `Locked ${b.key} for ${LOCK_MS / 60_000}m after ${total} failed refreshes`,
        );
      }
    } catch (err2) {
      this.logger.error(
        `Redis unavailable, auth failure not counted: ${(err2 as Error).message}`,
      );
    }
  }

  /**
   * A successful rotation proves whoever is on this address holds a real token,
   * so the tally so far was noise - an expired cookie, a stale tab. Without
   * this, a shared address slowly accumulates unrelated failures until it trips.
   *
   * Only the personal counter is cleared. Wiping the /24 as well would let one
   * valid session inside a network reset the ceiling for everyone else in it,
   * which is exactly the ceiling the /24 exists to impose.
   */
  async clear(ip: string): Promise<void> {
    const personal = bucketsFor(ip).filter((b) => b.personal);
    if (!personal.length) return;
    try {
      await this.redis.client.del(...personal.map((b) => `${PREFIX}:${b.key}`));
    } catch {
      // Nothing to do. The counter expires on its own within the window.
    }
  }
}
