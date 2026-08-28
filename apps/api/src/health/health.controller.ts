import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type Check = { ok: boolean; error?: string };

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<{
    ok: boolean;
    checks: Record<string, Check>;
  }> {
    const [postgres, redis] = await Promise.all([
      this.probe(() => this.prisma.ping()),
      this.probe(() => this.redis.ping()),
    ]);

    return {
      ok: postgres.ok && redis.ok,
      checks: { postgres, redis },
    };
  }

  private async probe(fn: () => Promise<boolean>): Promise<Check> {
    try {
      return { ok: await fn() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
