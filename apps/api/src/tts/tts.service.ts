import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RenderKind, RenderStatus } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { PaywallService } from '../stories/paywall.service';
import { StoriesService } from '../stories/stories.service';
import { NarrationQueue } from '../queue/narration.queue';
import { PRIORITY, type NarrationJob } from '../queue/queue.constants';
import { DEFAULT_VOICE, GeminiTtsDriver } from './gemini-tts.driver';
import type { TtsDriver } from './tts-driver';

export interface ChapterAudio {
  depth: number;
  contributionId: string;
  /** Null until this chapter has been narrated. */
  url: string | null;
  durationMs: number | null;
  /** First line, so the player can label the track. */
  preview: string;
  locked: boolean;
}

export interface NarrationTicket {
  /** Null when the audio already existed and no work was queued. */
  jobId: string | null;
  status: RenderStatus;
  url: string | null;
  durationMs: number | null;
  cached: boolean;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly driver: TtsDriver;
  private readonly dir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stories: StoriesService,
    private readonly paywall: PaywallService,
    private readonly currentUser: CurrentUserService,
    private readonly queue: NarrationQueue,
  ) {
    this.driver = new GeminiTtsDriver(
      this.config.get<string>('GEMINI_API_KEY', ''),
      this.config.get<string>('TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
    );
    // Served straight out of the web app in development. In production this
    // becomes an object-store key - `url` is only ever a path.
    this.dir = join(__dirname, '../../../web/public/audio');
  }

  get available(): boolean {
    return this.driver.isConfigured();
  }

  voices() {
    return { voices: this.driver.voices, default: this.driver.defaultVoice };
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * What the player needs: every chapter the reader is allowed to hear, and
   * which of them already have audio.
   */
  async list(branchId: string, voice = DEFAULT_VOICE): Promise<ChapterAudio[]> {
    const { contributions, access } = await this.stories.readBranch(branchId);

    const clips = await this.prisma.audioClip.findMany({
      where: {
        voice,
        contributionId: { in: contributions.map((c) => c.id) },
      },
    });
    const byId = new Map(clips.map((c) => [c.contributionId, c]));

    return contributions
      .map((c) => {
        const clip = byId.get(c.id);
        return {
          depth: c.depth,
          contributionId: c.id,
          url: clip?.url ?? null,
          durationMs: clip?.durationMs ?? null,
          preview: c.textPlain.split('\n')[0].slice(0, 80),
          // readBranch already withholds locked chapters, so anything returned
          // here is readable; the flag is kept for the client's benefit.
          locked: false,
        };
      })
      .concat(
        access.lockedCount > 0
          ? Array.from({ length: access.lockedCount }, (_, i) => ({
              depth: contributions.length + i,
              contributionId: '',
              url: null,
              durationMs: null,
              preview: 'Chương bị khoá',
              locked: true,
            }))
          : [],
      );
  }

  /** Where a queued narration has got to. Polled by the player. */
  async jobStatus(id: string) {
    const job = await this.prisma.renderJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Job ${id} not found`);

    return {
      jobId: job.id,
      status: job.status,
      url: job.outputUrl,
      error: job.error,
      updatedAt: job.updatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Queueing
  //
  // Everything that needs to know who is asking happens here, in the request:
  // permission, the paywall, and whether the clip already exists. The worker
  // runs with no request context at all, so anything it needs has to be
  // decided before the job is created.
  // -------------------------------------------------------------------------

  /**
   * Ask for one chapter to be narrated.
   *
   * Returns immediately. This used to block for the full ~28 seconds of
   * synthesis, which held an HTTP connection open past most proxy timeouts and
   * lost the work outright if the reader closed the tab.
   */
  async enqueueChapter(
    branchId: string,
    depth: number,
    voice = DEFAULT_VOICE,
  ): Promise<NarrationTicket> {
    this.assertUsable(voice);

    const { contributions } = await this.stories.readBranch(branchId);
    const chapter = contributions.find((c) => c.depth === depth);

    if (!chapter) {
      // Either it does not exist or the paywall withheld it - both are a
      // refusal to narrate, and distinguishing them would leak what is behind
      // the wall.
      throw new NotFoundException(
        `Chapter ${depth + 1} is not available on this branch.`,
      );
    }

    return this.enqueueOne(branchId, chapter.id, voice, PRIORITY.INTERACTIVE);
  }

  /**
   * Narrate every chapter that has no audio yet.
   *
   * Queued at bulk priority, because one click here can be two hundred jobs
   * and the next reader asking for a single chapter must not wait behind them.
   *
   * This used to run synchronously and in sequence: eight chapters was eight
   * times twenty-eight seconds in one request, which no load balancer allows.
   */
  async enqueueBranch(branchId: string, voice = DEFAULT_VOICE) {
    this.assertUsable(voice);

    const chapters = await this.list(branchId, voice);
    const todo = chapters.filter((c) => !c.locked && !c.url && c.contributionId);

    for (const chapter of todo) {
      await this.enqueueOne(
        branchId,
        chapter.contributionId,
        voice,
        PRIORITY.BULK,
      );
    }

    return {
      queued: todo.length,
      alreadyHad: chapters.filter((c) => c.url).length,
      chapters: await this.list(branchId, voice),
    };
  }

  private async enqueueOne(
    branchId: string,
    contributionId: string,
    voice: string,
    priority: number,
  ): Promise<NarrationTicket> {
    const existing = await this.prisma.audioClip.findUnique({
      where: { contributionId_voice: { contributionId, voice } },
    });
    if (existing) {
      return {
        jobId: null,
        status: RenderStatus.COMPLETE,
        url: existing.url,
        durationMs: existing.durationMs,
        cached: true,
      };
    }

    const user = await this.currentUser.optional();

    // Keyed the same way as the BullMQ job, so the durable row and the queue
    // entry describe the same piece of work.
    const idempotencyKey = `audio:${contributionId}:${voice}`;
    const job = await this.findOrOpenJob(idempotencyKey, {
      branchId,
      userId: user?.id ?? null,
      contributionId,
      voice,
    });

    await this.queue.add(
      { contributionId, branchId, voice, renderJobId: job.id },
      priority,
    );

    return {
      jobId: job.id,
      status: RenderStatus.QUEUED,
      url: null,
      durationMs: null,
      cached: false,
    };
  }

  /**
   * The durable row for a piece of narration, reopened only if it is finished.
   *
   * Asking again for a chapter that is already being narrated must not touch
   * its row. Blindly resetting to QUEUED made a running job report itself as
   * still waiting, so the player showed "đang xếp hàng" through the entire
   * synthesis it was actually watching.
   */
  private async findOrOpenJob(
    idempotencyKey: string,
    fields: {
      branchId: string;
      userId: string | null;
      contributionId: string;
      voice: string;
    },
  ) {
    const existing = await this.prisma.renderJob.findUnique({
      where: { idempotencyKey },
    });

    if (!existing) {
      try {
        return await this.prisma.renderJob.create({
          data: {
            ...fields,
            kind: RenderKind.AUDIO,
            status: RenderStatus.QUEUED,
            idempotencyKey,
          },
        });
      } catch {
        // Two readers asked at the same moment and the unique index caught the
        // second. Whichever row won is the right one.
        return this.prisma.renderJob.findUniqueOrThrow({
          where: { idempotencyKey },
        });
      }
    }

    // In flight already. Hand back the same job so both callers watch one
    // piece of work.
    if (
      existing.status === RenderStatus.QUEUED ||
      existing.status === RenderStatus.RUNNING
    ) {
      return existing;
    }

    // Finished or failed: this is a fresh attempt at the same chapter.
    return this.prisma.renderJob.update({
      where: { id: existing.id },
      data: {
        status: RenderStatus.QUEUED,
        error: null,
        progress: 0,
        stage: null,
        completedAt: null,
      },
    });
  }

  private assertUsable(voice: string): void {
    if (!this.available) {
      throw new BadRequestException('No TTS provider configured.');
    }
    if (!this.driver.voices.some((v) => v.id === voice)) {
      throw new BadRequestException(`Unknown voice "${voice}".`);
    }
  }

  // -------------------------------------------------------------------------
  // The work itself
  // -------------------------------------------------------------------------

  /**
   * Called by the worker, never by a controller.
   *
   * There is no request context here: no signed-in user, no `readBranch`, no
   * paywall check. Those were settled when the job was created, which is why
   * this takes a contribution id rather than a branch and a depth.
   */
  async synthesize(data: NarrationJob): Promise<{ url: string }> {
    const { contributionId, voice, renderJobId } = data;

    // The real deduplication guarantee. The BullMQ job id only covers jobs
    // still in flight, and delivery is at-least-once, so this is what stops a
    // redelivered job from spending a second request against the daily quota.
    const existing = await this.prisma.audioClip.findUnique({
      where: { contributionId_voice: { contributionId, voice } },
    });
    if (existing) {
      await this.finish(renderJobId, existing.url);
      return { url: existing.url };
    }

    const chapter = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
    });
    if (!chapter) {
      // The chapter was deleted between queueing and running. Not an error
      // worth retrying.
      throw new NotFoundException(`Contribution ${contributionId} is gone`);
    }

    await this.prisma.renderJob.update({
      where: { id: renderJobId },
      data: { status: RenderStatus.RUNNING, stage: 'tts', progress: 10 },
    });

    // Deliberately not wrapped: TtsRateLimitedError has to reach the worker,
    // which pauses the whole pool rather than failing this one job.
    const speech = await this.driver.speak(chapter.textPlain, voice);

    await mkdir(this.dir, { recursive: true });
    const file = `${chapter.id}-${voice}.wav`;
    await writeFile(join(this.dir, file), speech.wav);
    const url = `/audio/${file}`;

    await this.prisma.audioClip.create({
      data: {
        contributionId: chapter.id,
        voice,
        provider: speech.provider,
        url,
        durationMs: speech.durationMs,
        bytes: speech.wav.length,
      },
    });

    await this.finish(renderJobId, url);
    this.logger.log(
      `narrated chapter ${chapter.depth + 1} of branch ${data.branchId.slice(0, 8)} -> ${file}`,
    );

    return { url };
  }

  private async finish(renderJobId: string, url: string): Promise<void> {
    await this.prisma.renderJob.update({
      where: { id: renderJobId },
      data: {
        status: RenderStatus.COMPLETE,
        progress: 100,
        stage: null,
        outputUrl: url,
        completedAt: new Date(),
        error: null,
      },
    });
  }

  /** Called by the worker once a job has run out of attempts. */
  async failJob(renderJobId: string, message: string): Promise<void> {
    await this.prisma.renderJob
      .update({
        where: { id: renderJobId },
        data: {
          status: RenderStatus.FAILED,
          stage: null,
          error: message.slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
}
