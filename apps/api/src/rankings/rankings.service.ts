import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DomainEvents } from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { averageOf } from '../ratings/ratings.service';

export type BoardKind = 'best' | 'hot';

/**
 * How many imaginary average ratings every story starts with. A story with
 * one 5-star rating should not outrank one with forty ratings averaging 4.7;
 * with ten phantom votes at the site mean it does not.
 */
export const PRIOR_WEIGHT = 10;
/** Used for the prior until the site has ratings of its own. */
const DEFAULT_MEAN = 3.5;
/** Reads older than this do not make a story hot. */
export const HOT_DAYS = 7;
/** Yesterday's read is worth 85% of today's, last week's about a third. */
export const HOT_DECAY = 0.85;
/** Boards change slowly; recomputing on every page view would be waste. */
const CACHE_SECONDS = 300;

/**
 * The Bayesian average: the story's own mean, pulled towards the site mean
 * by PRIOR_WEIGHT phantom votes. Few ratings stay close to the site mean;
 * many ratings speak for themselves.
 */
export function bayesian(sum: number, count: number, mean: number, weight = PRIOR_WEIGHT): number {
  return (sum + mean * weight) / (count + weight);
}

/** Weights for the daily read counters, today first. */
export function hotWeights(days = HOT_DAYS, decay = HOT_DECAY): number[] {
  return Array.from({ length: days }, (_, i) => Math.pow(decay, i));
}

/** SQL filter for one genre, ignoring case: tags are free text. */
function inGenre(genre: string | null): Prisma.Sql {
  return genre
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM unnest(genres) t WHERE lower(t) = lower(${genre}))`
    : Prisma.empty;
}

export interface BoardEntry {
  rank: number;
  id: string;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  genres: string[];
  authorName: string | null;
  contributionCount: number;
  viewCount: number;
  /** Null until enough readers rated (MIN_RATINGS_SHOWN). */
  average: number | null;
  ratingCount: number;
  /** Reads in the last HOT_DAYS days, unweighted. Hot board only. */
  recentReads: number | null;
}

export interface Board {
  kind: BoardKind;
  genre: string | null;
  /** Hot board with no reads recorded yet falls back to all-time reads. */
  fallback: boolean;
  entries: BoardEntry[];
}

/**
 * Story rankings, overall or within a genre.
 *
 * - **Hay nhất**: Bayesian average of readers' stars. Only rated stories
 *   qualify - ranking unrated stories by anything else under a "best" heading
 *   would be a claim nobody made.
 * - **Đang hot**: reads over the last week, recent days weighted more. Each
 *   day is a Redis sorted set (story -> reads), so a read is one ZINCRBY and
 *   the board is one ZUNIONSTORE; nothing scans the stories table per view.
 *
 * Genre is a filter on the same score, not a separate ranking, so a story
 * holds the same place relative to its neighbours on every board it is on.
 */
@Injectable()
export class RankingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: DomainEvents,
  ) {}

  onApplicationBootstrap(): void {
    this.events.on('story.viewed', ({ storyId }) => this.recordRead(storyId));
  }

  private dayKey(offset = 0): string {
    const d = new Date(Date.now() - offset * 86_400_000);
    return `rank:reads:${d.toISOString().slice(0, 10)}`;
  }

  async recordRead(storyId: string): Promise<void> {
    const key = this.dayKey();
    await this.redis.client
      .multi()
      .zincrby(key, 1, storyId)
      // Kept a little longer than the window so the oldest day is still there.
      .expire(key, (HOT_DAYS + 2) * 86_400)
      .exec();
  }

  /** Genres in use on public stories, most stories first. */
  async genres(): Promise<{ genre: string; count: number }[]> {
    // Tags are free text, so "Gia đình" and "gia đình" are one genre, shown
    // under whichever spelling more stories use.
    const rows = await this.prisma.$queryRaw<{ genre: string; n: bigint }[]>`
      SELECT mode() WITHIN GROUP (ORDER BY g) AS genre, count(DISTINCT id) AS n
      FROM stories, unnest(genres) AS g
      WHERE visibility = 'PUBLIC' AND "contributionCount" > 0
      GROUP BY lower(g) ORDER BY n DESC, genre LIMIT 40`;
    return rows.map((r) => ({ genre: r.genre, count: Number(r.n) }));
  }

  async board(kind: BoardKind, genre: string | null, limit = 20): Promise<Board> {
    const n = Math.min(Math.max(limit, 1), 50);
    const cacheKey = `rank:board:v1:${createHash('sha1').update(`${kind}|${genre ?? ''}|${n}`).digest('hex')}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return JSON.parse(cached) as Board;

    const board = kind === 'hot' ? await this.hot(genre, n) : await this.best(genre, n);
    await this.redis.client.set(cacheKey, JSON.stringify(board), 'EX', CACHE_SECONDS);
    return board;
  }

  private async best(genre: string | null, n: number): Promise<Board> {
    const [site] = await this.prisma.$queryRaw<{ sum: bigint | null; count: bigint | null }[]>`
      SELECT sum("ratingSum") AS sum, sum("ratingCount") AS count
      FROM stories WHERE visibility = 'PUBLIC'`;
    const total = Number(site?.count ?? 0);
    const mean = total > 0 ? Number(site.sum) / total : DEFAULT_MEAN;

    const genreFilter = inGenre(genre);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM stories
      WHERE visibility = 'PUBLIC' AND "ratingCount" > 0 ${genreFilter}
      ORDER BY ("ratingSum" + ${mean * PRIOR_WEIGHT}::float8) / ("ratingCount" + ${PRIOR_WEIGHT}) DESC,
               "ratingCount" DESC, "viewCount" DESC
      LIMIT ${n}`;
    return { kind: 'best', genre, fallback: false, entries: await this.hydrate(rows.map((r) => r.id), null) };
  }

  private async hot(genre: string | null, n: number): Promise<Board> {
    const keys = hotWeights().map((_, i) => this.dayKey(i));
    const union = `rank:hot:${keys[0]}`;
    // Rebuilt at most once per cache period; every genre board reads it.
    if (!(await this.redis.client.exists(union))) {
      await this.redis.client.zunionstore(union, keys.length, ...keys, 'WEIGHTS', ...hotWeights(), 'AGGREGATE', 'SUM');
      await this.redis.client.expire(union, CACHE_SECONDS);
    }
    // Generous: a genre filter throws most of these away.
    const top = await this.redis.client.zrevrange(union, 0, genre ? 999 : n * 3 - 1);

    let ids: string[] = [];
    if (top.length > 0) {
      const allowed = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM stories
        WHERE id = ANY(${top}::uuid[]) AND visibility = 'PUBLIC' ${inGenre(genre)}`;
      const ok = new Set(allowed.map((s) => s.id));
      ids = top.filter((id) => ok.has(id)).slice(0, n);
    }

    if (ids.length === 0) {
      // A fresh deployment has no read history: say so, and rank by all-time reads.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM stories
        WHERE visibility = 'PUBLIC' AND "contributionCount" > 0 ${inGenre(genre)}
        ORDER BY "viewCount" DESC, "updatedAt" DESC
        LIMIT ${n}`;
      return { kind: 'hot', genre, fallback: true, entries: await this.hydrate(rows.map((r) => r.id), null) };
    }

    const recent = await this.recentReads(ids, keys);
    return { kind: 'hot', genre, fallback: false, entries: await this.hydrate(ids, recent) };
  }

  /** Plain read counts over the window, for display. */
  private async recentReads(ids: string[], keys: string[]): Promise<Map<string, number>> {
    const pipe = this.redis.client.pipeline();
    for (const key of keys) pipe.zmscore(key, ...ids);
    const res = (await pipe.exec()) ?? [];
    const out = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const [err, scores] of res) {
      if (err) continue;
      (scores as (string | null)[]).forEach((s, i) => {
        if (s) out.set(ids[i], out.get(ids[i])! + Number(s));
      });
    }
    return out;
  }

  private async hydrate(ids: string[], recent: Map<string, number> | null): Promise<BoardEntry[]> {
    if (ids.length === 0) return [];
    const stories = await this.prisma.story.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, title: true, synopsis: true, coverUrl: true, genres: true, textSource: true,
        contributionCount: true, viewCount: true, ratingCount: true, ratingSum: true,
        owner: { select: { displayName: true, handle: true } },
      },
    });
    const byId = new Map(stories.map((s) => [s.id, s]));
    return ids
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s, i) => {
        const source = s.textSource as { authorName?: string } | null;
        return {
          rank: i + 1,
          id: s.id,
          title: s.title,
          synopsis: s.synopsis,
          coverUrl: s.coverUrl,
          genres: s.genres,
          authorName: source?.authorName ?? s.owner.displayName ?? s.owner.handle,
          contributionCount: s.contributionCount,
          viewCount: s.viewCount,
          average: averageOf(s.ratingCount, s.ratingSum).average,
          ratingCount: s.ratingCount,
          recentReads: recent ? (recent.get(s.id) ?? 0) : null,
        };
      });
  }
}
