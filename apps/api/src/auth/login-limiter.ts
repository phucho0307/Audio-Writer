import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const WINDOW_S = 15 * 60;
/** Wrong passwords for one account before it rests: stops guessing one person's password. */
const PER_EMAIL = 10;
/** Wrong passwords from one address across all accounts: stops spraying one password at many. */
const PER_IP = 30;

/**
 * Password guessing limits, separate from the refresh-token limiter.
 *
 * Sharing that one would mean five typos lock the whole address out of
 * refreshing - every signed-in tab on that network logged out because one
 * person forgot a password. Here the counters are their own, and per
 * account as well as per address, so a botnet rotating addresses still hits
 * the per-account wall.
 */
@Injectable()
export class LoginLimiter {
  private readonly logger = new Logger(LoginLimiter.name);

  constructor(private readonly redis: RedisService) {}

  private keys(email: string, ip: string) {
    return { email: `loginfail:email:${email}`, ip: `loginfail:ip:${ip}` };
  }

  async assertAllowed(email: string, ip: string): Promise<void> {
    const k = this.keys(email, ip);
    let byEmail = 0;
    let byIp = 0;
    try {
      [byEmail, byIp] = (await this.redis.client.mget(k.email, k.ip)).map((v) => Number(v ?? 0));
    } catch (err) {
      // Fail open: argon2 alone already makes each guess slow.
      this.logger.error(`Redis unavailable, login limit not enforced: ${(err as Error).message}`);
      return;
    }
    if (byEmail >= PER_EMAIL || byIp >= PER_IP) {
      throw new HttpException(
        {
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.',
          retryAfter: WINDOW_S,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const k = this.keys(email, ip);
    await this.redis.incrementWindow(k.email, WINDOW_S).catch(() => 0);
    await this.redis.incrementWindow(k.ip, WINDOW_S).catch(() => 0);
  }

  async clear(email: string, ip: string): Promise<void> {
    await this.redis.client.del(this.keys(email, ip).email).catch(() => 0);
  }
}
