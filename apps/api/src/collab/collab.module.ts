import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CollabAccessService } from './collab-access.service';
import { CollabController } from './collab.controller';
import { CollabGateway } from './collab.gateway';
import { DraftService } from './draft.service';
import { LlmModule } from '../llm/llm.module';
import { StoriesModule } from '../stories/stories.module';

/**
 * Shared drafts: the WebSocket room, who may enter it, and what turns a draft
 * into a chapter.
 *
 * `JwtModule` is registered bare because the gateway verifies tokens itself
 * with an explicit secret - the socket never passes through the HTTP guards, so
 * it cannot inherit their configuration.
 */
@Module({
  imports: [JwtModule.register({}), StoriesModule, LlmModule],
  controllers: [CollabController],
  providers: [CollabGateway, CollabAccessService, DraftService],
  exports: [CollabAccessService, DraftService],
})
export class CollabModule {}
