import { Injectable, NotFoundException } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { CurrentUserService } from '../auth/current-user.service';
import { PrismaService } from '../prisma/prisma.service';

/** Stories a reader's "nghe tiếp" list remembers; older ones fall off. */
const KEEP = 100;
const SHOWN = 30;

export interface ProgressInput {
  branchId?: string | null;
  /** 0-based chapter. */
  depth: number;
  /** Seconds into the chapter's narration. */
  at: number;
  /** Epoch milliseconds on the reader's device. */
  updatedAt: number;
}

/**
 * Where each signed-in reader stopped, so "nghe tiếp" follows them from
 * phone to laptop.
 *
 * The device keeps its own copy and works without an account; this is the
 * shared one. Positions are merged newest-wins on the time the reader was
 * actually there (their clock, never later than ours), so a phone that was
 * offline for a week cannot rewind what was heard since somewhere else.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async list() {
    const user = await this.currentUser.current();
    const rows = await this.prisma.readingProgress.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: KEEP,
      include: {
        story: {
          select: { id: true, title: true, coverUrl: true, contributionCount: true, visibility: true, ownerId: true },
        },
      },
    });
    // Anything past the cap is dropped here, once per visit, rather than on
    // every save.
    if (rows.length === KEEP) {
      await this.prisma.readingProgress.deleteMany({
        where: { userId: user.id, updatedAt: { lt: rows[KEEP - 1].updatedAt } },
      });
    }
    return rows
      // A story taken private since is not offered back to its old readers.
      .filter((r) => r.story.visibility !== Visibility.PRIVATE || r.story.ownerId === user.id)
      .slice(0, SHOWN)
      .map((r) => ({
        storyId: r.storyId,
        title: r.story.title,
        coverUrl: r.story.coverUrl,
        totalChapters: r.story.contributionCount,
        branchId: r.branchId,
        depth: r.depth,
        at: r.positionSec,
        updatedAt: r.updatedAt.getTime(),
      }));
  }

  async save(storyId: string, input: ProgressInput) {
    const user = await this.currentUser.current();
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { visibility: true, ownerId: true },
    });
    if (!story || (story.visibility === Visibility.PRIVATE && story.ownerId !== user.id)) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Không tìm thấy truyện.' });
    }

    const now = Date.now();
    // A clock set to next year must not make this position unbeatable.
    const when = new Date(Number.isFinite(input.updatedAt) ? Math.min(input.updatedAt, now) : now);
    const branchId = input.branchId ?? null;
    const depth = Math.trunc(input.depth);
    const at = Math.trunc(input.at);

    // Newest wins, decided in the database so two devices saving at once
    // cannot interleave a read and a write.
    await this.prisma.$executeRaw`
      INSERT INTO reading_progress ("userId", "storyId", "branchId", "depth", "positionSec", "updatedAt")
      VALUES (${user.id}::uuid, ${storyId}::uuid, ${branchId}::uuid, ${depth}, ${at}, ${when})
      ON CONFLICT ("userId", "storyId") DO UPDATE
        SET "branchId" = EXCLUDED."branchId", "depth" = EXCLUDED."depth",
            "positionSec" = EXCLUDED."positionSec", "updatedAt" = EXCLUDED."updatedAt"
        WHERE reading_progress."updatedAt" <= EXCLUDED."updatedAt"`;

    // Having a position in a story is having opened it, which is what rating
    // asks for. The author is not their own audience.
    if (story.ownerId !== user.id) {
      await this.prisma.storyReader.upsert({
        where: { storyId_userId: { storyId, userId: user.id } },
        create: { storyId, userId: user.id },
        update: {},
      });
    }
    return { ok: true };
  }

  async forget(storyId: string) {
    const user = await this.currentUser.current();
    await this.prisma.readingProgress.deleteMany({ where: { userId: user.id, storyId } });
    return { ok: true };
  }
}
