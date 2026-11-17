import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CardScheduler } from './card-scheduler';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { EmbeddingService } from './embedding.service';
import { GeminiJson } from './gemini-json';
import { StoryCardsService } from './story-cards.service';
import { RelatedService } from './related.service';

/**
 * AI story search: a card per story (written in the background, within a
 * daily budget) and a search that reads a request in the reader's own words.
 */
@Module({
  imports: [AuthModule],
  controllers: [DiscoveryController],
  providers: [GeminiJson, EmbeddingService, StoryCardsService, DiscoveryService, RelatedService, CardScheduler],
})
export class DiscoveryModule {}
