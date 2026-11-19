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
  /** The front page's slice of the last shelf it was cut from. */
  private home: { from: string; json: string } | null = null;

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
   * What the front page needs, and nothing else: the first five covers, the
   * stories written here (today's pick is chosen from them), and the totals.
   *
   * The whole shelf is over a megabyte and the front page waited for all of
   * it before drawing a single cover. This is a few dozen stories, cut from
   * the same cached shelf, so it is never staler than Khám phá and costs one
   * parse per shelf rebuild.
   */
  async homeJson(): Promise<string> {
    const body = await this.json();
    if (this.home?.from === body) return this.home.json;
    const all = (JSON.parse(body) as Array<{
      id: string;
      coverUrl: string | null;
      textSource: unknown;
      contributionCount: number;
      branchCount: number;
      wordCount: number;
    }>).filter((s) => s.contributionCount > 0);
    const covers = all.filter((s) => s.coverUrl).slice(0, 5);
    const own = all.filter((s) => s.textSource == null);
    const ids = new Set([...covers, ...own].map((s) => s.id));
    const json = JSON.stringify({
      covers: covers.map((s) => s.id),
      stories: all.filter((s) => ids.has(s.id)),
      totals: {
        stories: all.length,
        chapters: all.reduce((n, s) => n + s.contributionCount, 0),
        forks: all.reduce((n, s) => n + Math.max(0, s.branchCount - 1), 0),
        words: all.reduce((n, s) => n + s.wordCount, 0),
      },
    });
    this.home = { from: body, json };
    return json;
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
