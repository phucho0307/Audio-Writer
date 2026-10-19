import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEvents } from '../events/domain-events';
import { RagService } from './rag.service';

/**
 * Keeps the index level with the stories.
 *
 * A listener rather than a call inside `commit`, for the same two reasons the
 * narration pre-render is one: the index is a consumer of chapters and has no
 * business being imported by the thing that writes them, and a writer's commit
 * must not fail because an embedding provider is having a bad minute.
 *
 * The handler runs with no identity - see §3.11 of the design notes - which is
 * correct here: indexing is the platform's own bookkeeping and should not be
 * performed on behalf of whoever happened to press the button.
 */
@Injectable()
export class RagIndexer implements OnModuleInit {
  private readonly logger = new Logger(RagIndexer.name);

  constructor(
    private readonly config: ConfigService,
    private readonly events: DomainEvents,
    private readonly rag: RagService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('RAG_INDEX_ON_COMMIT', 'true') !== 'true') {
      this.logger.log('chapters will not be indexed on commit');
      return;
    }

    this.events.on('chapter.committed', async ({ contributionId }) => {
      const chunks = await this.rag.indexChapter(contributionId);
      if (chunks > 0) {
        this.logger.log(
          `indexed ${chunks} passage(s) from ${contributionId.slice(0, 8)}`,
        );
      }
    });
  }
}
