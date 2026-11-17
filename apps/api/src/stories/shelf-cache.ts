import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { DomainEvents } from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const KEY = 'shelf:public:v1';
/** Present while the stored copy is current; its absence means "rebuild". */
const FRESH = `${KEY}:fresh`;
/** View counts and the like may lag this long. */
const FRESH_SECONDS = 60;
/** The stored copy outlives its freshness, so there is something to serve while rebuilding. */
const KEEP_SECONDS = 24 * 3600;

/**
 * The public shelf - every PUBLIC story - as ready-made JSON.
 *
 * It is the first thing both the front page and Khám phá ask for, it is the
 * same for every visitor, and building it is a three-query read of the whole
 * catalogue: seconds when the database is far away, and never free. So it is
 * built once and kept in Redis, where every API replica shares it.
 *
 * Stale-while-revalidate: a reader is always answered from the stored copy
 * at once; if that copy is past its minute, or something was just published,
 * the rebuild happens behind them. Nobody waits for the database except the
 * very first request after Redis was emptied.
 */
@Injectable()
export class ShelfCache implements OnApplicationBootstrap {
  private readonly logger = new Logger(ShelfCache.name);
  private rebuilding: Promise<string> | null = null;
  /** Bumped on every invalidation, so a rebuild that raced a write is not marked fresh. */
  private generation = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: DomainEvents,
  ) {}

  onApplicationBootstrap(): void {
    this.events.on('story.published', () => this.invalidate());
    this.events.on('chapter.committed', () => this.invalidate());
    this.events.on('story.changed', () => this.invalidate());
  }

  /** The shelf as JSON text, ready to send. */
  async json(): Promise<string> {
    let body: string | null = null;
    let fresh: string | null = null;
    try {
      [body, fresh] = await this.redis.client.mget(KEY, FRESH);
    } catch (err) {
      // Redis down: the shelf still has to load. Straight from the database.
      this.logger.warn(`shelf cache unreadable: ${(err as Error).message}`);
      return this.build();
    }
    if (!body) return this.rebuild();
    if (!fresh) void this.rebuild().catch(() => undefined);
    return body;
  }

  /**
   * Something on the shelf changed (published, edited, removed, a new
   * chapter). The stored copy stays - it is still better than a wait - and a
   * rebuild starts now, so it is usually ready before anyone asks.
   */
  async invalidate(): Promise<void> {
    this.generation++;
    try {
      await this.redis.client.del(FRESH);
    } catch {
      // Unreachable Redis: the copy simply ages out.
    }
    void this.rebuild().catch(() => undefined);
  }

  /** One rebuild at a time per process, however many readers ask. */
  private rebuild(): Promise<string> {
    this.rebuilding ??= (async () => {
      try {
        for (;;) {
          const started = this.generation;
          const body = await this.build();
          await this.redis.client.set(KEY, body, 'EX', KEEP_SECONDS).catch(() => undefined);
          // A write landed while this was reading: what was read may predate it.
          if (started !== this.generation) continue;
          await this.redis.client.set(FRESH, '1', 'EX', FRESH_SECONDS).catch(() => undefined);
          return body;
        }
      } catch (err) {
        this.logger.error(`shelf rebuild failed: ${(err as Error).message}`);
        throw err;
      } finally {
        this.rebuilding = null;
      }
    })();
    return this.rebuilding;
  }

  private async build(): Promise<string> {
    const stories = await this.prisma.story.findMany({
      where: { visibility: Visibility.PUBLIC },
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { handle: true, displayName: true } },
        branches: { where: { isRoot: true }, select: { id: true }, take: 1 },
      },
    });
    return JSON.stringify(stories);
  }
}
