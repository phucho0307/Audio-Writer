import { isPremium } from '../premium/premium';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, Visibility } from '@prisma/client';
import { CurrentUserService } from '../auth/current-user.service';
import { emailUnverified, requiresVerifiedEmail } from '../auth/verified';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export const COMMENT_MAX = 1000;
const PAGE = 20;
/** Enough for a conversation, not for a flood. */
const PER_MINUTE = 5;
const PER_DAY = 100;

/**
 * A comment as it will be stored: line endings unified, control characters
 * and invisible direction-override characters removed (they are used to
 * make text read as something it is not), runs of blank lines collapsed.
 */
export function cleanComment(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Readers' comments under a chapter.
 *
 * Flat and newest-first: no threads, no likes. Stored and returned as plain
 * text and rendered as text, so there is no markup to sanitise. The story's
 * author can remove any comment on their story; everyone can remove their
 * own.
 */
@Injectable()
export class CommentsService {
  private readonly needVerified: boolean;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly currentUser: CurrentUserService,
  ) {
    this.needVerified = requiresVerifiedEmail(config);
  }

  /** The story a chapter belongs to; 404 for a private one - it has no audience to comment. */
  private async storyOf(contributionId: string) {
    const chapter = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { branch: { select: { story: { select: { id: true, ownerId: true, visibility: true } } } } },
    });
    const story = chapter?.branch.story;
    if (!story || story.visibility === Visibility.PRIVATE) {
      throw new NotFoundException({ code: 'CHAPTER_NOT_FOUND', message: 'Không tìm thấy chương.' });
    }
    return story;
  }

  async list(contributionId: string, cursor?: string) {
    const story = await this.storyOf(contributionId);
    const viewer = await this.currentUser.optional();
    const moderator = viewer !== null && (viewer.id === story.ownerId || viewer.role === Role.ADMIN);

    const [rows, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: { contributionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: { handle: true, displayName: true, avatarUrl: true, premiumUntil: true } } },
      }),
      this.prisma.comment.count({ where: { contributionId } }),
    ]);

    const page = rows.slice(0, PAGE);
    return {
      total,
      items: page.map((c) => this.shape(c, viewer?.id ?? null, moderator)),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  async add(contributionId: string, raw: string) {
    const user = await this.currentUser.current();
    if (this.needVerified && !user.emailVerifiedAt) throw emailUnverified();
    const story = await this.storyOf(contributionId);

    const body = cleanComment(raw);
    if (body.length === 0) {
      throw new BadRequestException({ code: 'COMMENT_EMPTY', message: 'Bình luận đang trống.' });
    }
    if (body.length > COMMENT_MAX) {
      throw new BadRequestException({
        code: 'COMMENT_TOO_LONG',
        message: `Bình luận tối đa ${COMMENT_MAX} ký tự.`,
      });
    }

    const [minute, day] = await Promise.all([
      this.redis.incrementWindow(`comment:min:${user.id}`, 60),
      this.redis.incrementWindow(`comment:day:${user.id}`, 24 * 3600),
    ]).catch(() => [0, 0]);
    if (minute > PER_MINUTE || day > PER_DAY) {
      throw new HttpException(
        { code: 'COMMENT_RATE', message: 'Bạn bình luận hơi nhanh. Nghỉ một chút rồi viết tiếp nhé.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // The same words twice under one chapter is a double tap or a bot.
    const same = await this.prisma.comment.findFirst({
      where: { contributionId, userId: user.id, body },
      select: { id: true },
    });
    if (same) {
      throw new ConflictException({ code: 'COMMENT_DUPLICATE', message: 'Bạn đã gửi bình luận này rồi.' });
    }

    const created = await this.prisma.comment.create({
      data: { contributionId, userId: user.id, body },
      include: { user: { select: { handle: true, displayName: true, avatarUrl: true, premiumUntil: true } } },
    });
    return this.shape(created, user.id, user.id === story.ownerId || user.role === Role.ADMIN);
  }

  async remove(id: string) {
    const user = await this.currentUser.current();
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: {
        userId: true,
        contribution: { select: { branch: { select: { story: { select: { ownerId: true } } } } } },
      },
    });
    if (!comment) {
      throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', message: 'Không tìm thấy bình luận.' });
    }
    const allowed =
      comment.userId === user.id ||
      comment.contribution.branch.story.ownerId === user.id ||
      user.role === Role.ADMIN;
    if (!allowed) {
      throw new ForbiddenException({ code: 'COMMENT_NOT_YOURS', message: 'Bạn không xoá được bình luận này.' });
    }
    await this.prisma.comment.delete({ where: { id } });
    return { deleted: true, id };
  }

  private shape(
    c: {
      id: string;
      body: string;
      createdAt: Date;
      userId: string;
      user: { handle: string; displayName: string; avatarUrl: string | null; premiumUntil: Date | null };
    },
    viewerId: string | null,
    moderator: boolean,
  ) {
    const mine = viewerId !== null && c.userId === viewerId;
    return {
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: {
        handle: c.user.handle,
        displayName: c.user.displayName,
        avatarUrl: c.user.avatarUrl,
        premium: isPremium(c.user),
      },
      mine,
      canDelete: mine || moderator,
    };
  }
}
