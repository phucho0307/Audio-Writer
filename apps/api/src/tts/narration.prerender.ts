import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEvents } from '../events/domain-events';
import { TtsService } from './tts.service';

/**
 * Turns "a story was published" into queued narration.
 *
 * A listener rather than a call from the story service, because `TtsModule`
 * already imports `StoriesModule` and the reverse would be a cycle. It also
 * keeps the story layer honest: publishing does not need to know that
 * narration exists.
 *
 * Gated on RUN_WORKER for the same reason the worker is - an instance that
 * only serves HTTP should not be deciding what gets rendered.
 */
@Injectable()
export class NarrationPrerender implements OnModuleInit {
  private readonly logger = new Logger(NarrationPrerender.name);

  constructor(
    private readonly config: ConfigService,
    private readonly events: DomainEvents,
    private readonly tts: TtsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('RUN_WORKER', 'true') !== 'true') return;
    if (this.config.get<string>('PRERENDER_ON_PUBLISH', 'true') !== 'true') {
      this.logger.log('pre-rendering on publish is off');
      return;
    }

    this.events.on('story.published', async ({ storyId }) => {
      await this.tts.prerenderHead(storyId);
    });

    // Chapters added after publishing. A no-op unless PRERENDER_CHAPTERS is
    // "all" and the story is public.
    this.events.on('chapter.committed', async ({ contributionId }) => {
      await this.tts.prerenderChapter(contributionId);
    });
  }
}
