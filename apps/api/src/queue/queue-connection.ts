import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis connections for BullMQ, deliberately separate from `RedisService`.
 *
 * Two reasons they cannot be shared:
 *
 * 1. BullMQ refuses a connection with `maxRetriesPerRequest` set to anything
 *    but null. Its workers wait on blocking commands (BRPOPLPUSH) that must be
 *    allowed to hang indefinitely; a retry ceiling makes that an error. The
 *    shared client sets 3 on purpose - that ceiling is what lets the rate
 *    limiter fail fast and fall open, so it must not be relaxed to suit this.
 *
 * 2. A worker's connection is occupied while it blocks. Sharing one with the
 *    queue producer would mean an enqueue waiting behind a poll.
 *
 * So each caller gets its own, and they are closed together on shutdown.
 */
@Injectable()
export class QueueConnection implements OnModuleDestroy {
  private readonly logger = new Logger(QueueConnection.name);
  private readonly open: Redis[] = [];

  constructor(private readonly config: ConfigService) {}

  create(label: string): Redis {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const conn = new Redis(url, {
      maxRetriesPerRequest: null,
      // A queue that gives up on a reconnect silently stops working, which
      // looks exactly like "no one is asking for narration".
      enableReadyCheck: false,
    });

    conn.on('error', (err) =>
      this.logger.error(`${label} connection error: ${err.message}`),
    );

    this.open.push(conn);
    return conn;
  }

  async onModuleDestroy(): Promise<void> {
    // `quit` waits for in-flight commands; a worker mid-job is closed by its
    // own shutdown hook before this runs.
    await Promise.all(this.open.map((c) => c.quit().catch(() => undefined)));
  }
}
