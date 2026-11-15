import { Injectable, Logger } from '@nestjs/common';
import { ChunkKind, Genre, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface Passage {
  id: string;
  kind: ChunkKind;
  genre: Genre | null;
  text: string;
  /** Where it came from, for the citation the writer sees. */
  label: string;
  score: number;
}

/** Passages longer than this are split; shorter ones are left whole. */
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;

/**
 * Retrieval over two corpora at once: how the genre works, and how this story
 * has been going.
 *
 * Both halves matter and neither is sufficient. Craft notes alone produce
 * competent genre pastiche that ignores the story; the story alone produces
 * more of the same scene. Mixed, a continuation can follow this story's own
 * threads while still turning the way the genre turns.
 *
 * Nothing scraped goes in here. The craft notes are ours, and chapters belong
 * to the people who wrote them on this platform.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
  ) {}

  // ---------------------------------------------------------------- search

  /**
   * Hybrid search, fused by reciprocal rank.
   *
   * Vector search finds passages that mean the same thing in different words;
   * full-text finds the ones that share a rare word - a character's name, a
   * place, "bùa ngải". Each fails where the other works: embeddings miss exact
   * names, keywords miss paraphrase.
   *
   * RRF rather than a weighted sum of scores: a cosine distance and a
   * ts_rank are not on the same scale and no constant makes them comparable.
   * Ranks are, so the fusion uses position rather than score, and needs no
   * tuning when either side changes.
   */
  async search(
    query: string,
    opts: {
      genre?: Genre | null;
      storyId?: string | null;
      limit?: number;
      kinds?: ChunkKind[];
      /**
       * Who is asking. Chapter passages come back only if this person could
       * read them on the site - see `readableBy`. Null means a stranger, who
       * gets craft notes and public, unlocked chapters only.
       */
      viewerId?: string | null;
    } = {},
  ): Promise<Passage[]> {
    const limit = opts.limit ?? 6;
    if (!query.trim()) return [];

    const pool = Math.max(limit * 4, 20);
    const kinds = opts.kinds ?? [ChunkKind.CRAFT, ChunkKind.CHAPTER];

    const [dense, lexical] = await Promise.all([
      this.vectorSearch(query, { ...opts, kinds, pool }),
      this.textSearch(query, { ...opts, kinds, pool }),
    ]);

    // k dampens the top of each list so one search cannot dominate on its own;
    // 60 is the value the RRF paper settles on and it has held up since.
    const k = 60;
    const scores = new Map<string, number>();
    const seen = new Map<string, Row>();

    for (const list of [dense, lexical]) {
      list.forEach((row, i) => {
        scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (k + i + 1));
        seen.set(row.id, row);
      });
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => {
        const row = seen.get(id)!;
        return {
          id: row.id,
          kind: row.kind,
          genre: row.genre,
          text: row.text,
          label: row.label ?? 'ghi chú',
          score,
        };
      });
  }

  private async vectorSearch(
    query: string,
    opts: {
      genre?: Genre | null;
      storyId?: string | null;
      kinds: ChunkKind[];
      pool: number;
      viewerId?: string | null;
    },
  ): Promise<Row[]> {
    if (!this.embeddings.available) return [];

    const vector = await this.embeddings.embedOne(query, 'RETRIEVAL_QUERY');
    const literal = `[${vector.join(',')}]`;

    // Raw SQL because Prisma has no vector type. Every value is still a bound
    // parameter - the vector arrives as a string and is cast in SQL, not
    // concatenated into it.
    return this.prisma.$queryRaw<Row[]>`
      SELECT c.id, c.kind, c.genre, c.text,
             COALESCE(n.title, s.title, 'chương') AS label
      FROM rag_chunks c
      LEFT JOIN craft_notes n ON n.id = c."craftNoteId"
      LEFT JOIN stories s ON s.id = c."storyId"
      WHERE c.embedding IS NOT NULL
        AND c.kind = ANY(${opts.kinds}::"ChunkKind"[])
        AND (${opts.genre}::"Genre" IS NULL OR c.genre = ${opts.genre}::"Genre")
        AND (${opts.storyId}::uuid IS NULL OR c.kind = 'CRAFT' OR c."storyId" = ${opts.storyId}::uuid)
        AND ${readableBy(opts.viewerId ?? null, opts.storyId ?? null)}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${opts.pool}
    `;
  }

  private async textSearch(
    query: string,
    opts: {
      genre?: Genre | null;
      storyId?: string | null;
      kinds: ChunkKind[];
      pool: number;
      viewerId?: string | null;
    },
  ): Promise<Row[]> {
    // websearch_to_tsquery takes what a person would actually type - quotes,
    // "or", a stray minus - without throwing on syntax the way to_tsquery does.
    return this.prisma.$queryRaw<Row[]>`
      SELECT c.id, c.kind, c.genre, c.text,
             COALESCE(n.title, s.title, 'chương') AS label
      FROM rag_chunks c
      LEFT JOIN craft_notes n ON n.id = c."craftNoteId"
      LEFT JOIN stories s ON s.id = c."storyId"
      WHERE c.search @@ websearch_to_tsquery('simple', immutable_unaccent(${query}))
        AND c.kind = ANY(${opts.kinds}::"ChunkKind"[])
        AND (${opts.genre}::"Genre" IS NULL OR c.genre = ${opts.genre}::"Genre")
        AND (${opts.storyId}::uuid IS NULL OR c.kind = 'CRAFT' OR c."storyId" = ${opts.storyId}::uuid)
        AND ${readableBy(opts.viewerId ?? null, opts.storyId ?? null)}
      ORDER BY ts_rank(c.search, websearch_to_tsquery('simple', immutable_unaccent(${query}))) DESC
      LIMIT ${opts.pool}
    `;
  }

  // --------------------------------------------------------------- ingest

  /** Re-embed every craft note. Cheap enough to run whole. */
  async indexCraftNotes(): Promise<{ notes: number; chunks: number }> {
    const notes = await this.prisma.craftNote.findMany();
    await this.prisma.ragChunk.deleteMany({ where: { kind: ChunkKind.CRAFT } });

    const rows: { text: string; genre: Genre; craftNoteId: string }[] = [];
    for (const note of notes) {
      for (const piece of chunk(`${note.title}\n\n${note.body}`)) {
        rows.push({ text: piece, genre: note.genre, craftNoteId: note.id });
      }
    }

    await this.store(
      rows.map((r) => ({ ...r, kind: ChunkKind.CRAFT, storyId: null, contributionId: null })),
    );
    return { notes: notes.length, chunks: rows.length };
  }

  /**
   * Index one chapter.
   *
   * Called when a chapter is committed rather than on a schedule, so a
   * continuation can draw on what was written a minute ago - which is most of
   * the value for a serial.
   */
  async indexChapter(contributionId: string): Promise<number> {
    const c = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: {
        id: true,
        textPlain: true,
        branch: { select: { storyId: true, story: { select: { genres: true } } } },
      },
    });
    if (!c?.textPlain.trim()) return 0;

    await this.prisma.ragChunk.deleteMany({ where: { contributionId } });

    const genre = firstKnownGenre(c.branch.story.genres);
    const pieces = chunk(c.textPlain);
    await this.store(
      pieces.map((text) => ({
        text,
        genre,
        kind: ChunkKind.CHAPTER,
        contributionId: c.id,
        storyId: c.branch.storyId,
        craftNoteId: null,
      })),
    );
    return pieces.length;
  }

  /**
   * Index every chapter that has never been indexed.
   *
   * Chapters index themselves when committed, which says nothing about the
   * ones committed before indexing existed - or by a path that forgot to
   * announce them, as forks did. Fifty chapters were sitting unindexed, so
   * the model continuing any of the original stories retrieved nothing from
   * them. Idempotent: an indexed chapter has chunks and is skipped, so this
   * is safe to run on every start.
   */
  async backfillChapters(limit = 500): Promise<number> {
    if (!this.embeddings.available) return 0;
    const missing = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM contributions c
      WHERE length(trim(c."textPlain")) > 0
        AND NOT EXISTS (SELECT 1 FROM rag_chunks r WHERE r."contributionId" = c.id)
      ORDER BY c."createdAt"
      LIMIT ${limit}
    `;
    let done = 0;
    for (const { id } of missing) {
      // One at a time: a backfill should never compete with a writer's
      // request for the embedding quota.
      try {
        if ((await this.indexChapter(id)) > 0) done++;
      } catch (e) {
        this.logger.warn(`backfill skipped ${id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    return done;
  }

  private async store(
    rows: {
      text: string;
      genre: Genre | null;
      kind: ChunkKind;
      craftNoteId: string | null;
      contributionId: string | null;
      storyId: string | null;
    }[],
  ): Promise<void> {
    if (!rows.length) return;

    const vectors = this.embeddings.available
      ? await this.embeddings.embed(
          rows.map((r) => r.text),
          'RETRIEVAL_DOCUMENT',
        )
      : [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const created = await this.prisma.ragChunk.create({
        data: {
          kind: r.kind,
          genre: r.genre,
          text: r.text,
          length: r.text.length,
          craftNoteId: r.craftNoteId,
          contributionId: r.contributionId,
          storyId: r.storyId,
          embeddedBy: vectors[i] ? this.embeddings.fingerprint : null,
        },
        select: { id: true },
      });

      if (vectors[i]) {
        // The one column Prisma cannot write.
        await this.prisma.$executeRaw`
          UPDATE rag_chunks SET embedding = ${`[${vectors[i].join(',')}]`}::vector
          WHERE id = ${created.id}::uuid
        `;
      }
    }
  }

  async stats() {
    const [craft, chapter, embedded] = await Promise.all([
      this.prisma.ragChunk.count({ where: { kind: ChunkKind.CRAFT } }),
      this.prisma.ragChunk.count({ where: { kind: ChunkKind.CHAPTER } }),
      this.prisma.ragChunk.count({ where: { embeddedBy: { not: null } } }),
    ]);
    return { craft, chapter, embedded, model: this.embeddings.fingerprint };
  }
}

/**
 * The rule that keeps the index from becoming a way around the site.
 *
 * Every committed chapter is indexed - private stories, unpublished revision
 * branches, chapters behind the paywall - because the author's own AI needs
 * all of it. Search did not check any of that, so an anonymous
 * `GET /rag/search?storyId=…&kind=CHAPTER` returned the full text of a private
 * story, and the same search feeding a stranger's AI continuation could put a
 * locked chapter into the prompt and out the other side.
 *
 * A chapter passage is returned only when the viewer:
 *   - owns the story, or
 *   - could read it anyway: the story is PUBLIC (or UNLISTED and asked for by
 *     id - unlisted means "by link", not "searchable"), the chapter is not on
 *     a draft branch, and it is not past the free chapters of a paid story.
 *
 * Deliberately stricter than the reader: a purchased unlock is not consulted,
 * so a buyer's AI simply does not draw on locked chapters. Under-retrieving
 * costs a little context; over-retrieving leaks text someone paid for.
 */
function readableBy(viewerId: string | null, storyId: string | null) {
  return Prisma.sql`(
    c.kind = 'CRAFT' OR EXISTS (
      SELECT 1
      FROM stories s2
      JOIN contributions k ON k.id = c."contributionId"
      JOIN branches b2 ON b2.id = k."branchId"
      WHERE s2.id = c."storyId"
        AND (
          s2."ownerId" = ${viewerId}::uuid
          OR (
            (s2.visibility = 'PUBLIC'
              OR (s2.visibility = 'UNLISTED' AND s2.id = ${storyId}::uuid))
            AND b2."isDraft" = false
            AND (s2."unlockPrice" = 0 OR k.depth < s2."freeChapters")
          )
        )
    )
  )`;
}

type Row = {
  id: string;
  kind: ChunkKind;
  genre: Genre | null;
  text: string;
  label: string | null;
};

/**
 * Split on paragraph boundaries, never mid-sentence.
 *
 * A passage cut in the middle of a sentence embeds badly and reads worse when
 * it is shown back as a citation. Paragraphs are the natural unit of prose, so
 * they are the unit here, with a small overlap so a device that spans two
 * paragraphs is still findable from either.
 */
function chunk(text: string): string[] {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (current && current.length + p.length > CHUNK_CHARS) {
      out.push(current);
      const tail = current.slice(-CHUNK_OVERLAP);
      current = `${tail}\n\n${p}`;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Stories carry free-form tags; only the five map onto the index. */
function firstKnownGenre(tags: string[]): Genre | null {
  // Every label the genre picker can produce, plus the English spellings, plus
  // the toneless ones people type. A tag the map does not know leaves the genre
  // null, which only widens retrieval - but a tag it *should* know and does not
  // fails silently, so this list is kept level with the picker on purpose.
  const map: Record<string, Genre> = {
    'kinh dị': Genre.HORROR,
    'kinh di': Genre.HORROR,
    'huyền bí': Genre.HORROR,
    'tâm linh': Genre.HORROR,
    horror: Genre.HORROR,

    'giật gân': Genre.THRILLER,
    'giat gan': Genre.THRILLER,
    'hồi hộp': Genre.THRILLER,
    'trinh thám': Genre.THRILLER,
    'tâm lý': Genre.THRILLER,
    thriller: Genre.THRILLER,

    'ngôn tình': Genre.ROMANCE,
    'ngon tinh': Genre.ROMANCE,
    'lãng mạn': Genre.ROMANCE,
    'lang man': Genre.ROMANCE,
    romance: Genre.ROMANCE,

    'hành động': Genre.ACTION,
    'hanh dong': Genre.ACTION,
    'mạt thế': Genre.ACTION,
    action: Genre.ACTION,

    'ngoại tình': Genre.INFIDELITY,
    'ngoai tinh': Genre.INFIDELITY,
  };
  for (const tag of tags) {
    const hit = map[tag.toLowerCase().trim()];
    if (hit) return hit;
  }
  return null;
}

export { firstKnownGenre };
export type { Prisma };
