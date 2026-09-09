import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueConnection } from './queue-connection';
import {
  NARRATE_CHAPTER,
  NARRATION_QUEUE,
  PRIORITY,
  type NarrationJob,
} from './queue.constants';

@Injectable()
export class NarrationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NarrationQueue.name);
  private queue!: Queue<NarrationJob>;

  constructor(private readonly connections: QueueConnection) {}

  onModuleInit(): void {
    this.queue = new Queue<NarrationJob>(NARRATION_QUEUE, {
      connection: this.connections.create('narration-queue'),
      defaultJobOptions: {
        attempts: 3,
        // 5s, 10s, 20s. Long enough for a provider hiccup to pass, short
        // enough that a reader watching the page still gets audio.
        backoff: { type: 'exponential', delay: 5000 },
        // Completed jobs are kept briefly so a double-click inside the hour
        // still deduplicates on jobId. The durable record is the RenderJob
        // row, so nothing is lost when these are evicted.
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }

  /**
   * Queue one chapter.
   *
   * `jobId` is derived from the chapter and voice, so BullMQ silently ignores
   * a duplicate while one is still in flight - which covers double-clicks and
   * two readers asking for the same chapter at once. It is a deduplication
   * window, not a guarantee: completed jobs are evicted eventually. The real
   * guarantee is the unique constraint on `audio_clips`, re-checked by the
   * worker before it spends anything.
   */
  async add(
    job: NarrationJob,
    priority: number = PRIORITY.INTERACTIVE,
  ): Promise<string> {
    const jobId = `audio:${job.contributionId}:${job.voice}`;

    // A finished job keeps its id until it is evicted, and `add` on an id that
    // already exists is a silent no-op. That made retrying a failed narration
    // do nothing at all: the row was reopened to QUEUED, the enqueue was
    // ignored, and the reader polled a status that would never change. So a
    // terminal job is cleared out of the way first.
    const previous = await this.queue.getJob(jobId);
    if (previous) {
      const state = await previous.getState();
      if (state === 'completed' || state === 'failed') {
        await previous.remove();
      } else {
        // Still waiting, delayed or running. Two callers watching one piece of
        // work is the intended behaviour.
        this.logger.log(`${jobId} already ${state} - not queued again`);
        return jobId;
      }
    }

    await this.queue.add(NARRATE_CHAPTER, job, { jobId, priority });
    this.logger.log(
      `queued ${jobId} (priority ${priority === PRIORITY.BULK ? 'bulk' : 'interactive'})`,
    );
    return jobId;
  }

  /** The live job for a chapter, if BullMQ still has one. Used by the sweeper. */
  async find(contributionId: string, voice: string) {
    return this.queue.getJob(`audio:${contributionId}:${voice}`);
  }

  /** Queue depth, for the health endpoint and later for metrics. */
  async depth(): Promise<{ waiting: number; active: number; failed: number }> {
    const [waiting, active, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, active, failed };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
