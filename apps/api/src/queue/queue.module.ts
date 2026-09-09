import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NarrationQueue } from './narration.queue';
import { QueueConnection } from './queue-connection';

/**
 * Producing side only.
 *
 * The worker lives in the module that owns the work (`TtsModule`), not here.
 * Putting it here would mean this module depending on TTS and TTS depending on
 * this one for the enqueue - a cycle, for no gain. This module knows how to
 * accept a job; it does not know what a job means.
 */
@Module({
  imports: [ConfigModule],
  providers: [QueueConnection, NarrationQueue],
  exports: [QueueConnection, NarrationQueue],
})
export class QueueModule {}
