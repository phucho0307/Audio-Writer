import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RenderKind, RenderStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { PaywallService } from '../stories/paywall.service';
import { StoriesService } from '../stories/stories.service';
import { NarrationQueue } from '../queue/narration.queue';
import { DomainEvents } from '../events/domain-events';
import { PRIORITY, type NarrationJob } from '../queue/queue.constants';
import ffmpegStatic from 'ffmpeg-static';
import { EdgeTtsDriver } from './edge-tts.driver';
import { GeminiTtsDriver } from './gemini-tts.driver';
import type { TtsDriver } from './tts-driver';
import { PiperTtsDriver } from './piper-tts.driver';
import { MultiTtsDriver } from './multi-tts.driver';
import { AudioEncoder } from './audio-encoder';
import {
  AUDIO_STORAGE,
  StorageFullError,
  type StorageDriver,
} from '../storage/storage-driver';

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
  /**
   * Roughly how long synthesis will take, for a progress bar. Null when nothing
   * was queued.
   */
  estimatedMs: number | null;
}

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private readonly driver: TtsDriver;
  /** How many chapters are narrated ahead of the first reader. */
  private readonly prerenderChapters: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stories: StoriesService,
    private readonly paywall: PaywallService,
    private readonly currentUser: CurrentUserService,
    private readonly queue: NarrationQueue,
    private readonly events: DomainEvents,
    private readonly encoder: AudioEncoder,
    @Inject(AUDIO_STORAGE) private readonly storage: StorageDriver,
  ) {
    const timeout = Number(this.config.get<string>('TTS_TIMEOUT_MS', '300000'));

    // Which synthesisers run is a config change, not a deploy. A comma list
    // offers several at once, routed by voice, and the first one named supplies
    // the default - so `gemini,piper` adds Piper's voices to the picker without
    // moving anybody who does not choose one.
    const build: Record<string, () => TtsDriver> = {
      gemini: () =>
        new GeminiTtsDriver(
          this.config.get<string>('GEMINI_API_KEY', ''),
          this.config.get<string>('TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
          timeout,
        ),
      edge: () =>
        new EdgeTtsDriver(
          this.config.get<string>('EDGE_TTS_PYTHON', 'python'),
          this.config.get<string>('FFMPEG_PATH') || (ffmpegStatic as string | null) || null,
          timeout,
        ),
      piper: () =>
        new PiperTtsDriver(
          this.config.get<string>('PIPER_URL', 'http://127.0.0.1:5062'),
          this.config.get<string>('PIPER_VOICE', 'vi_VN-vais1000-medium'),
          Number(this.config.get<string>('PIPER_LENGTH_SCALE', '1.5')),
          timeout,
        ),
    };
    const names = this.config
      .get<string>('TTS_DRIVER', 'gemini')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n in build);
    const drivers = (names.length ? names : ['gemini']).map((n) => build[n]());
    this.driver = drivers.length === 1 ? drivers[0] : new MultiTtsDriver(drivers);
    // "all" narrates every chapter at publish. Sensible once synthesis is
    // free (the Edge voices); with a metered provider keep a small number.
    const head = this.config.get<string>('PRERENDER_CHAPTERS', '3').trim();
    this.prerenderChapters =
      head.toLowerCase() === 'all'
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(head) || 0);
  }

  async onModuleInit(): Promise<void> {
    await this.driver.init?.();
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
  async list(branchId: string, voice?: string): Promise<ChapterAudio[]> {
    voice ??= this.driver.defaultVoice;
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
    voice?: string,
  ): Promise<NarrationTicket> {
    voice ??= this.driver.defaultVoice;
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

    const ticket = await this.enqueueOne(
      branchId,
      chapter,
      voice,
      PRIORITY.INTERACTIVE,
    );

    // Somebody is about to listen to six minutes of audio. Start the next
    // chapter now, at bulk priority so it never delays anyone waiting on a
    // chapter of their own. Deliberately not awaited and deliberately silent:
    // a failure here costs a head start, not a narration, because asking for
    // that chapter later queues it the ordinary way.
    void this.prefetchNext(branchId, contributions, depth, voice);

    return ticket;
  }

  /**
   * Queue the chapter after this one, if it exists and has no audio.
   *
   * One ahead, never recursive - it calls `enqueueOne` rather than
   * `enqueueChapter`, so a prefetch cannot trigger another prefetch and walk
   * the whole branch off one click.
   *
   * `contributions` comes from the caller's own `readBranch`, so anything
   * behind the paywall was already withheld and cannot be pre-rendered by
   * accident.
   */
  private async prefetchNext(
    branchId: string,
    contributions: { id: string; depth: number; textPlain: string }[],
    depth: number,
    voice: string,
  ): Promise<void> {
    const next = contributions.find((c) => c.depth === depth + 1);
    if (!next) return;

    try {
      await this.enqueueOne(branchId, next, voice, PRIORITY.BULK);
    } catch {
      // Nothing to report and nobody to report it to.
    }
  }

  /**
   * Narrate the chapters a stranger can read, as soon as a story is published.
   *
   * The alternative - synthesising when somebody presses play - is what makes
   * narration feel slow, because a chapter takes anywhere from half a minute to
   * three and a half minutes depending on the provider's mood. Large audiobook
   * platforms do not have this problem because they render at publish time and
   * a reader never meets the synthesiser at all.
   *
   * How far to go is a fixed number, and it used to be decided by the paywall.
   * That was wrong in the ordinary case. Running with no identity means
   * `readBranch` returns what an anonymous visitor sees - but `unlockPrice`
   * defaults to zero, an ungated story is readable to the end, and publishing
   * a two-hundred-chapter novel queued two hundred syntheses against a quota
   * measured in tens per day. The paywall bounds *permission*, which is not
   * the same question as how much it is worth spending on a story nobody has
   * opened yet.
   *
   * Three is enough because prefetch covers everything after it: a reader who
   * presses play on chapter one queues chapter two while six minutes of audio
   * plays, which is far longer than a synthesis takes. Pre-rendering only has
   * to bridge the gap until that loop starts, and the extra two chapters buy
   * margin for a reader who skips ahead.
   *
   * The cost of publishing is therefore a constant rather than a function of
   * how long the book is.
   */
  async prerenderHead(storyId: string): Promise<number> {
    if (!this.available) return 0;

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: { branches: { select: { id: true, isRoot: true } } },
    });
    if (!story) return 0;

    const branchId =
      story.mainBranchId ?? story.branches.find((b) => b.isRoot)?.id;
    if (!branchId) return 0;

    // Unbounded means every chapter, including those behind the paywall:
    // narrating is not reading, and the clip is only served to readers who
    // may open that chapter. Bounded keeps the anonymous view as before.
    const contributions =
      this.prerenderChapters === Number.POSITIVE_INFINITY
        ? await this.prisma.contribution.findMany({
            where: { branchId },
            select: { id: true, textPlain: true, depth: true },
          })
        : (await this.stories.readBranch(branchId)).contributions;
    const voice = this.driver.defaultVoice;

    // Sorted defensively: the bound is only meaningful if these are the first
    // chapters rather than an arbitrary three of them.
    const head = [...contributions]
      .sort((a, b) => a.depth - b.depth)
      .slice(0, this.prerenderChapters);

    let queued = 0;
    for (const chapter of head) {
      const ticket = await this.enqueueOne(
        branchId,
        chapter,
        voice,
        PRIORITY.BULK,
      );
      if (ticket.jobId) queued += 1;
    }

    if (queued > 0) {
      this.logger.log(
        `pre-rendering ${queued} of ${contributions.length} chapter(s) ` +
          `of story ${storyId.slice(0, 8)}`,
      );
    }
    return queued;
  }

  /**
   * Narrate one newly saved chapter, if strangers can hear it.
   *
   * Publishing pre-renders what exists at that moment; this covers what is
   * written afterwards, so a public story never has a silent new chapter.
   * Only public stories, only real branches (a draft room's text is not
   * final), and only when pre-rendering is unbounded - with a metered
   * provider the head-of-story limit is the budget and this would bypass it.
   */
  async prerenderChapter(contributionId: string): Promise<boolean> {
    if (!this.available || this.prerenderChapters !== Number.POSITIVE_INFINITY) {
      return false;
    }
    const chapter = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: {
        id: true,
        textPlain: true,
        branchId: true,
        branch: { select: { isDraft: true, story: { select: { visibility: true } } } },
      },
    });
    if (!chapter || chapter.branch.isDraft) return false;
    if (chapter.branch.story.visibility !== 'PUBLIC') return false;
    const ticket = await this.enqueueOne(
      chapter.branchId,
      chapter,
      this.driver.defaultVoice,
      PRIORITY.BULK,
    );
    return ticket.jobId !== null;
  }

  /**
   * Queue narration for every chapter on the platform that lacks it, in the
   * default voice. A one-off after changing voices, run from
   * scripts/narrate-all.ts. Every chapter is visited once, on the branch that
   * owns it; a fork's inherited chapters are its parent's rows.
   */
  async backfillAll(): Promise<{ chapters: number; queued: number }> {
    if (!this.available) return { chapters: 0, queued: 0 };
    const voice = this.driver.defaultVoice;
    const chapters = await this.prisma.contribution.findMany({
      where: { branch: { isDraft: false } },
      select: { id: true, textPlain: true, branchId: true },
      orderBy: [{ branchId: 'asc' }, { depth: 'asc' }],
    });
    let queued = 0;
    for (const c of chapters) {
      const ticket = await this.enqueueOne(c.branchId, c, voice, PRIORITY.BULK);
      if (ticket.jobId) queued += 1;
    }
    return { chapters: chapters.length, queued };
  }

  /**
   * The narration that fits the storage budget: every chapter of stories
   * written here, and only the opening chapter of imported ones, so any
   * story can be played straight away. Later imported chapters are rendered
   * when someone asks for them. Run from scripts/narrate-planned.ts.
   *
   * Rendering the whole catalogue would be about 28 GB at 64 kbps - three
   * times the 9 GB cap - and days of synthesis.
   */
  async backfillPlanned(): Promise<{ chapters: number; queued: number }> {
    if (!this.available) return { chapters: 0, queued: 0 };
    const voice = this.driver.defaultVoice;
    const chapters = await this.prisma.contribution.findMany({
      where: {
        branch: { isDraft: false },
        OR: [
          { branch: { story: { textSource: { equals: Prisma.AnyNull } } } },
          { depth: 0 },
        ],
      },
      select: { id: true, textPlain: true, branchId: true, branch: { select: { story: { select: { textSource: true } } } } },
      // Stories written here first: they are what "Truyện trên Nhịp Bút" shows.
      orderBy: [{ depth: 'asc' }, { branchId: 'asc' }],
    });
    chapters.sort(
      (a, b) =>
        Number(a.branch.story.textSource !== null) - Number(b.branch.story.textSource !== null),
    );
    let queued = 0;
    for (const c of chapters) {
      const ticket = await this.enqueueOne(c.branchId, c, voice, PRIORITY.BULK);
      if (ticket.jobId) queued += 1;
    }
    return { chapters: chapters.length, queued };
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
  async enqueueBranch(branchId: string, voice?: string) {
    voice ??= this.driver.defaultVoice;
    this.assertUsable(voice);

    // readBranch rather than list(), because enqueueOne now needs the text to
    // address a clip by content and list() only carries a preview.
    const { contributions } = await this.stories.readBranch(branchId);
    const clips = await this.prisma.audioClip.findMany({
      where: { voice, contributionId: { in: contributions.map((c) => c.id) } },
      select: { contributionId: true },
    });
    const have = new Set(clips.map((c) => c.contributionId));
    const todo = contributions.filter((c) => !have.has(c.id));

    let queued = 0;
    for (const chapter of todo) {
      const ticket = await this.enqueueOne(
        branchId,
        chapter,
        voice,
        PRIORITY.BULK,
      );
      // A chapter whose words are already narrated elsewhere costs nothing and
      // is not queued, so it must not be counted as queued either.
      if (ticket.jobId) queued += 1;
    }

    return {
      queued,
      alreadyHad: contributions.length - queued,
      chapters: await this.list(branchId, voice),
    };
  }

  /**
   * What a clip is addressed by: the text, the voice, and what produced it.
   *
   * Not the contribution id. `revise` copies every chapter into new rows, so an
   * id-addressed clip is orphaned the moment a story is revised even though the
   * words are identical. Hashing the text instead means a revision inherits its
   * narration for free, and it deduplicates across branches as a side effect -
   * two forks that share a chapter share its audio.
   */
  private contentHash(textPlain: string, voice: string): string {
    return createHash('sha256')
      .update(
        `${this.driver.fingerprintFor?.(voice) ?? this.driver.fingerprint}\u0000${voice}\u0000${textPlain}`,
      )
      .digest('hex');
  }

  /**
   * An existing clip for exactly these bytes, whichever row paid for it.
   */
  private async clipByContent(hash: string) {
    // Newest first. The hash covers the speech, not the container, so the same
    // words may exist as an old WAV and a newer m4a; the later rendering is the
    // smaller one and the one worth adopting.
    return this.prisma.audioClip.findFirst({
      where: { contentHash: hash },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async enqueueOne(
    branchId: string,
    chapter: { id: string; textPlain: string },
    voice: string,
    priority: number,
  ): Promise<NarrationTicket> {
    const contributionId = chapter.id;

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
        estimatedMs: null,
      };
    }

    // Nothing for this row, but perhaps for these exact words. Checked here
    // rather than only in the worker so a promoted revision queues no jobs at
    // all, instead of queueing hundreds that each discover they are redundant.
    const hash = this.contentHash(chapter.textPlain, voice);
    const sameBytes = await this.clipByContent(hash);
    if (sameBytes) {
      const clip = await this.adopt(contributionId, voice, hash, sameBytes);
      return {
        jobId: null,
        status: RenderStatus.COMPLETE,
        url: clip.url,
        durationMs: clip.durationMs,
        cached: true,
        estimatedMs: null,
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
      estimatedMs: this.driver.estimateMs?.(chapter.textPlain, voice) ?? null,
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

    // Checked again here, not only at enqueue time: another job may have
    // narrated the same words while this one waited in the queue, and the
    // provider quota is far too small to spend on bytes we already hold.
    const hash = this.contentHash(chapter.textPlain, voice);
    const sameBytes = await this.clipByContent(hash);
    if (sameBytes) {
      const clip = await this.adopt(contributionId, voice, hash, sameBytes);
      await this.finish(renderJobId, clip.url);
      this.logger.log(
        `reused existing audio for chapter ${chapter.depth + 1} (${hash.slice(0, 12)})`,
      );
      return { url: clip.url };
    }

    await this.prisma.renderJob.update({
      where: { id: renderJobId },
      data: { status: RenderStatus.RUNNING, stage: 'tts', progress: 10 },
    });

    // Before synthesis, not after: a full bucket should cost nothing, not a
    // minute of speech that is then thrown away.
    if (this.storage.hasRoom && !(await this.storage.hasRoom())) {
      throw new StorageFullError('Kho lưu trữ audio đã đầy, tạm ngừng tạo giọng đọc mới.');
    }

    // Deliberately not wrapped: TtsRateLimitedError has to reach the worker,
    // which pauses the whole pool rather than failing this one job.
    const speech = await this.driver.speak(chapter.textPlain, voice);

    const encoded = await this.encoder.encode(speech.wav);

    // Named by content, so two rows holding the same words point at one file
    // rather than two copies of it. The extension is part of the key, so a
    // change of codec writes a new object beside the old one instead of
    // overwriting bytes something is already serving.
    const stored = await this.storage.put(
      `${hash}.${encoded.ext}`,
      encoded.body,
      encoded.contentType,
    );
    const url = stored.url;

    await this.prisma.audioClip.create({
      data: {
        contributionId: chapter.id,
        voice,
        provider: speech.provider,
        url,
        durationMs: speech.durationMs,
        bytes: stored.bytes,
        contentHash: hash,
      },
    });

    await this.finish(renderJobId, url);
    this.logger.log(
      `narrated chapter ${chapter.depth + 1} of branch ${data.branchId.slice(0, 8)} -> ${url} (${Math.round(stored.bytes / 1024)} KB via ${this.storage.name})`,
    );

    return { url };
  }

  /**
   * Point a contribution at audio that already exists.
   *
   * A row per contribution rather than a shared one, because the clip carries
   * per-chapter facts the player reads, and because the unique constraint on
   * (contribution, voice) is what makes narration idempotent. Only the bytes
   * are shared - which is also why deleting a file can never be driven from a
   * single clip once anything actually deletes files. Nothing does today.
   */
  private async adopt(
    contributionId: string,
    voice: string,
    hash: string,
    source: { url: string; durationMs: number | null; bytes: number | null; provider: string },
  ) {
    return this.prisma.audioClip.upsert({
      where: { contributionId_voice: { contributionId, voice } },
      create: {
        contributionId,
        voice,
        provider: source.provider,
        url: source.url,
        durationMs: source.durationMs,
        bytes: source.bytes,
        contentHash: hash,
      },
      update: {},
    });
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
