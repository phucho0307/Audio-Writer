import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ChunkKind } from '@prisma/client';
import type {
  ContinueRequest,
  LlmDriver,
  Paragraphs,
  PlotOption,
  Pov,
  SeedRequest,
  SuggestRequest,
} from '@aw/shared';
import { RateLimitedError } from '@aw/shared';
import { GeminiDriver } from './drivers/gemini.driver';
import { StoriesService } from '../stories/stories.service';
import { AiQuotaService, type QuotaStatus, type Spend } from './ai-quota.service';
import { RagService, firstKnownGenre } from '../rag/rag.service';
import { CurrentUserService } from '../auth/current-user.service';
import { RedisService } from '../redis/redis.service';

/**
 * How long a set of plot suggestions is kept for reuse. Suggestions depend
 * only on the text they were made from, which never changes under a key, so
 * this is about memory, not staleness.
 */
const SUGGEST_TTL_SECONDS = 30 * 24 * 3600;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly drivers: LlmDriver[];

  constructor(
    private readonly config: ConfigService,
    private readonly stories: StoriesService,
    private readonly quota: AiQuotaService,
    private readonly rag: RagService,
    private readonly currentUser: CurrentUserService,
    private readonly redis: RedisService,
  ) {
    // Ordered failover chain. More drivers land here as they are written; the
    // chain is what makes a rate-limited free tier survivable.
    this.drivers = [
      new GeminiDriver(
        this.config.get<string>('GEMINI_API_KEY', ''),
        this.config.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
      ),
    ].filter((d) => d.isConfigured());

    if (!this.drivers.length) {
      this.logger.warn('No LLM driver configured - AI endpoints will fail.');
    }
  }

  get available(): boolean {
    return this.drivers.length > 0;
  }

  private first(): LlmDriver {
    const driver = this.drivers[0];
    if (!driver) {
      throw new BadRequestException(
        'No AI provider is configured. Set GEMINI_API_KEY.',
      );
    }
    return driver;
  }

  /**
   * Genres are the one thing the AI genuinely cannot work without - they are
   * the whole brief for a cold open. Writing solo never reaches this check.
   */
  private requireGenres(genres: string[], action: string): void {
    if (!genres.length) {
      throw new BadRequestException({
        code: 'GENRES_REQUIRED',
        message: `Chọn thể loại trước khi ${action}.`,
        hint: 'Genres are the brief the AI writes against. Pick at least one.',
      });
    }
  }

  // -------------------------------------------------------------------------

  async *seed(
    storyId: string,
    opts: { pov?: Pov; hint?: string; paragraphs?: Paragraphs },
  ): AsyncIterable<string> {
    const story = await this.stories.get(storyId);
    this.requireGenres(story.genres, 'nhờ AI viết mở đầu');

    // Spend the turn before a single token streams. Once the response body has
    // started the status code is already sent and a paywall is unshowable.
    const { spent } = await this.quota.consume(await this.currentUser.current());

    const req: SeedRequest = {
      mode: 'seed',
      genres: story.genres,
      language: story.language === 'en' ? 'en' : 'vi',
      pov: opts.pov ?? 'third_limited',
      hint: opts.hint,
      paragraphs: opts.paragraphs ?? 1,
    };

    yield* this.refundingIfSilent(this.streamWithFailover(req), spent);
  }

  /**
   * Continue the story.
   *
   * `unpublished` is what is sitting in the draft room right now. Without it
   * the model continues the last *committed* chapter and ignores the paragraph
   * someone just typed, which in a shared editor is the one thing it must not
   * do: the writer is watching the cursor and expects it to pick up where they
   * stopped, not where the story was published to.
   */
  async *continue(
    branchId: string,
    opts: { pov?: Pov; paragraphs?: Paragraphs; unpublished?: string },
  ): AsyncIterable<string> {
    const { branch, text } = await this.stories.readBranch(branchId);
    const draft = opts.unpublished?.trim() ?? '';
    const storySoFar = [text.trim(), draft].filter(Boolean).join('\n\n');

    if (!storySoFar) {
      throw new BadRequestException(
        'Nothing written yet - use the opening generator instead.',
      );
    }

    const { spent } = await this.quota.consume(await this.currentUser.current());

    const retrieved = await this.retrieve(
      storySoFar,
      branch.story.genres,
      branch.storyId,
    );

    const req: ContinueRequest = {
      mode: 'continue',
      language: branch.story.language === 'en' ? 'en' : 'vi',
      pov: opts.pov ?? 'third_limited',
      storySoFar,
      paragraphs: opts.paragraphs ?? 1,
      ...retrieved,
    };

    yield* this.refundingIfSilent(this.streamWithFailover(req), spent);
  }

  /**
   * Directions the story could take from here.
   *
   * Shared between everyone who reaches the same text: a popular chapter is
   * read by many people, and asking the model the same question for each of
   * them would be most of the AI bill. The key is a hash of exactly what the
   * model would be sent, so a reader only ever gets suggestions made from
   * text they can read themselves - a paywalled chapter changes the text and
   * therefore the key. A cached answer costs nothing, so it does not use up
   * the reader's daily quota. `fresh` asks the model again (and does count),
   * and the new answer replaces the shared one.
   */
  async suggest(branchId: string, count = 4, fresh = false): Promise<PlotOption[]> {
    const { branch, text } = await this.stories.readBranch(branchId);
    if (!text.trim()) {
      throw new BadRequestException(
        'Nothing written yet - there is no story to suggest directions for.',
      );
    }

    const user = await this.currentUser.current();
    const language = branch.story.language === 'en' ? 'en' : 'vi';
    const driver = this.first();
    const key = `ai:suggest:v1:${createHash('sha256')
      .update(`${driver.name}|${driver.model}|${language}|${count}|${text}`)
      .digest('hex')}`;

    if (!fresh) {
      const hit = await this.cachedSuggestions(key);
      if (hit) return hit;
    }

    const { spent } = await this.quota.consume(user);

    const req: SuggestRequest = { mode: 'suggest', language, storySoFar: text, count };
    let options: PlotOption[];
    try {
      const res = await driver.generateJson<{ options: PlotOption[] }>(req);
      // The model is not asked to invent ids - they only need to be stable
      // for the length of one picker session.
      options = res.value.options.map((o, i) => ({ ...o, id: `opt-${i + 1}` }));
    } catch (err) {
      await this.quota.refund(spent);
      throw err;
    }
    if (options.length) {
      await this.redis.client
        .set(key, JSON.stringify(options), 'EX', SUGGEST_TTL_SECONDS)
        .catch((err: Error) => this.logger.warn(`suggest cache write failed: ${err.message}`));
    }
    return options;
  }

  /**
   * Passes a stream through, giving the turn back if it fails before a single
   * word arrived. Once text has reached the reader the turn was used.
   */
  private async *refundingIfSilent(stream: AsyncIterable<string>, spent: Spend): AsyncIterable<string> {
    let delivered = false;
    try {
      for await (const chunk of stream) {
        delivered = true;
        yield chunk;
      }
    } catch (err) {
      if (!delivered) await this.quota.refund(spent);
      throw err;
    }
  }

  /** A stored answer, or null. Redis being down only costs a model call. */
  private async cachedSuggestions(key: string): Promise<PlotOption[] | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const options = JSON.parse(raw) as PlotOption[];
      return Array.isArray(options) && options.length ? options : null;
    } catch (err) {
      this.logger.warn(`suggest cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Tries each configured driver in turn, moving on only when one reports a
   * rate limit. Any other failure is a real error and propagates - retrying a
   * malformed request against a second provider just wastes its quota too.
   */
  /**
   * What to put in front of the model besides the story itself.
   *
   * The query is the tail of the draft rather than the whole thing: retrieval
   * should answer "what is about to happen", and the opening chapters are the
   * least relevant part of that. Two searches rather than one, because the two
   * corpora land in different parts of the prompt - facts that must hold, and
   * technique that may help.
   *
   * Failure here is silent on purpose. Retrieval makes a continuation better;
   * it is not what makes it possible, and an embedding provider having a bad
   * minute should not stop a writer working.
   */
  private async retrieve(
    storySoFar: string,
    genres: string[],
    storyId: string,
  ): Promise<{ continuityNotes?: string[]; craftNotes?: string[] }> {
    const tail = storySoFar.slice(-1200);
    const genre = firstKnownGenre(genres);
    // The writer asking, so the passages fed to the model are ones they could
    // read themselves - a stranger continuing a public story must not get a
    // locked chapter back through the prompt.
    const viewer = await this.currentUser.optional();

    try {
      const [craft, continuity] = await Promise.all([
        this.rag.search(tail, { genre, kinds: [ChunkKind.CRAFT], limit: 3 }),
        this.rag.search(tail, {
          storyId,
          kinds: [ChunkKind.CHAPTER],
          limit: 3,
          viewerId: viewer?.id ?? null,
        }),
      ]);

      return {
        craftNotes: craft.map((p) => `${p.label}: ${p.text}`),
        // Trimmed harder than craft notes: these are reminders of what is
        // already established, and pasting whole chapters back in crowds out
        // the part of the prompt that matters, the last few lines.
        continuityNotes: continuity.map((p) => p.text.slice(0, 280)),
      };
    } catch (err) {
      this.logger.warn(`retrieval unavailable: ${(err as Error).message}`);
      return {};
    }
  }

  private async *streamWithFailover(
    req: SeedRequest | ContinueRequest,
  ): AsyncIterable<string> {
    let lastRateLimit: RateLimitedError | null = null;

    for (const driver of this.drivers) {
      try {
        yield* driver.streamProse(req);
        return;
      } catch (err) {
        if (err instanceof RateLimitedError) {
          this.logger.warn(`${driver.name} rate limited, trying next driver`);
          lastRateLimit = err;
          continue;
        }
        throw err;
      }
    }

    throw lastRateLimit ?? new BadRequestException('No AI provider available.');
  }

  currentModel(): { provider: string; model: string } | null {
    const d = this.drivers[0];
    return d ? { provider: d.name, model: d.model } : null;
  }

  async quotaStatus(): Promise<QuotaStatus> {
    return this.quota.status(await this.currentUser.current());
  }

  /** Temporary stand-in for the payment webhook, so the paid path is testable. */
  async grantCredits(amount: number): Promise<QuotaStatus> {
    const user = await this.currentUser.current();
    await this.quota.grant(user.id, amount);
    return this.quota.status(user);
  }
}
