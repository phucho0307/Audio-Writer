import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmbeddingService } from './embedding.service';
import { GeminiJson } from './gemini-json';
import { ENDING_WORDS, ENDINGS, MOODS, StoryCardsService } from './story-cards.service';

/** Candidates taken from each of the two searches before fusing. */
const POOL = 60;
/** Results returned, and explained. */
const SHOWN = 8;
/** Reciprocal-rank-fusion constant; the usual 60. */
const RRF_K = 60;
const CACHE_TTL = 6 * 3600;
/** Ratings needed before a story's average counts for anything in ranking. */
const RATING_PRIOR = 10;

interface ParsedQuery {
  /** The request restated as a description of the story wanted. */
  query: string;
  genres: string[];
  moods: string[];
  tropes: string[];
  ending: string;
}

export interface DiscoveryResult {
  id: string;
  title: string;
  coverUrl: string | null;
  genres: string[];
  contributionCount: number;
  viewCount: number;
  ratingCount: number;
  ratingSum: number;
  authorName: string | null;
  summary: string;
  moods: string[];
  ending: string;
  why: string;
}

export interface DiscoveryResponse {
  understood: ParsedQuery;
  results: DiscoveryResult[];
  /** How much of the catalogue has a card yet; search only sees those. */
  coverage: { withCard: number; total: number };
}

/**
 * "Hôm nay muốn nghe một truyện buồn, chồng ngoại tình có con với bé ba..."
 *
 * 1. A small model reads the request into filters (genres, moods, motifs,
 *    kind of ending) and a restatement of the story wanted.
 * 2. Hybrid retrieval over story cards: vector similarity on the
 *    restatement, and accent-folded full-text on the words themselves. Fused
 *    by reciprocal rank - cosine distances and ts_rank are not on one scale,
 *    ranks are.
 * 3. Small boosts for matching genre, mood and ending, for rating (Bayesian,
 *    so three five-star ratings do not beat three hundred four-star ones) and
 *    for readership.
 * 4. The model says, in one line each, why the top results fit.
 *
 * Every model step has a fallback, so a quota-exhausted afternoon still gets
 * results, just plainer ones. Answers are cached by normalised request.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly dailyPerReader: number;
  private genresCache: { at: number; list: string[] } | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly llm: GeminiJson,
    private readonly embeddings: EmbeddingService,
    private readonly cards: StoryCardsService,
  ) {
    this.dailyPerReader = Number(config.get('DISCOVERY_DAILY', 20));
  }

  async search(raw: string, previous: string | undefined, who: string): Promise<DiscoveryResponse> {
    const q = normalise(raw);
    if (q.length < 3) {
      throw new HttpException({ code: 'QUERY_TOO_SHORT', message: 'Tả thêm một chút về truyện bạn muốn nghe.' }, 400);
    }
    const prev = previous ? normalise(previous) : '';
    const key = `discovery:v1:${createHash('sha256').update(`${prev}|${q}`).digest('hex')}`;

    const hit = await this.redis.client.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as DiscoveryResponse;

    // Only answers that cost model calls count against the daily allowance.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const used = await this.redis.incrementWindow(`discovery:daily:${who}:${day}`, 60 * 60 * 48);
    if (used > this.dailyPerReader) {
      throw new HttpException(
        { code: 'DISCOVERY_QUOTA', message: `Hôm nay bạn đã tìm ${this.dailyPerReader} lần. Mai tìm tiếp nhé, hoặc dùng bộ lọc thể loại.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const t0 = Date.now();
    const understood = await this.understand(q, prev);
    const t1 = Date.now();
    const ranked = await this.retrieve(understood, q);
    const t2 = Date.now();
    const { results, degraded } = await this.explain(q, ranked);
    this.logger.log(
      `search ${Date.now() - t0}ms (understand ${t1 - t0}, retrieve ${t2 - t1}, explain ${Date.now() - t2}), ${results.length} results`,
    );
    const response: DiscoveryResponse = { understood, results, coverage: await this.cards.coverage() };

    // A fallback answer (model overloaded) is not kept: the next person to
    // ask the same thing should get the full one once the model is back.
    if (!degraded) {
      await this.redis.client.set(key, JSON.stringify(response), 'EX', CACHE_TTL).catch(() => undefined);
    }
    return response;
  }

  // ------------------------------------------------------------ 1. understand

  private async understand(q: string, prev: string): Promise<ParsedQuery> {
    const genres = await this.knownGenres();
    try {
      const parsed = await this.llm.generate<ParsedQuery>({
        system: `Bạn giúp người đọc tìm truyện tiếng Việt. Đọc yêu cầu và trả về:
- query: viết lại yêu cầu thành 1-2 câu mô tả truyện họ muốn (nhân vật, tình tiết, cảm xúc), như lời giới thiệu truyện.
- genres: 0-3 thể loại, chỉ chọn trong danh sách cho phép, và chỉ khi người đọc nhắc tới hoặc hiển nhiên.
- moods: 0-3 cảm xúc, chỉ chọn trong danh sách cho phép.
- tropes: 0-6 tình tiết cụ thể bằng cụm từ ngắn, ví dụ "chồng ngoại tình", "tiểu tam mang thai".
- ending: HE (có hậu), SE (buồn), OE (mở), hoặc ANY nếu người đọc không nói.
Nếu có yêu cầu trước đó, đây là lời nói thêm: gộp cả hai thành một yêu cầu.`,
        prompt: [
          prev ? `Yêu cầu trước: ${prev}` : '',
          `Yêu cầu: ${q}`,
          `Thể loại cho phép: ${genres.join(', ')}`,
          `Cảm xúc cho phép: ${MOODS.join(', ')}`,
        ].filter(Boolean).join('\n'),
        schema: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING' },
            genres: { type: 'ARRAY', items: { type: 'STRING' } },
            moods: { type: 'ARRAY', items: { type: 'STRING', enum: [...MOODS] } },
            tropes: { type: 'ARRAY', items: { type: 'STRING' } },
            ending: { type: 'STRING', enum: [...ENDINGS.filter((e) => e !== 'UNKNOWN'), 'ANY'] },
          },
          required: ['query', 'genres', 'moods', 'tropes', 'ending'],
        },
        maxOutputTokens: 400,
      });
      const known = new Set(genres.map((g) => g.toLowerCase()));
      parsed.genres = parsed.genres.filter((g) => known.has(g.toLowerCase())).slice(0, 3);
      return parsed;
    } catch (err) {
      this.logger.warn(`could not parse request, searching it as typed: ${(err as Error).message}`);
      return { query: prev ? `${prev}. ${q}` : q, genres: [], moods: [], tropes: [], ending: 'ANY' };
    }
  }

  /** Genre tags actually in use, so the model can only pick ones that exist. */
  private async knownGenres(): Promise<string[]> {
    if (this.genresCache && Date.now() - this.genresCache.at < 3600_000) return this.genresCache.list;
    const rows = await this.prisma.$queryRaw<{ g: string }[]>`
      SELECT DISTINCT unnest(genres) AS g FROM stories WHERE visibility = 'PUBLIC'`;
    const list = rows.map((r) => r.g).filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
    this.genresCache = { at: Date.now(), list };
    return list;
  }

  // -------------------------------------------------------------- 2. retrieve

  private async retrieve(p: ParsedQuery, typed: string) {
    let vector: number[] | null = null;
    try {
      vector = await this.embeddings.embedOne(
        [p.query, ...p.tropes].join('. '),
        'RETRIEVAL_QUERY',
      );
    } catch (err) {
      this.logger.warn(`query embedding failed, keyword search only: ${(err as Error).message}`);
    }

    const byMeaning = vector
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT c."storyId" AS id
          FROM story_cards c JOIN stories s ON s.id = c."storyId"
          WHERE s.visibility = 'PUBLIC' AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> ${`[${vector.join(',')}]`}::vector
          LIMIT ${POOL}`
      : [];

    // Words the reader typed plus the motifs the model named, OR-ed, so one
    // rare word ("bé ba", "tiệm nail") is enough to surface a story.
    const words = [typed, ...p.tropes].join(' ');
    const byWords = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."storyId" AS id
      FROM story_cards c JOIN stories s ON s.id = c."storyId",
           to_tsquery('simple', array_to_string(
             tsvector_to_array(to_tsvector('simple', immutable_unaccent(${words}))), ' | ')) q
      WHERE s.visibility = 'PUBLIC' AND q IS NOT NULL AND c.search @@ q
      ORDER BY ts_rank(c.search, q) DESC
      LIMIT ${POOL}`;

    const score = new Map<string, number>();
    const fuse = (list: { id: string }[]) =>
      list.forEach((r, i) => score.set(r.id, (score.get(r.id) ?? 0) + 1 / (RRF_K + i + 1)));
    fuse(byMeaning);
    fuse(byWords);
    if (score.size === 0) return [];

    const candidates = await this.prisma.story.findMany({
      where: { id: { in: [...score.keys()] } },
      select: {
        id: true, title: true, coverUrl: true, genres: true, contributionCount: true,
        viewCount: true, ratingCount: true, ratingSum: true, textSource: true,
        card: { select: { summary: true, moods: true, ending: true, tropes: true } },
      },
    });

    const mean = await this.meanRating();
    const wantGenres = new Set(p.genres.map((g) => g.toLowerCase()));
    const wantMoods = new Set(p.moods);
    const boosted = candidates.map((s) => {
      let b = score.get(s.id) ?? 0;
      // Each boost is worth a few places in one list, never the whole answer:
      // what the story is about stays the main thing.
      if (s.genres.some((g) => wantGenres.has(g.toLowerCase()))) b += 0.006;
      b += 0.003 * (s.card?.moods.filter((m) => wantMoods.has(m)).length ?? 0);
      if (p.ending !== 'ANY' && s.card?.ending === p.ending) b += 0.006;
      if (p.ending !== 'ANY' && s.card && s.card.ending !== p.ending && s.card.ending !== 'UNKNOWN') b -= 0.006;
      const bayes = (s.ratingSum + RATING_PRIOR * mean) / (s.ratingCount + RATING_PRIOR);
      b += 0.002 * (bayes - mean);
      b += 0.0008 * Math.log10(1 + s.viewCount);
      return { s, b };
    });
    boosted.sort((x, y) => y.b - x.b);
    return boosted.slice(0, SHOWN).map((x) => x.s);
  }

  private async meanRating(): Promise<number> {
    const agg = await this.prisma.story.aggregate({ _sum: { ratingSum: true, ratingCount: true } });
    const n = agg._sum.ratingCount ?? 0;
    return n > 0 ? (agg._sum.ratingSum ?? 0) / n : 4;
  }

  // --------------------------------------------------------------- 3. explain

  private async explain(
    q: string,
    stories: Awaited<ReturnType<DiscoveryService['retrieve']>>,
  ): Promise<{ results: DiscoveryResult[]; degraded: boolean }> {
    let degraded = false;
    let why = new Map<string, string>();
    // Stories the model judged not to fit at all. Hidden: a list of eight
    // "this one is not what you asked for" helps nobody.
    const misses = new Set<string>();
    if (stories.length) {
      try {
        // Numbered, not by id: the model escapes Vietnamese as \u-sequences, so
        // every character of output counts, and eight UUIDs pushed the answer
        // past the token limit, cutting the JSON off mid-string.
        const out = await this.llm.generate<{ items: { n: number; fit: string; why: string }[] }>({
          system: `Với mỗi truyện, đánh giá mức độ hợp với yêu cầu của người đọc:
- fit: "good" nếu đúng điều họ muốn, "partial" nếu hợp một phần quan trọng, "poor" nếu gần như không liên quan.
- why: một câu tiếng Việt (tối đa 25 từ) nói phần nào của truyện hợp với họ: nhắc đúng tình tiết hoặc cảm xúc họ muốn. Với "partial", nói thật phần nào hợp. Không mở đầu bằng "Truyện này".`,
          prompt: [
            `Yêu cầu: ${q}`,
            ...stories.map((s, i) =>
              `[${i + 1}] ${s.title}: ${s.card?.summary ?? ''} Tình tiết: ${s.card?.tropes.join(', ') ?? ''}. ${s.card ? ENDING_WORDS[s.card.ending] : ''}.`,
            ),
          ].join('\n'),
          schema: {
            type: 'OBJECT',
            properties: {
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    n: { type: 'INTEGER' },
                    fit: { type: 'STRING', enum: ['good', 'partial', 'poor'] },
                    why: { type: 'STRING' },
                  },
                  required: ['n', 'fit', 'why'],
                },
              },
            },
            required: ['items'],
          },
          temperature: 0.4,
          maxOutputTokens: 2500,
        });
        const items = out.items.filter((i) => stories[i.n - 1]);
        why = new Map(items.map((i) => [stories[i.n - 1].id, i.why]));
        for (const i of items) if (i.fit === 'poor') misses.add(stories[i.n - 1].id);
      } catch (err) {
        degraded = true;
        this.logger.warn(`could not explain results, showing summaries: ${(err as Error).message}`);
      }
    }

    const results = stories.filter((s) => !misses.has(s.id)).map((s) => ({
      id: s.id,
      title: s.title,
      coverUrl: s.coverUrl,
      genres: s.genres,
      contributionCount: s.contributionCount,
      viewCount: s.viewCount,
      ratingCount: s.ratingCount,
      ratingSum: s.ratingSum,
      authorName: (s.textSource as { authorName?: string } | null)?.authorName ?? null,
      summary: s.card?.summary ?? '',
      moods: s.card?.moods ?? [],
      ending: s.card?.ending ?? 'UNKNOWN',
      why: why.get(s.id) ?? s.card?.summary ?? '',
    }));
    return { results, degraded };
  }
}

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 400);
}
