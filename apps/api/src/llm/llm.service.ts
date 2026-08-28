import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { AiQuotaService, type QuotaStatus } from './ai-quota.service';
import { CurrentUserService } from '../auth/current-user.service';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly drivers: LlmDriver[];

  constructor(
    private readonly config: ConfigService,
    private readonly stories: StoriesService,
    private readonly quota: AiQuotaService,
    private readonly currentUser: CurrentUserService,
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
    await this.quota.consume(await this.currentUser.current());

    const req: SeedRequest = {
      mode: 'seed',
      genres: story.genres,
      language: story.language === 'en' ? 'en' : 'vi',
      pov: opts.pov ?? 'third_limited',
      hint: opts.hint,
      paragraphs: opts.paragraphs ?? 1,
    };

    yield* this.streamWithFailover(req);
  }

  async *continue(
    branchId: string,
    opts: { pov?: Pov; paragraphs?: Paragraphs },
  ): AsyncIterable<string> {
    const { branch, text } = await this.stories.readBranch(branchId);
    if (!text.trim()) {
      throw new BadRequestException(
        'Nothing written yet - use the opening generator instead.',
      );
    }

    await this.quota.consume(await this.currentUser.current());

    const req: ContinueRequest = {
      mode: 'continue',
      language: branch.story.language === 'en' ? 'en' : 'vi',
      pov: opts.pov ?? 'third_limited',
      storySoFar: text,
      paragraphs: opts.paragraphs ?? 1,
    };

    yield* this.streamWithFailover(req);
  }

  async suggest(branchId: string, count = 4): Promise<PlotOption[]> {
    const { branch, text } = await this.stories.readBranch(branchId);
    if (!text.trim()) {
      throw new BadRequestException(
        'Nothing written yet - there is no story to suggest directions for.',
      );
    }

    await this.quota.consume(await this.currentUser.current());

    const req: SuggestRequest = {
      mode: 'suggest',
      language: branch.story.language === 'en' ? 'en' : 'vi',
      storySoFar: text,
      count,
    };

    const res = await this.first().generateJson<{ options: PlotOption[] }>(req);

    // The model is not asked to invent ids - they only need to be stable for
    // the length of one picker session.
    return res.value.options.map((o, i) => ({ ...o, id: `opt-${i + 1}` }));
  }

  // -------------------------------------------------------------------------

  /**
   * Tries each configured driver in turn, moving on only when one reports a
   * rate limit. Any other failure is a real error and propagates - retrying a
   * malformed request against a second provider just wastes its quota too.
   */
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
