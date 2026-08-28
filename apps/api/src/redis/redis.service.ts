import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  /**
   * Fixed-window counter used for the free-tier rate limits. Returns the count
   * after incrementing, so the caller compares against its own ceiling.
   *
   * A fixed window can let through up to 2x the limit across a boundary. That
   * is why the configured ceilings sit below the provider's real limit rather
   * than at it - the headroom absorbs the burst.
   */
  async incrementWindow(key: string, windowSeconds: number): Promise<number> {
    const results = await this.client
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX')
      .exec();

    const count = results?.[0]?.[1];
    return typeof count === 'number' ? count : 0;
  }
}
