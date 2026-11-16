import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, UnrecoverableError } from 'bullmq';
import { StorageFullError } from '../storage/storage-driver';
import { NotFoundException } from '@nestjs/common';
import { QueueConnection } from '../queue/queue-connection';
import { NARRATION_QUEUE, type NarrationJob } from '../queue/queue.constants';
import { TtsService } from './tts.service';
import { TtsRateLimitedError } from './tts-driver';

/**
 * The consuming half.
 *
 * Runs only when `RUN_WORKER` is set, so the same image serves as API, worker,
 * or both. In development one process does everything; splitting them in
 * production is then a change to an environment variable rather than a
 * refactor - which is the reason `TtsService.synthesize` was written with no
 * HTTP dependency at all.
 */
@Injectable()
export class NarrationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NarrationWorker.name);
  private worker?: Worker<NarrationJob>;

  constructor(
    private readonly config: ConfigService,
    private readonly connections: QueueConnection,
    private readonly tts: TtsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('RUN_WORKER', 'true') !== 'true') {
      this.logger.log('RUN_WORKER is not true - narration worker not started');
      return;
    }

    const concurrency = Number(
      this.config.get<string>('NARRATION_CONCURRENCY', '2'),
    );
    const rpm = Number(this.config.get<string>('TTS_RPM', '10'));

    this.worker = new Worker<NarrationJob>(
      NARRATION_QUEUE,
      async (job) => this.run(job.data),
      {
        connection: this.connections.create('narration-worker'),
        concurrency,
        // A ceiling on how fast the pool may call the provider, enforced where
        // the work happens rather than at the door. However many requests were
        // accepted, the provider never sees more than this.
        limiter: { max: rpm, duration: 60_000 },
      },
    );

    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      const spent = job.attemptsMade >= attempts;
      this.logger.warn(
        `job ${job.id} failed (${job.attemptsMade}/${attempts}): ${err.message}`,
      );
      // Only the last attempt marks the durable row, so a job still retrying
      // does not show the reader a failure it is about to recover from.
      if (spent) void this.tts.failJob(job.data.renderJobId, err.message);
    });

    this.logger.log(
      `narration worker up - concurrency ${concurrency}, ${rpm}/min ceiling`,
    );
  }

  private async run(data: NarrationJob): Promise<{ url: string }> {
    try {
      return await this.tts.synthesize(data);
    } catch (err) {
      if (err instanceof TtsRateLimitedError) {
        // Not this job's fault, and not a failed attempt. Pause the whole pool
        // for as long as the provider asked, and put the job back untouched -
        // otherwise a busy hour would exhaust every job's retry budget on a
        // queue that only needed to wait.
        const ms = err.retryAfterMs ?? 60_000;
        this.logger.warn(`provider rate limited - pausing ${ms}ms`);
        await this.worker!.rateLimit(ms);
        throw Worker.RateLimitError();
      }

      if (err instanceof StorageFullError) {
        // Storage is at its budget. Retrying in a few seconds cannot free
        // space, and each retry would synthesize the chapter again.
        throw new UnrecoverableError(err.message);
      }

      if (err instanceof NotFoundException) {
        // The chapter was deleted after the job was queued. Retrying cannot
        // make it exist again.
        throw new UnrecoverableError((err as Error).message);
      }

      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Waits for jobs in flight, so a deploy does not abandon a synthesis that
    // has already been paid for.
    await this.worker?.close();
  }
}
