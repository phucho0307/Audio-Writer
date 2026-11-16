import { Injectable, Logger } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { GeminiJson } from './gemini-json';

/** Bump when the prompt or the document format changes: cards regenerate. */
export const CARD_VERSION = 1;

/**
 * Moods a card may carry. A closed list, so "buồn" in a reader's request and
 * "buồn" on a card are the same string - free text would drift ("buồn bã",
 * "u buồn", "sad") and never match exactly.
 */
export const MOODS = [
  'buồn', 'ngược', 'day dứt', 'ấm áp', 'chữa lành', 'nhẹ nhàng', 'lãng mạn',
  'hài hước', 'sảng khoái', 'hồi hộp', 'căng thẳng', 'rùng rợn', 'u ám', 'truyền cảm hứng',
] as const;

export const ENDINGS = ['HE', 'SE', 'OE', 'UNKNOWN'] as const;
export const ENDING_WORDS: Record<string, string> = {
  HE: 'kết có hậu',
  SE: 'kết buồn',
  OE: 'kết mở',
  UNKNOWN: 'chưa rõ kết',
};

interface CardJson {
  summary: string;
  tropes: string[];
  moods: string[];
  ending: string;
  keywords: string[];
}

const CARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    tropes: { type: 'ARRAY', items: { type: 'STRING' } },
    moods: { type: 'ARRAY', items: { type: 'STRING', enum: [...MOODS] } },
    ending: { type: 'STRING', enum: [...ENDINGS] },
    keywords: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'tropes', 'moods', 'ending', 'keywords'],
};

const SYSTEM = `Bạn là biên tập viên thư viện truyện tiếng Việt. Đọc phần trích của một truyện và viết thẻ mô tả để người đọc tìm thấy nó khi tả điều họ muốn nghe.
- summary: 2-4 câu, nói rõ ai, chuyện gì, mâu thuẫn chính. Viết tự nhiên, không mở đầu bằng "Truyện kể về".
- tropes: 3-8 motif/tình tiết cụ thể bằng cụm từ ngắn tiếng Việt mà người đọc hay dùng để tìm, ví dụ "chồng ngoại tình", "tiểu tam mang thai", "trọng sinh báo thù", "mẹ chồng nàng dâu", "tình đầu", "nhà có ma".
- moods: 1-4 cảm xúc chủ đạo, chỉ chọn trong danh sách cho phép.
- ending: HE nếu kết có hậu, SE nếu kết buồn, OE nếu kết mở; UNKNOWN nếu phần trích không cho thấy kết.
- keywords: 3-8 từ khoá về bối cảnh, nghề nghiệp, nơi chốn, đồ vật đặc trưng.
Chỉ dựa vào phần trích, không bịa thêm.`;

/**
 * Writes and stores the card that AI search matches against.
 *
 * The model sees the start, a slice of the middle and the end - enough to
 * name the motifs and the kind of ending, which are what readers ask for
 * ("kết buồn", "chồng có con riêng"), at a fraction of the whole text.
 */
@Injectable()
export class StoryCardsService {
  private readonly logger = new Logger(StoryCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: GeminiJson,
    private readonly embeddings: EmbeddingService,
  ) {}

  get available(): boolean {
    return this.llm.available && this.embeddings.available;
  }

  /** Public stories with no card, a stale one, or one from an older prompt. */
  async needingCards(limit: number): Promise<string[]> {
    const rows = await this.prisma.story.findMany({
      where: {
        visibility: Visibility.PUBLIC,
        contributionCount: { gt: 0 },
        OR: [
          { card: null },
          { card: { stale: true } },
          { card: { version: { lt: CARD_VERSION } } },
        ],
      },
      // Stories written here first, then the most read.
      orderBy: [{ viewCount: 'desc' }],
      select: { id: true, textSource: true },
      take: limit * 4,
    });
    rows.sort((a, b) => Number(a.textSource !== null) - Number(b.textSource !== null));
    return rows.slice(0, limit).map((r) => r.id);
  }

  /** Describe one story with the model (one call). Returns null if it has no text. */
  async describe(storyId: string): Promise<{ storyId: string; card: CardJson; document: string } | null> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        title: true,
        synopsis: true,
        genres: true,
        branches: {
          where: { isRoot: true },
          take: 1,
          select: { contributions: { orderBy: { depth: 'asc' }, select: { textPlain: true } } },
        },
      },
    });
    const chapters = story?.branches[0]?.contributions ?? [];
    if (!story || chapters.length === 0) return null;

    const prompt = [
      `Tên truyện: ${story.title}`,
      `Thể loại: ${story.genres.join(', ') || 'chưa gắn'}`,
      story.synopsis ? `Giới thiệu: ${story.synopsis}` : '',
      `Số chương: ${chapters.length}`,
      `Danh sách cảm xúc cho phép: ${MOODS.join(', ')}`,
      '',
      excerpt(chapters.map((c) => c.textPlain)),
    ]
      .filter(Boolean)
      .join('\n');

    const card = await this.llm.generate<CardJson>({
      system: SYSTEM,
      prompt,
      schema: CARD_SCHEMA,
      // Generous: Vietnamese comes back \u-escaped, several times the bytes.
      maxOutputTokens: 2000,
      patient: true,
    });
    card.tropes = card.tropes.slice(0, 8);
    card.keywords = card.keywords.slice(0, 8);
    card.moods = card.moods.filter((m) => (MOODS as readonly string[]).includes(m)).slice(0, 4);
    if (!(ENDINGS as readonly string[]).includes(card.ending)) card.ending = 'UNKNOWN';

    const document = [
      `${story.title}.`,
      `Thể loại: ${story.genres.join(', ')}.`,
      card.summary,
      `Tình tiết: ${card.tropes.join(', ')}.`,
      `Cảm xúc: ${card.moods.join(', ')}.`,
      `${ENDING_WORDS[card.ending]}.`,
      `Từ khoá: ${card.keywords.join(', ')}.`,
    ].join(' ');
    return { storyId, card, document };
  }

  /**
   * Store described stories, then embed them. The card is saved first: if
   * the embedding call fails (its quota is separate and can run out), the
   * model's work is kept, the story is already findable by keyword, and
   * embedMissing() fills the vector in on a later pass.
   */
  async store(described: { storyId: string; card: CardJson; document: string }[]): Promise<void> {
    if (described.length === 0) return;
    for (const { storyId, card, document } of described) {
      const data = {
        summary: card.summary,
        tropes: card.tropes,
        moods: card.moods,
        ending: card.ending,
        keywords: card.keywords,
        document,
        model: this.llm.model,
        version: CARD_VERSION,
        stale: false,
      };
      await this.prisma.storyCard.upsert({
        where: { storyId },
        create: { storyId, ...data },
        update: data,
      });
      // A rewritten card must not keep the old card's vector.
      await this.prisma.$executeRaw`UPDATE story_cards SET embedding = NULL WHERE "storyId" = ${storyId}::uuid`;
    }
    await this.embedMissing(described.length);
  }

  /** Embed cards that have no vector yet, oldest first. Returns how many. */
  async embedMissing(limit: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ storyId: string; document: string }[]>`
      SELECT "storyId", document FROM story_cards
      WHERE embedding IS NULL ORDER BY "updatedAt" LIMIT ${limit}`;
    if (rows.length === 0) return 0;
    const vectors = await this.embeddings.embed(rows.map((r) => r.document), 'RETRIEVAL_DOCUMENT');
    for (let i = 0; i < rows.length; i++) {
      await this.prisma.$executeRaw`
        UPDATE story_cards SET embedding = ${`[${vectors[i].join(',')}]`}::vector
        WHERE "storyId" = ${rows[i].storyId}::uuid`;
    }
    return rows.length;
  }

  async missingEmbeddings(): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM story_cards WHERE embedding IS NULL`;
    return Number(n);
  }

  /** The story changed: describe it again on the next pass. */
  async markStale(storyId: string): Promise<void> {
    await this.prisma.storyCard.updateMany({ where: { storyId }, data: { stale: true } });
  }

  async coverage(): Promise<{ withCard: number; total: number }> {
    const [withCard, total] = await Promise.all([
      this.prisma.storyCard.count({ where: { story: { visibility: Visibility.PUBLIC } } }),
      this.prisma.story.count({ where: { visibility: Visibility.PUBLIC, contributionCount: { gt: 0 } } }),
    ]);
    return { withCard, total };
  }
}

/**
 * Start, middle and end of the text, about 5,000 characters in all. The end
 * matters as much as the start: "kết buồn hay có hậu" is half of what a
 * reader asks.
 */
function excerpt(chapters: string[]): string {
  const text = chapters.join('\n\n');
  if (text.length <= 5000) return `Toàn văn:\n${text}`;
  const head = text.slice(0, 2600);
  const mid = text.slice(Math.floor(text.length / 2) - 600, Math.floor(text.length / 2) + 600);
  const tail = text.slice(-1200);
  return `Phần đầu:\n${head}\n\n[...]\n\nĐoạn giữa:\n${mid}\n\n[...]\n\nPhần cuối:\n${tail}`;
}
