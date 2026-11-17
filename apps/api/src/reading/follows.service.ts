import { Injectable, NotFoundException } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { CurrentUserService } from '../auth/current-user.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Following a story, and knowing when it has grown.
 *
 * "New chapters" is a comparison - the story's chapter count against what
 * the follower had seen - made when the follower asks. Publishing a chapter
 * writes nothing per follower, so it costs the same for a story with a
 * hundred thousand followers as for one with none; the alternative, a
 * notification row per follower per chapter, is a write storm on exactly the
 * stories that are doing well.
 */
@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** Works signed out: the count is public, `following` is then false. */
  async state(storyId: string) {
    const user = await this.currentUser.optional();
    const [followers, mine] = await Promise.all([
      this.prisma.storyFollow.count({ where: { storyId } }),
      user
        ? this.prisma.storyFollow.findUnique({
            where: { userId_storyId: { userId: user.id, storyId } },
            select: { storyId: true },
          })
        : null,
    ]);
    return { following: mine !== null, followers };
  }

  async follow(storyId: string) {
    const user = await this.currentUser.current();
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { visibility: true, ownerId: true, contributionCount: true },
    });
    if (!story || (story.visibility === Visibility.PRIVATE && story.ownerId !== user.id)) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Không tìm thấy truyện.' });
    }
    await this.prisma.storyFollow.upsert({
      where: { userId_storyId: { userId: user.id, storyId } },
      // Everything there now counts as seen: "new" means after this moment.
      create: { userId: user.id, storyId, seenChapters: story.contributionCount },
      update: {},
    });
    return this.state(storyId);
  }

  async unfollow(storyId: string) {
    const user = await this.currentUser.current();
    await this.prisma.storyFollow.deleteMany({ where: { userId: user.id, storyId } });
    return this.state(storyId);
  }

  /** The follower has opened the story: nothing in it is new any more. */
  async seen(storyId: string) {
    const user = await this.currentUser.current();
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { contributionCount: true },
    });
    if (story) {
      await this.prisma.storyFollow.updateMany({
        where: { userId: user.id, storyId },
        data: { seenChapters: story.contributionCount },
      });
    }
    return { ok: true };
  }

  /** Followed stories, those with new chapters first. */
  async mine() {
    const user = await this.currentUser.current();
    const rows = await this.prisma.storyFollow.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        story: {
          select: {
            id: true,
            title: true,
            coverUrl: true,
            genres: true,
            contributionCount: true,
            updatedAt: true,
            visibility: true,
            ownerId: true,
          },
        },
      },
    });
    return rows
      .filter((r) => r.story.visibility !== Visibility.PRIVATE || r.story.ownerId === user.id)
      .map((r) => unseen(r.story, r.seenChapters))
      .sort((a, b) => b.newChapters - a.newChapters || b.updatedAt.getTime() - a.updatedAt.getTime());
  }
}

/** What a follower has not seen yet of one story. */
export function unseen(
  story: { id: string; title: string; coverUrl: string | null; genres: string[]; contributionCount: number; updatedAt: Date },
  seenChapters: number,
) {
  return {
    storyId: story.id,
    title: story.title,
    coverUrl: story.coverUrl,
    genres: story.genres,
    totalChapters: story.contributionCount,
    // A story can lose chapters (a revision promoted); never negative.
    newChapters: Math.max(0, story.contributionCount - seenChapters),
    /** 1-based chapter to open to read what is new; the last one if nothing is. */
    firstNew: Math.min(seenChapters, Math.max(0, story.contributionCount - 1)) + 1,
    updatedAt: story.updatedAt,
  };
}
