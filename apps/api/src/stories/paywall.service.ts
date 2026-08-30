import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntitlementKind, LedgerKind, type Story } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';

export interface AccessState {
  freeChapters: number;
  unlockPrice: number;
  /** True when this reader can see every chapter. */
  unlocked: boolean;
  isOwner: boolean;
  /** Chapters withheld from this reader right now. */
  lockedCount: number;
}

export interface Wallet {
  readCredits: number;
  earned: number;
  paidOut: number;
  balance: number;
}

@Injectable()
export class PaywallService {
  /** Writer's cut of every unlock, as a percentage. */
  private readonly writerShare: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    config: ConfigService,
  ) {
    this.writerShare = Number(config.get('WRITER_REVENUE_SHARE', 70));
  }

  // -------------------------------------------------------------------------

  /**
   * A story is never fully hidden. The first `freeChapters` stay open forever
   * so the story can keep spreading and being forked - a paywall that stops
   * discovery caps the story's reach at the moment it starts working.
   */
  /** `userId` is null for a signed-out reader, who owns nothing and has
   * unlocked nothing but can still read the free chapters. */
  async access(story: Story, userId: string | null): Promise<AccessState> {
    const isOwner = userId !== null && story.ownerId === userId;
    const gated = story.unlockPrice > 0;

    if (!gated || isOwner) {
      return {
        freeChapters: story.freeChapters,
        unlockPrice: story.unlockPrice,
        unlocked: true,
        isOwner,
        lockedCount: 0,
      };
    }

    const unlock = userId
      ? await this.prisma.storyUnlock.findUnique({
          where: { storyId_userId: { storyId: story.id, userId } },
        })
      : null;

    const locked = Math.max(
      0,
      story.contributionCount - story.freeChapters,
    );

    return {
      freeChapters: story.freeChapters,
      unlockPrice: story.unlockPrice,
      unlocked: unlock !== null,
      isOwner,
      lockedCount: unlock ? 0 : locked,
    };
  }

  /** Depth this reader can read up to, inclusive. Infinity when unlocked. */
  async readableDepth(story: Story, userId: string | null): Promise<number> {
    const state = await this.access(story, userId);
    return state.unlocked
      ? Number.POSITIVE_INFINITY
      : state.freeChapters - 1;
  }

  // -------------------------------------------------------------------------

  /**
   * Charges the reader and credits the writer, in one transaction.
   *
   * The unique constraint on (storyId, userId) is what makes a double-click
   * safe: the second attempt fails the insert rather than double-charging.
   */
  async unlock(storyId: string) {
    const reader = await this.currentUser.current();

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });
    if (!story) throw new NotFoundException(`Story ${storyId} not found`);
    if (story.unlockPrice <= 0) {
      throw new BadRequestException('This story is not gated.');
    }
    if (story.ownerId === reader.id) {
      throw new BadRequestException('You already own this story.');
    }

    const existing = await this.prisma.storyUnlock.findUnique({
      where: { storyId_userId: { storyId, userId: reader.id } },
    });
    if (existing) return this.access(story, reader.id);

    const credits = await this.readCredits(reader.id);
    if (credits < story.unlockPrice) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_CREDITS',
        message: `Cần ${story.unlockPrice} credit để mở khoá. Bạn có ${credits}.`,
        required: story.unlockPrice,
        balance: credits,
      });
    }

    // Rounded, not floored. Flooring turned an advertised 70% into 60% on a
    // 5-credit story (floor(3.5) = 3), and the smaller the price the worse the
    // gap - exactly where new writers start. The platform absorbs the half
    // credit instead.
    const writerCut = Math.round((story.unlockPrice * this.writerShare) / 100);

    await this.prisma.$transaction(async (tx) => {
      await tx.storyUnlock.create({
        data: { storyId, userId: reader.id, pricePaid: story.unlockPrice },
      });

      // Oldest pack first so anything with an expiry is spent before it lapses.
      let remaining = story.unlockPrice;
      const packs = await tx.entitlement.findMany({
        where: {
          userId: reader.id,
          kind: EntitlementKind.READ_CREDITS,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
      });

      for (const pack of packs) {
        if (remaining <= 0) break;
        const available = pack.granted - pack.consumed;
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        await tx.entitlement.update({
          where: { id: pack.id },
          data: { consumed: { increment: take } },
        });
        remaining -= take;
      }

      await tx.ledgerEntry.create({
        data: {
          userId: story.ownerId,
          kind: LedgerKind.UNLOCK_EARNING,
          amount: writerCut,
          storyId,
          note: `Mở khoá "${story.title}" (${this.writerShare}% của ${story.unlockPrice})`,
        },
      });
    });

    return this.access(story, reader.id);
  }

  // -------------------------------------------------------------------------

  async readCredits(userId: string): Promise<number> {
    const rows = await this.prisma.entitlement.findMany({
      where: {
        userId,
        kind: EntitlementKind.READ_CREDITS,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { granted: true, consumed: true },
    });
    return rows.reduce((n, r) => n + (r.granted - r.consumed), 0);
  }

  async wallet(): Promise<Wallet> {
    const user = await this.currentUser.current();

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      select: { amount: true },
    });

    const earned = entries
      .filter((e) => e.amount > 0)
      .reduce((n, e) => n + e.amount, 0);
    const paidOut = entries
      .filter((e) => e.amount < 0)
      .reduce((n, e) => n - e.amount, 0);

    return {
      readCredits: await this.readCredits(user.id),
      earned,
      paidOut,
      balance: earned - paidOut,
    };
  }

  async earnings(limit = 20) {
    const user = await this.currentUser.current();
    return this.prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Stands in for checkout until payments exist. */
  async grantReadCredits(amount: number) {
    const user = await this.currentUser.current();
    await this.prisma.entitlement.create({
      data: {
        userId: user.id,
        kind: EntitlementKind.READ_CREDITS,
        granted: amount,
      },
    });
    return this.wallet();
  }
}
