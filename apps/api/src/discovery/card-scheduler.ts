import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEvents } from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GeminiBusyError, GeminiConfigError, GeminiUnavailableError } from './gemini-json';
import { StoryCardsService } from './story-cards.service';

/** How often to look for stories that need a card. */
const EVERY_MS = 30 * 60_000;
/** Embedding calls are batched: one per this many cards. */
const BATCH = 10;

/**
 * Writes search cards in the background, inside a daily budget.
 *
 * On the free tier the card model allows a few hundred calls a day, and the
 * same quota answers readers' searches. So the backlog is worked through a
 * slice at a time - DISCOVERY_CARDS_PER_DAY (default 300), spaced out under
 * the per-minute limit - leaving the rest for people. The whole catalogue of
 * about 1,100 stories takes three or four days, after which only new and
 * changed stories need a card.
 *
 * Runs only where the narration worker runs (RUN_WORKER), so a second API
 * replica or a one-off script does not double the spend.
 */
@Injectable()
export class CardScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CardScheduler.name);
  private readonly perDay: number;
  private readonly spacingMs: number;
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly cards: StoryCardsService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {
    this.perDay = Number(config.get('DISCOVERY_CARDS_PER_DAY', 300));
    // 15 requests a minute on the free tier; one every 6s stays under it with
    // room for readers' searches.
    this.spacingMs = Number(config.get('DISCOVERY_CARD_SPACING_MS', 6000));
    this.enabled = config.get<string>('RUN_WORKER', 'true') === 'true' && this.perDay > 0;
  }

  onApplicationBootstrap(): void {
    // A changed story gets described again on the next pass.
    this.events.on('story.published', ({ storyId }) => this.cards.markStale(storyId));
    this.events.on('chapter.committed', async ({ branchId }) => {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { storyId: true } });
      if (branch) await this.cards.markStale(branch.storyId);
    });

    if (!this.enabled || !this.cards.available) {
      this.logger.log('search cards are not being written here');
      return;
    }
    this.timer = setInterval(() => void this.pass(), EVERY_MS);
    this.timer.unref();
    // Shortly after boot rather than at it, so startup is not slowed.
    setTimeout(() => void this.pass(), 20_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Cards written today, counted in Redis so restarts do not reset it. */
  private dayKey(): string {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    // Pacific time: that is when Gemini's daily quota resets.
    return `discovery:cards:${date}`;
  }

  async pass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Vectors owed from passes where the embedding quota had run out.
      if ((await this.cards.missingEmbeddings()) > 0) {
        try {
          const n = await this.cards.embedMissing(200);
          if (n) this.logger.log(`embedded ${n} cards that were waiting for a vector`);
        } catch (err) {
          this.logger.warn(`embedding still unavailable: ${(err as Error).message.slice(0, 120)}`);
        }
      }

      const used = Number((await this.redis.client.get(this.dayKey())) ?? 0);
      const left = this.perDay - used;
      if (left <= 0) return;
      const ids = await this.cards.needingCards(left);
      if (ids.length === 0) return;
      this.logger.log(`writing search cards: ${ids.length} to do, ${left} left today`);

      let written = 0;
      let overloaded = 0;
      let batch: NonNullable<Awaited<ReturnType<StoryCardsService['describe']>>>[] = [];
      for (const id of ids) {
        try {
          const d = await this.cards.describe(id);
          await this.spend();
          overloaded = 0;
          if (d) batch.push(d);
        } catch (err) {
          if (err instanceof GeminiUnavailableError) {
            // Overloaded on Google's side; does not use quota. Back off.
            if (++overloaded >= 3) {
              this.logger.warn('card model overloaded; trying again next pass');
              break;
            }
            continue;
          }
          if (err instanceof GeminiConfigError) {
            // Wrong model name, bad key: every call would fail the same way.
            this.logger.error(`search cards stopped, fix the configuration: ${err.message}`);
            break;
          }
          if (err instanceof GeminiBusyError) {
            this.logger.warn('card model is out of quota for now; stopping this pass');
            break;
          }
          // Reached the model and failed (bad JSON, timeout): it still counts.
          await this.spend();
          this.logger.warn(`card for ${id.slice(0, 8)} failed: ${(err as Error).message}`);
        }
        if (batch.length >= BATCH) {
          await this.flush(batch);
          written += batch.length;
          batch = [];
        }
        await new Promise((r) => setTimeout(r, this.spacingMs));
      }
      await this.flush(batch);
      written += batch.length;
      const { withCard, total } = await this.cards.coverage();
      this.logger.log(`search cards: wrote ${written}; ${withCard}/${total} stories searchable`);
    } catch (err) {
      this.logger.error(`card pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One call against today's budget. */
  private async spend(): Promise<void> {
    await this.redis.incrementWindow(this.dayKey(), 60 * 60 * 48);
  }

  private async flush(batch: Parameters<StoryCardsService['store']>[0]): Promise<void> {
    try {
      await this.cards.store(batch);
    } catch (err) {
      // The descriptions are lost, but nothing is half-written: the stories
      // still have no card and come round again on the next pass.
      this.logger.warn(`storing ${batch.length} cards failed: ${(err as Error).message}`);
    }
  }
}
