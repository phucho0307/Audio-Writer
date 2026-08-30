import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthorType,
  Role,
  Visibility,
  type Branch,
  type Contribution,
  type Story,
  type User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { PaywallService } from './paywall.service';
import type {
  CommitContributionDto,
  CreateStoryDto,
  ForkBranchDto,
  UpdateStoryDto,
} from './dto';

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly paywall: PaywallService,
  ) {}

  // -------------------------------------------------------------------------
  // Permissions
  //
  // Ownership is the only role here. There is no admin, no moderator and no
  // collaborator yet, so every rule reduces to "is this your story" - and
  // keeping that in three named helpers means the answer cannot drift between
  // callers the way it just had, with `update` quietly enforcing nothing.
  // -------------------------------------------------------------------------

  /**
   * The story, or 403 unless the caller owns it or is an admin.
   *
   * Admin exists because the seeded sample stories belong to an account with
   * no googleSub - nobody can sign in as it, so without this they would be
   * permanently unmanageable. The role is set by hand in the database; there
   * is no endpoint that grants it.
   */
  private async ownedStory(id: string): Promise<{ story: Story; user: User }> {
    const user = await this.currentUser.current();
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException(`Story ${id} not found`);

    if (story.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'NOT_OWNER',
        message: 'Chỉ chủ sở hữu truyện mới làm được việc này.',
      });
    }
    return { story, user };
  }

  /**
   * Prisma filter for stories a given viewer is allowed to see listed.
   *
   * UNLISTED is deliberately absent rather than hidden-but-fetchable: it means
   * "reachable by link, not in the feed", which is what someone sharing a
   * draft with friends wants. PRIVATE is owner-only everywhere.
   */
  private listVisibility(user: User | null) {
    if (user?.role === Role.ADMIN) return {};
    return user
      ? { OR: [{ visibility: Visibility.PUBLIC }, { ownerId: user.id }] }
      : { visibility: Visibility.PUBLIC };
  }

  /** Throws 404 - not 403 - when a private story is fetched by a stranger. */
  private assertReadable(
    story: { visibility: Visibility; ownerId: string },
    user: User | null,
  ): void {
    if (story.visibility !== Visibility.PRIVATE) return;
    if (story.ownerId === user?.id) return;
    if (user?.role === Role.ADMIN) return;
    // Confirming it exists would leak the id of every private draft to anyone
    // willing to guess. Say nothing.
    throw new NotFoundException('Story not found');
  }

  // -------------------------------------------------------------------------
  // Stories
  // -------------------------------------------------------------------------

  async create(dto: CreateStoryDto) {
    const user = await this.currentUser.current();

    // A story is never useful without somewhere to write, so the root branch
    // is created in the same transaction rather than lazily on first write.
    return this.prisma.$transaction(async (tx) => {
      const story = await tx.story.create({
        data: {
          ownerId: user.id,
          title: dto.title,
          genres: dto.genres ?? [],
          language: dto.language ?? 'vi',
        },
      });

      const branch = await tx.branch.create({
        data: {
          storyId: story.id,
          ownerId: user.id,
          name: 'main',
          isRoot: true,
          lineage: [],
        },
      });

      return { ...story, branches: [branch] };
    });
  }

  async list() {
    // `optional`, not `current`: browsing is public. Signed out you see the
    // public shelf; signed in you also see your own drafts.
    const viewer = await this.currentUser.optional();

    return this.prisma.story.findMany({
      where: this.listVisibility(viewer),
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { handle: true, displayName: true } },
        branches: {
          where: { isRoot: true },
          select: { id: true },
          take: 1,
        },
      },
      take: 50,
    });
  }

  async get(id: string) {
    const story = await this.prisma.story.findUnique({
      where: { id },
      include: {
        owner: { select: { handle: true, displayName: true } },
        branches: {
          orderBy: { createdAt: 'asc' },
          include: {
            owner: { select: { handle: true, displayName: true } },
            _count: { select: { contributions: true } },
          },
        },
      },
    });
    if (!story) throw new NotFoundException(`Story ${id} not found`);

    const viewer = await this.currentUser.optional();
    this.assertReadable(story, viewer);
    return story;
  }

  /**
   * Owner-only. Covers publishing (`visibility`), marking a story finished
   * (`status`), whether others may fork it, and the paywall knobs.
   *
   * Publishing is the one place the fork policy has to be answered. A story
   * whose `allowForks` is still null cannot leave PRIVATE - otherwise the
   * writer inherits a default they never saw, on the single decision that
   * determines whether strangers can take their story somewhere else.
   */
  async update(id: string, dto: UpdateStoryDto) {
    const { story } = await this.ownedStory(id);

    const visibility = dto.visibility ?? story.visibility;
    const allowForks =
      dto.allowForks !== undefined ? dto.allowForks : story.allowForks;

    if (visibility !== Visibility.PRIVATE && allowForks === null) {
      throw new BadRequestException({
        code: 'FORK_POLICY_REQUIRED',
        message:
          'Hãy chọn cho phép rẽ nhánh hay không trước khi đăng truyện.',
      });
    }

    return this.prisma.story.update({ where: { id }, data: dto });
  }

  /**
   * Deletes a story and everything under it. The cascade rules on branches,
   * contributions, scenes and unlocks do the rest.
   */
  async remove(id: string) {
    await this.ownedStory(id);
    await this.prisma.story.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Counts one read. Deliberately not deduplicated yet - a real implementation
   * needs a per-viewer window in Redis, and doing it wrong is worse than
   * doing it late.
   */
  async recordView(id: string) {
    const user = await this.currentUser.current();
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException(`Story ${id} not found`);

    // The author refreshing their own page is not an audience.
    if (story.ownerId === user.id) return { viewCount: story.viewCount };

    const updated = await this.prisma.story.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Branch reading
  // -------------------------------------------------------------------------

  /**
   * Resolves what a reader actually sees on a branch.
   *
   * A fork copies no contributions, so a branch's text is its ancestors' rows
   * up to the depth each fork happened, followed by the branch's own. Walking
   * `lineage` nearest-first and narrowing the depth cutoff at each step gives
   * the full chain without recursion.
   */
  async readBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { story: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const user = await this.currentUser.current();
    const access = await this.paywall.access(branch.story, user.id);
    const maxDepth = await this.paywall.readableDepth(branch.story, user.id);

    const inherited: Contribution[] = [];
    let cutoff = branch.forkedAtDepth;

    for (const ancestorId of [...branch.lineage].reverse()) {
      if (cutoff === null) break;

      const rows = await this.prisma.contribution.findMany({
        where: { branchId: ancestorId, depth: { lte: cutoff } },
        orderBy: { depth: 'asc' },
        include: { author: { select: { handle: true, displayName: true } } },
      });
      inherited.unshift(...rows);

      const ancestor = await this.prisma.branch.findUnique({
        where: { id: ancestorId },
        select: { forkedAtDepth: true },
      });
      cutoff = ancestor?.forkedAtDepth ?? null;
    }

    const own = await this.prisma.contribution.findMany({
      where: { branchId },
      orderBy: { depth: 'asc' },
      include: { author: { select: { handle: true, displayName: true } } },
    });

    // A branch overrides its ancestors at any depth it has written itself.
    const ownDepths = new Set(own.map((c) => c.depth));
    const resolved = [
      ...inherited.filter((c) => !ownDepths.has(c.depth)),
      ...own,
    ].sort((a, b) => a.depth - b.depth);

    // The gate is applied here rather than in the query, because the same
    // resolution runs for the owner, and because the client needs to know how
    // many chapters exist beyond the wall in order to offer the unlock.
    const contributions = resolved.filter((c) => c.depth <= maxDepth);
    const hiddenCount = resolved.length - contributions.length;

    return {
      branch,
      contributions,
      ownedCount: own.filter((c) => c.depth <= maxDepth).length,
      text: contributions.map((c) => c.textPlain).join('\n\n'),
      access: { ...access, lockedCount: hiddenCount },
    };
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  async commit(branchId: string, dto: CommitContributionDto) {
    const user = await this.currentUser.current();

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

      // First write on a forked branch continues from the fork point, not from
      // zero; on a root branch with no head it starts at 0.
      const nextDepth =
        branch.headContributionId !== null
          ? branch.depth + 1
          : (branch.forkedAtDepth ?? -1) + 1;

      const contribution = await tx.contribution.create({
        data: {
          branchId,
          parentId: branch.headContributionId,
          depth: nextDepth,
          authorId: user.id,
          authorType: dto.authorType,
          content: dto.content as never,
          textPlain: dto.textPlain,
          wordCount: countWords(dto.textPlain),
          modelProvider: dto.modelProvider,
          modelName: dto.modelName,
        },
      });

      await tx.branch.update({
        where: { id: branchId },
        data: { headContributionId: contribution.id, depth: nextDepth },
      });

      // Only the root branch defines the story's length.
      //
      // These two counters are what browse cards present as "8 chương / 1500
      // từ", i.e. the story as its author wrote it. Counting forks here meant a
      // stranger writing one chapter on their own branch silently changed the
      // original's numbers for every reader. Fork activity belongs in
      // branchCount, which already tracks it.
      if (branch.isRoot) {
        await tx.story.update({
          where: { id: branch.storyId },
          data: {
            contributionCount: { increment: 1 },
            wordCount: { increment: contribution.wordCount },
          },
        });
      } else {
        // Still bump updatedAt so the feed surfaces active stories.
        await tx.story.update({
          where: { id: branch.storyId },
          data: { updatedAt: new Date() },
        });
      }

      return contribution;
    });
  }

  async fork(branchId: string, dto: ForkBranchDto): Promise<Branch> {
    const user = await this.currentUser.current();

    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.branch.findUnique({ where: { id: branchId } });
      if (!parent) throw new NotFoundException(`Branch ${branchId} not found`);

      if (dto.atDepth > parent.depth) {
        throw new BadRequestException(
          `Cannot fork at depth ${dto.atDepth}: branch only reaches ${parent.depth}`,
        );
      }

      // Forking is free, but it cannot be a way around the paywall: a fork
      // inherits its parent's chapters, so allowing a fork past the readable
      // depth would hand over locked text for nothing.
      const story = await tx.story.findUniqueOrThrow({
        where: { id: parent.storyId },
      });

      // The owner can always fork their own work - the switch is about what
      // other people may do, not a lock the writer can shut themselves out of.
      // `null` is undeclared, not permitted. A story in that state should be
      // private anyway, but the fork path must not be the one place that
      // treats "never answered" as yes.
      if (story.allowForks !== true && story.ownerId !== user.id) {
        throw new ForbiddenException({
          code: 'FORKS_DISABLED',
          message: 'Tác giả đã tắt tính năng rẽ nhánh cho truyện này.',
        });
      }

      this.assertReadable(story, user);

      const maxDepth = await this.paywall.readableDepth(story, user.id);
      if (dto.atDepth > maxDepth) {
        throw new ForbiddenException({
          code: 'LOCKED_CHAPTERS',
          message: 'Mở khoá truyện trước khi rẽ nhánh từ chương này.',
          unlockPrice: story.unlockPrice,
        });
      }

      const branch = await tx.branch.create({
        data: {
          storyId: parent.storyId,
          ownerId: user.id,
          name: dto.name ?? `fork-${Date.now().toString(36)}`,
          forkedFromBranchId: parent.id,
          forkedAtDepth: dto.atDepth,
          // Ancestors of the parent, plus the parent itself. Root first.
          lineage: [...parent.lineage, parent.id],
          depth: dto.atDepth,
        },
      });

      await tx.story.update({
        where: { id: parent.storyId },
        data: { branchCount: { increment: 1 } },
      });

      return branch;
    });
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
