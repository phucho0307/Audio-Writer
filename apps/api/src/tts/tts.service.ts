import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { PaywallService } from '../stories/paywall.service';
import { StoriesService } from '../stories/stories.service';
import {
  DEFAULT_VOICE,
  GeminiTtsDriver,
  TtsRateLimitedError,
  VOICES,
} from './gemini-tts.driver';

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

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly driver: GeminiTtsDriver;
  private readonly dir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stories: StoriesService,
    private readonly paywall: PaywallService,
    private readonly currentUser: CurrentUserService,
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
    return { voices: VOICES, default: DEFAULT_VOICE };
  }

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

    return contributions.map((c) => {
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
    }).concat(
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

  /**
   * Narrates one chapter, or returns the existing clip.
   *
   * Caching is not an optimisation here. The free tier allows about twenty
   * requests a day across the whole project, so re-synthesising a chapter
   * someone already listened to would be spending a scarce resource on nothing.
   */
  async speakChapter(branchId: string, depth: number, voice = DEFAULT_VOICE) {
    if (!this.available) {
      throw new BadRequestException('No TTS provider configured.');
    }
    if (!VOICES.some((v) => v.id === voice)) {
      throw new BadRequestException(`Unknown voice "${voice}".`);
    }

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

    const existing = await this.prisma.audioClip.findUnique({
      where: {
        contributionId_voice: { contributionId: chapter.id, voice },
      },
    });
    if (existing) return { ...existing, cached: true };

    let speech;
    try {
      speech = await this.driver.speak(chapter.textPlain, voice);
    } catch (err) {
      if (err instanceof TtsRateLimitedError) {
        throw new ForbiddenException({
          code: 'TTS_RATE_LIMITED',
          message: 'Bản đọc đang quá tải. Thử lại sau ít phút.',
          retryAfterMs: err.retryAfterMs,
        });
      }
      throw err;
    }

    await mkdir(this.dir, { recursive: true });
    const file = `${chapter.id}-${voice}.wav`;
    await writeFile(join(this.dir, file), speech.wav);

    const clip = await this.prisma.audioClip.create({
      data: {
        contributionId: chapter.id,
        voice,
        provider: speech.provider,
        url: `/audio/${file}`,
        durationMs: speech.durationMs,
        bytes: speech.wav.length,
      },
    });

    this.logger.log(
      `narrated branch ${branchId.slice(0, 8)} ch${depth + 1} -> ${file}`,
    );
    return { ...clip, cached: false };
  }

  /**
   * Narrates the chapters of a branch that do not have audio yet, in order.
   *
   * Sequential rather than parallel, and it stops at the first rate limit
   * instead of failing outright - a partly narrated story is still listenable,
   * and the caller is told where it stopped.
   */
  async speakBranch(branchId: string, voice = DEFAULT_VOICE) {
    const chapters = await this.list(branchId, voice);
    const todo = chapters.filter((c) => !c.locked && !c.url);

    const done: number[] = [];
    let stoppedAt: number | null = null;
    let reason: string | null = null;

    for (const chapter of todo) {
      try {
        await this.speakChapter(branchId, chapter.depth, voice);
        done.push(chapter.depth);
      } catch (err) {
        stoppedAt = chapter.depth;
        reason =
          err instanceof ForbiddenException
            ? 'rate_limited'
            : (err as Error).message;
        break;
      }
    }

    return {
      narrated: done.length,
      alreadyHad: chapters.filter((c) => c.url).length,
      stoppedAt,
      reason,
      chapters: await this.list(branchId, voice),
    };
  }
}
