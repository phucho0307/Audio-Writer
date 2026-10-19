import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { RagController } from './rag.controller';
import { RagIndexer } from './rag.indexer';
import { RagService } from './rag.service';

/**
 * Retrieval, and the reading list beside it.
 *
 * No dependency on stories or LLM: chapters are pushed in by whoever commits
 * them and passages are pulled out by whoever is writing a prompt, so this
 * module can be reasoned about - and reindexed - on its own.
 */
@Module({
  controllers: [RagController],
  providers: [RagService, EmbeddingService, RagIndexer],
  exports: [RagService, EmbeddingService],
})
export class RagModule {}
