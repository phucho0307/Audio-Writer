import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';

/**
 * Below this many ratings a story shows "not enough ratings yet" instead of
 * an average. One reader's five stars is an opinion, not a score.
 */
export const MIN_RATINGS_SHOWN = 5;

export interface RatingSummary {
  /** Null until MIN_RATINGS_SHOWN readers have rated. */
  average: number | null;
  count: number;
  /** The caller's own stars, if signed in and rated. */
  mine: number | null;
  /** Whether the caller may rate right now, and if not, why. */
  canRate: boolean;
  reason: 'SIGN_IN' | 'READ_FIRST' | 'OWN_STORY' | null;
}

/**
 * Readers' stars for stories.
 *
 * Three rules keep the numbers honest: one rating per reader per story
 * (changing your mind overwrites it), only readers who have opened at least
 * one chapter may rate, and an author cannot rate their own story. An admin
 * is exempt from the last two: the seeded library is owned by the admin
 * account, and the admin curates it. The
 * story row carries count and sum, updated in the same transaction, so lists
 * and rankings never aggregate the ratings table.
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async summary(storyId: string): Promise<RatingSummary> {
    const story = await this.publicStory(storyId);
    const user = await this.currentUser.optional();

    let mine: number | null = null;
    let reason: RatingSummary['reason'] = null;
    if (!user) reason = 'SIGN_IN';
    else {
      const admin = user.role === Role.ADMIN;
      const [rating, read] = await Promise.all([
        this.prisma.storyRating.findUnique({
          where: { storyId_userId: { storyId, userId: user.id } },
          select: { stars: true },
        }),
        this.hasRead(storyId, user.id),
      ]);
      mine = rating?.stars ?? null;
      if (!admin && story.ownerId === user.id) reason = 'OWN_STORY';
      else if (!admin && !read && mine === null) reason = 'READ_FIRST';
    }

    return {
      ...averageOf(story.ratingCount, story.ratingSum),
      mine,
      canRate: reason === null,
      reason,
    };
  }

  async rate(storyId: string, stars: number): Promise<RatingSummary> {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new BadRequestException({ code: 'RATING_INVALID', message: 'Chấm từ 1 đến 5 sao.' });
    }
    const user = await this.currentUser.current();
    const story = await this.publicStory(storyId);
    const admin = user.role === Role.ADMIN;
    if (!admin && story.ownerId === user.id) {
      throw new ForbiddenException({ code: 'RATING_OWN_STORY', message: 'Không tự chấm sao truyện của mình được.' });
    }
    if (!admin && !(await this.hasRead(storyId, user.id))) {
      throw new ForbiddenException({
        code: 'RATING_READ_FIRST',
        message: 'Đọc hoặc nghe ít nhất một chương rồi hãy chấm sao.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.storyRating.findUnique({
        where: { storyId_userId: { storyId, userId: user.id } },
        select: { stars: true },
      });
      await tx.storyRating.upsert({
        where: { storyId_userId: { storyId, userId: user.id } },
        create: { storyId, userId: user.id, stars },
        update: { stars },
      });
      await tx.story.update({
        where: { id: storyId },
        data: before
          ? { ratingSum: { increment: stars - before.stars } }
          : { ratingCount: { increment: 1 }, ratingSum: { increment: stars } },
      });
    });
    return this.summary(storyId);
  }

  async unrate(storyId: string): Promise<RatingSummary> {
    const user = await this.currentUser.current();
    await this.publicStory(storyId);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.storyRating.findUnique({
        where: { storyId_userId: { storyId, userId: user.id } },
        select: { stars: true },
      });
      if (!before) return;
      await tx.storyRating.delete({ where: { storyId_userId: { storyId, userId: user.id } } });
      await tx.story.update({
        where: { id: storyId },
        data: { ratingCount: { decrement: 1 }, ratingSum: { decrement: before.stars } },
      });
    });
    return this.summary(storyId);
  }

  private async hasRead(storyId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.storyReader.findUnique({
      where: { storyId_userId: { storyId, userId } },
      select: { storyId: true },
    });
    return row !== null;
  }

  /** Only public stories take ratings; a private draft has no audience. */
  private async publicStory(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, ownerId: true, visibility: true, ratingCount: true, ratingSum: true },
    });
    if (!story || story.visibility !== Visibility.PUBLIC) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Không tìm thấy truyện.' });
    }
    return story;
  }
}

export function averageOf(count: number, sum: number): { average: number | null; count: number } {
  return {
    average: count >= MIN_RATINGS_SHOWN ? Math.round((sum / count) * 10) / 10 : null,
    count,
  };
}
