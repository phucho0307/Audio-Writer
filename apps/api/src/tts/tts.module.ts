import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { StoriesModule } from '../stories/stories.module';

@Module({
  imports: [StoriesModule],
  controllers: [TtsController],
  providers: [TtsService],
})
export class TtsModule {}
