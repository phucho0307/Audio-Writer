import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SHOWN = 6;
/** A story's neighbours change only when cards are written; hours are fine. */
const CACHE_SECONDS = 6 * 3600;

export interface RelatedStory {
  id: string;
  title: string;
  coverUrl: string | null;
  genres: string[];
  contributionCount: number;
  authorName: string | null;
}

export interface Related {
  /** `similar`: nearest by what the story is about. `genre`: shares a genre, most read first. */
  basis: 'similar' | 'genre';
  stories: RelatedStory[];
}

/**
 * "Truyện tương tự" under a story.
 *
 * No model call: every story already has a card with an embedding (written
 * once for AI search), and "similar" is the nearest embeddings to this
 * story's own - one indexed query. A story whose card is not written yet
 * falls back to the most-read stories sharing a genre, and says which of the
 * two it is, so the heading never claims a similarity nobody measured.
 */
@Injectable()
export class RelatedService {
  private readonly logger = new Logger(RelatedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async for(storyId: string): Promise<Related> {
    const key = `related:v1:${storyId}`;
    try {
      const hit = await this.redis.client.get(key);
      if (hit) return JSON.parse(hit) as Related;
    } catch {
      // Cache unreachable: compute it.
    }

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { visibility: true, genres: true },
    });
    if (!story || story.visibility === Visibility.PRIVATE) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Không tìm thấy truyện.' });
    }

    let basis: Related['basis'] = 'similar';
    let ids = await this.nearest(storyId);
    if (ids.length === 0) {
      basis = 'genre';
      ids = await this.sameGenre(storyId, story.genres);
    }

    const result: Related = { basis, stories: await this.hydrate(ids) };
    // An empty answer is cached briefly only: the card may be written soon.
    const ttl = result.stories.length > 0 && basis === 'similar' ? CACHE_SECONDS : 15 * 60;
    await this.redis.client.set(key, JSON.stringify(result), 'EX', ttl).catch(() => undefined);
    return result;
  }

  /** Nearest cards to this story's own; empty when it has no embedding yet. */
  private async nearest(storyId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT c."storyId" AS id
        FROM story_cards c
        JOIN stories s ON s.id = c."storyId"
        JOIN story_cards me ON me."storyId" = ${storyId}::uuid
        WHERE s.visibility = 'PUBLIC'
          AND c.embedding IS NOT NULL AND me.embedding IS NOT NULL
          AND c."storyId" <> me."storyId"
        ORDER BY c.embedding <=> me.embedding
        LIMIT ${SHOWN}`;
      return rows.map((r) => r.id);
    } catch (err) {
      this.logger.warn(`similar-story lookup failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Public stories sharing the most genres with this one, most read first. */
  private async sameGenre(storyId: string, genres: string[]): Promise<string[]> {
    if (genres.length === 0) return [];
    const wanted = genres.map((g) => g.toLowerCase());
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id
      FROM stories s
      WHERE s.visibility = 'PUBLIC' AND s."contributionCount" > 0 AND s.id <> ${storyId}::uuid
        AND EXISTS (SELECT 1 FROM unnest(s.genres) g WHERE lower(g) = ANY(${wanted}))
      ORDER BY (SELECT count(*) FROM unnest(s.genres) g WHERE lower(g) = ANY(${wanted})) DESC,
               s."viewCount" DESC
      LIMIT ${SHOWN}`;
    return rows.map((r) => r.id);
  }

  private async hydrate(ids: string[]): Promise<RelatedStory[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.story.findMany({
      where: { id: { in: ids }, visibility: Visibility.PUBLIC },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        genres: true,
        contributionCount: true,
        textSource: true,
        owner: { select: { displayName: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        id: r.id,
        title: r.title,
        coverUrl: r.coverUrl,
        genres: r.genres,
        contributionCount: r.contributionCount,
        authorName: (r.textSource as { authorName?: string } | null)?.authorName ?? r.owner.displayName ?? null,
      }));
  }
}
