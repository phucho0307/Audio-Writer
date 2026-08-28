import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { AiQuotaService } from './ai-quota.service';
import { StoriesModule } from '../stories/stories.module';

@Module({
  imports: [StoriesModule],
  controllers: [LlmController],
  providers: [LlmService, AiQuotaService],
})
export class LlmModule {}
