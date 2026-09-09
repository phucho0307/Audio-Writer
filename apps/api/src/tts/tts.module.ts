import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { NarrationWorker } from './narration.worker';
import { NarrationSweeper } from './narration.sweeper';
import { StoriesModule } from '../stories/stories.module';
import { QueueModule } from '../queue/queue.module';

/**
 * Both halves of narration live here: the controller that accepts a request
 * and the worker that does the work. `QueueModule` knows only how to carry a
 * job between them.
 */
@Module({
  imports: [StoriesModule, QueueModule],
  controllers: [TtsController],
  providers: [TtsService, NarrationWorker, NarrationSweeper],
})
export class TtsModule {}
