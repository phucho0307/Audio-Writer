import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { ThrottlerRedisStorage } from './throttler-redis.storage';
import { AwThrottlerGuard } from './throttler.guard';

const seconds = (n: number) => n * 1000;

/**
 * One limiter, with per-route overrides.
 *
 * See `tiers.ts` for why this is not three named throttlers: named limiters
 * all run on every route, so naming one does not select it, and a route that
 * names none inherits the tightest of them all.
 *
 * Counters live in Redis rather than process memory, so replicas share them
 * and a deploy does not hand everyone a fresh allowance.
 */
@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        storage: new ThrottlerRedisStorage(redis),
        throttlers: [
          {
            name: 'default',
            ttl: seconds(60),
            limit: Number(config.get('RATE_DEFAULT_PER_MIN', 120)),
            blockDuration: seconds(60),
          },
        ],
      }),
    }),
  ],
  providers: [
    ThrottlerRedisStorage,
    { provide: APP_GUARD, useClass: AwThrottlerGuard },
  ],
  exports: [ThrottlerModule],
})
export class AwThrottlerModule {}
