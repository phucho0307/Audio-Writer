import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RenderKind, RenderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NarrationQueue } from '../queue/narration.queue';
import { PRIORITY } from '../queue/queue.constants';

const EVERY_MS = 60_000;

/** How long a row may sit untouched before it is treated as abandoned. */
const STALE_MS = 5 * 60_000;

/**
 * Reconciles the durable job rows against the queue.
 *
 * There are two ways the two can disagree, and they need opposite treatment.
 *
 * A row stuck at QUEUED with no job behind it means the enqueue was lost - the
 * process died between writing the row and reaching Redis. Nothing was spent,
 * so it is put back on the queue. This is the gap a transactional outbox
 * closes properly, and this is the cheap stand-in for it: the outbox makes the
 * write and the publish atomic instead of detecting afterwards that they were
 * not.
 *
 * A row stuck at RUNNING with no job behind it means a worker died mid-render.
 * That one is marked failed rather than retried, because the provider request
 * may already have been made and billed, and the daily quota here is measured
 * in tens. A reader can ask again; silently re-spending is worse than saying
 * so.
 *
 * Without this, a killed worker leaves a row RUNNING for ever and the player
 * polls a status that will never change.
 */
@Injectable()
export class NarrationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NarrationSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queue: NarrationQueue,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('RUN_WORKER', 'true') !== 'true') return;
    this.timer = setInterval(() => void this.sweep(), EVERY_MS);
    // Not on boot: the worker has only just connected, and every in-flight job
    // would look abandoned for the first few seconds.
    this.timer.unref();
  }

  async sweep(): Promise<void> {
    const stale = await this.prisma.renderJob.findMany({
      where: {
        kind: RenderKind.AUDIO,
        status: { in: [RenderStatus.QUEUED, RenderStatus.RUNNING] },
        updatedAt: { lt: new Date(Date.now() - STALE_MS) },
      },
      take: 50,
    });

    for (const row of stale) {
      if (!row.contributionId || !row.voice) continue;

      const live = await this.queue.find(row.contributionId, row.voice);
      // Still real work, however long it has been sitting. A job waiting
      // behind a whole-branch narration is not abandoned.
      if (live && !(await live.isFailed())) continue;

      if (row.status === RenderStatus.QUEUED) {
        await this.queue.add(
          {
            contributionId: row.contributionId,
            branchId: row.branchId,
            voice: row.voice,
            renderJobId: row.id,
          },
          PRIORITY.BULK,
        );
        this.logger.warn(`re-queued lost job ${row.id}`);
        continue;
      }

      await this.prisma.renderJob.update({
        where: { id: row.id },
        data: {
          status: RenderStatus.FAILED,
          stage: null,
          error: 'Bản đọc bị gián đoạn. Hãy thử lại.',
        },
      });
      this.logger.warn(`marked abandoned job ${row.id} failed`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
