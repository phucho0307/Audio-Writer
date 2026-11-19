import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { QueueConnection } from './queue-connection';
import {
  NARRATE_CHAPTER,
  NARRATION_QUEUE,
  PRIORITY,
  type NarrationJob,
} from './queue.constants';

/**
 * The BullMQ id for one chapter in one voice.
 *
 * The voice is hashed rather than embedded. BullMQ rejects a custom id with a
 * colon unless it splits into exactly three parts - a compatibility rule its own
 * source marks for removal, after which any colon fails. `audio:<id>:Kore`
 * happened to fit; `piper:vi_VN-vivos-x_low#20@1.3` does not, and failed every
 * enqueue with a 500. A digest is colon-free whatever a voice id looks like.
 */
function jobIdFor(contributionId: string, voice: string): string {
  const v = createHash('sha256').update(voice).digest('hex').slice(0, 16);
  return `audio-${contributionId}-${v}`;
}

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
    const jobId = jobIdFor(job.contributionId, job.voice);

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
        // work is the intended behaviour. A reader pressing play must still
        // move an already-queued bulk chapter ahead of the background library.
        // Keep the same job/id and never interrupt an active synthesis or
        // demote an interactive request when a later prefetch finds it.
        if (
          priority < previous.priority &&
          (state === 'waiting' || state === 'prioritized' || state === 'delayed')
        ) {
          await previous.changePriority({ priority });
          this.logger.log(`${jobId} promoted to reader priority`);
        }
        this.logger.log(`${jobId} already ${state} - not queued again`);
        return jobId;
      }
    }

    await this.queue.add(NARRATE_CHAPTER, job, { jobId, priority });
    this.logger.log(
      `queued ${jobId} [${job.voice}] (priority ${priority})`,
    );
    return jobId;
  }

  /** The live job for a chapter, if BullMQ still has one. Used by the sweeper. */
  async find(contributionId: string, voice: string) {
    return this.queue.getJob(jobIdFor(contributionId, voice));
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
