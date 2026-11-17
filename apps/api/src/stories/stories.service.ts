import {
  BadRequestException,
  ConflictException,
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
import { DomainEvents } from '../events/domain-events';
import { RedisService } from '../redis/redis.service';
import type {
  CommitContributionDto,
  CreateStoryDto,
  EditContributionDto,
  ForkBranchDto,
  ReviseDto,
  UpdateStoryDto,
} from './dto';

/** One reader opening one story counts once in this long. */
const VIEW_WINDOW_SECONDS = 30 * 60;

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly paywall: PaywallService,
    private readonly events: DomainEvents,
    private readonly redis: RedisService,
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
  async ownedStory(id: string): Promise<{ story: Story; user: User }> {
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
  /**
   * Two different questions, so two different filters.
   *
   * The shelf is discovery: only PUBLIC, for everybody including admins - a
   * moderator's view of every draft on the platform is a different feature,
   * and folding it in here would put strangers' private work on the browse
   * page. "Mine" is the workspace, where your own drafts are the point.
   */
  private listVisibility(user: User | null, mine: boolean) {
    if (mine) return { ownerId: user!.id };
    return { visibility: Visibility.PUBLIC };
  }

  /**
   * Throws 404 - not 403 - when a private story is fetched by a stranger.
   *
   * Someone the author invited into one of its draft rooms is not a stranger.
   * The room already shows them the unpublished text, so refusing them the
   * published chapters was incoherent - and it broke the one thing an invited
   * writer produces: their own branch, which they then could not open, on a
   * story they could not fork, after a redirect to a page that 404'd.
   */
  private async assertReadable(
    story: { id: string; visibility: Visibility; ownerId: string },
    user: User | null,
  ): Promise<void> {
    if (story.visibility !== Visibility.PRIVATE) return;
    if (story.ownerId === user?.id) return;
    if (user?.role === Role.ADMIN) return;

    if (user) {
      const invited = await this.prisma.branchCollaborator.findFirst({
        where: { userId: user.id, branch: { storyId: story.id } },
        select: { id: true },
      });
      if (invited) return;
    }

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
          visibility: dto.visibility ?? Visibility.PRIVATE,
          // A public story needs a fork policy (update() refuses one without),
          // so a story created public gets one: the writer's, or "allowed".
          allowForks:
            dto.visibility === Visibility.PUBLIC ? (dto.allowForks ?? true) : null,
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

  /** `mine` switches from the public shelf to the caller's own workspace. */
  async list(mine = false) {
    // The shelf is public and must work signed out; a workspace belongs to
    // somebody, so asking for one without an account is a 401, not an empty
    // list - "you own nothing" and "you are nobody" are different answers.
    const viewer = mine
      ? await this.currentUser.current()
      : await this.currentUser.optional();

    return this.prisma.story.findMany({
      where: this.listVisibility(viewer, mine),
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { handle: true, displayName: true } },
        branches: {
          where: { isRoot: true },
          select: { id: true },
          take: 1,
        },
      },
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
    await this.assertReadable(story, viewer);

    // Drafts are working copies. Listing them would announce that a revision
    // is under way and hand out the id needed to read it.
    const canSeeDrafts =
      viewer?.id === story.ownerId || viewer?.role === Role.ADMIN;

    return {
      ...story,
      branches: canSeeDrafts
        ? story.branches
        : story.branches.filter((b) => !b.isDraft),
      // How many other people have forked it. Non-zero on a public story
      // means its chapters are locked and it can no longer be taken down.
      forkedByOthers: await this.forkedByOthers(story),
    };
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

    // Taking a public story down once others have forked it would take their
    // branches with it: a private story is unreadable to anyone but its
    // owner, so every fork of it would turn into a 404 for its own writer.
    if (
      dto.visibility !== undefined &&
      dto.visibility !== story.visibility &&
      story.visibility === Visibility.PUBLIC &&
      (await this.forkedByOthers(story)) > 0
    ) {
      throw new ConflictException({
        code: 'STORY_FORKED',
        message:
          'Đã có người đọc rẽ nhánh từ truyện này, nên không gỡ được nữa: gỡ đi thì nhánh của họ cũng mất chỗ dựa.',
      });
    }

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

    const updated = await this.prisma.story.update({
      where: { id },
      data: dto,
    });

    // Only the transition, not every edit to an already-public story. Going
    // public is what creates an audience, and an audience is what makes
    // pre-rendered narration worth paying for.
    if (
      story.visibility === Visibility.PRIVATE &&
      updated.visibility !== Visibility.PRIVATE
    ) {
      this.events.emit('story.published', { storyId: updated.id });
    }
    if (story.visibility === Visibility.PUBLIC || updated.visibility === Visibility.PUBLIC) {
      this.events.emit('story.changed', { storyId: updated.id });
    }

    return updated;
  }

  /**
   * Deletes a story and everything under it. The cascade rules on branches,
   * contributions, scenes and unlocks do the rest.
   */
  async remove(id: string) {
    const { story } = await this.ownedStory(id);
    // Deleting would cascade into other people's branches.
    if ((await this.forkedByOthers(story)) > 0) {
      throw new ConflictException({
        code: 'STORY_FORKED',
        message:
          'Đã có người đọc rẽ nhánh từ truyện này, nên không xoá được: xoá truyện sẽ xoá luôn nhánh của họ.',
      });
    }
    await this.prisma.story.delete({ where: { id } });
    if (story.visibility === Visibility.PUBLIC) this.events.emit('story.changed', { storyId: id });
    return { deleted: true, id };
  }

  /**
   * Counts one read per reader per story per half hour.
   *
   * Every chapter opened calls this, so without the window one reader going
   * through a twenty-chapter story was twenty "views", and a refresh loop
   * could put any story at the top of "Phổ biến nhất". The reader is the
   * account when there is one, the network address when there is not.
   */
  async recordView(id: string, ip = 'unknown') {
    // Anonymous reads are most of the audience and must still count.
    const user = await this.currentUser.optional();
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException(`Story ${id} not found`);

    // The author refreshing their own page is not an audience.
    if (user && story.ownerId === user.id) return { viewCount: story.viewCount };

    // Remember that this reader opened the story: rating it requires that.
    // Idempotent, so counting the same reader twice changes nothing here.
    if (user) {
      await this.prisma.storyReader.upsert({
        where: { storyId_userId: { storyId: id, userId: user.id } },
        create: { storyId: id, userId: user.id },
        update: {},
      });
    }

    let counted = true;
    try {
      const who = user ? `u:${user.id}` : `ip:${ip}`;
      counted =
        (await this.redis.client.set(`view:${id}:${who}`, '1', 'EX', VIEW_WINDOW_SECONDS, 'NX')) === 'OK';
    } catch {
      // Redis down: count it. An inflated number beats a frozen one.
    }
    if (!counted) return { viewCount: story.viewCount };

    const updated = await this.prisma.story.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });
    return updated;
  }

  /**
   * Every chapter a branch reads as, own rows plus inherited ancestors.
   *
   * Shared by reading, revising and promoting so the three can never disagree
   * about what a branch actually contains. Takes a transaction client so a
   * revise sees a consistent snapshot.
   */
  private async readableChapters(
    tx: Pick<PrismaService, 'contribution' | 'branch'>,
    branch: Branch,
  ): Promise<Contribution[]> {
    const inherited: Contribution[] = [];
    let cutoff = branch.forkedAtDepth;

    for (const ancestorId of [...branch.lineage].reverse()) {
      if (cutoff === null) break;

      inherited.unshift(
        ...(await tx.contribution.findMany({
          where: { branchId: ancestorId, depth: { lte: cutoff } },
          orderBy: { depth: 'asc' },
        })),
      );

      const ancestor = await tx.branch.findUnique({
        where: { id: ancestorId },
        select: { forkedAtDepth: true },
      });
      cutoff = ancestor?.forkedAtDepth ?? null;
    }

    const own = await tx.contribution.findMany({
      where: { branchId: branch.id },
      orderBy: { depth: 'asc' },
    });

    // A branch overrides its ancestors at any depth it has written itself.
    const ownDepths = new Set(own.map((c) => c.depth));
    return [...inherited.filter((c) => !ownDepths.has(c.depth)), ...own].sort(
      (a, b) => a.depth - b.depth,
    );
  }

  // -------------------------------------------------------------------------
  // Revising a published story
  // -------------------------------------------------------------------------

  /**
   * Whether this branch is the one the story's headline numbers describe.
   *
   * Was `branch.isRoot` everywhere, which stops being true the moment a
   * revision is promoted - the counters would then freeze on a branch nobody
   * reads.
   */
  private isMain(
    story: { mainBranchId: string | null },
    branch: { id: string; isRoot: boolean },
  ): boolean {
    return story.mainBranchId
      ? story.mainBranchId === branch.id
      : branch.isRoot;
  }

  /** The branch readers land on. Null main means the root, for every story
   * that has never been revised. */
  private mainBranchOf(
    story: { mainBranchId: string | null },
    branches: Branch[],
  ): Branch {
    const main = story.mainBranchId
      ? branches.find((b) => b.id === story.mainBranchId)
      : branches.find((b) => b.isRoot);
    if (!main) throw new NotFoundException('Story has no readable branch');
    return main;
  }

  /**
   * An editable copy of the current main branch.
   *
   * Copies the rows rather than inheriting them, which is the opposite of what
   * an ordinary fork does and the whole point here: inheriting would leave the
   * chapters owned by the published branch and therefore still frozen, so
   * fixing a typo in chapter three would mean rewriting chapters three onward.
   * A copy makes every chapter editable at once.
   */
  async revise(storyId: string, dto: ReviseDto = {}) {
    const { story, user } = await this.ownedStory(storyId);

    return this.prisma.$transaction(async (tx) => {
      const branches = await tx.branch.findMany({ where: { storyId } });
      const main = this.mainBranchOf(story, branches);

      const source = await this.readableChapters(tx, main);
      if (source.length === 0) {
        throw new BadRequestException({
          code: 'NOTHING_TO_REVISE',
          message: 'Truyện chưa có chương nào.',
        });
      }

      const copy = await tx.branch.create({
        data: {
          storyId,
          ownerId: user.id,
          name:
            dto.name?.trim() ||
            `bản sửa ${new Date().toISOString().slice(0, 10)}`,
          isRoot: false,
          // Nobody reads it until it is promoted - that is the whole point of
          // revising on a copy rather than in place.
          isDraft: true,
          // No forkedFromBranchId: nothing is inherited, so there is no
          // ancestor to read through and no cutoff to respect.
          lineage: [],
          depth: source.length - 1,
        },
      });

      let parentId: string | null = null;
      for (const [depth, c] of source.entries()) {
        const row: Contribution = await tx.contribution.create({
          data: {
            branchId: copy.id,
            parentId,
            depth,
            title: c.title,
            authorId: c.authorId,
            authorType: c.authorType,
            content: c.content as never,
            textPlain: c.textPlain,
            wordCount: c.wordCount,
            modelProvider: c.modelProvider,
            modelName: c.modelName,
          },
        });
        parentId = row.id;
      }

      await tx.branch.update({
        where: { id: copy.id },
        data: { headContributionId: parentId },
      });
      await tx.story.update({
        where: { id: storyId },
        data: { branchCount: { increment: 1 } },
      });

      return copy;
    });
  }

  /**
   * Removes a branch nobody is reading.
   *
   * Refused for the branch readers land on - that is the published story, and
   * deleting it would leave the story with nothing to show. Refused too when
   * something has forked from it, because a fork reads its ancestors through
   * `lineage`: dropping the row would not free the fork, it would break it.
   */
  async deleteBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    // Branch ownership, not story ownership: a fork belongs to the person who
    // made it, on somebody else's story, and they must be able to take it
    // down again.
    const user = await this.currentUser.current();
    if (branch.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'NOT_BRANCH_OWNER',
        message: 'Chỉ xoá được nhánh của chính bạn.',
      });
    }

    const story = await this.prisma.story.findUniqueOrThrow({
      where: { id: branch.storyId },
    });

    const disposable = await this.assertNobodyBuiltOn(branch.id, user.id);
    const live = this.isMain(story, branch);

    // Being published is not itself a reason to refuse - the writer can take
    // their story down. But the root is the story's floor: removing it would
    // leave nothing for main to fall back to.
    if (live && branch.isRoot) {
      throw new ConflictException({
        code: 'BRANCH_IS_ROOT',
        message:
          'Đây là nhánh gốc của truyện. Xoá cả truyện nếu bạn muốn bỏ hẳn.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Empty branches of the caller's that only existed to read through this
      // one. Removed first, so nothing is left pointing at a deleted ancestor.
      if (disposable.length > 0) {
        await tx.branch.deleteMany({ where: { id: { in: disposable } } });
      }

      // Contributions and audio clips cascade from the branch row.
      await tx.branch.delete({ where: { id: branchId } });

      if (live) {
        // Main falls back to the root, and the headline numbers have to follow
        // it - they described a branch that no longer exists.
        const root = await tx.branch.findFirstOrThrow({
          where: { storyId: branch.storyId, isRoot: true },
        });
        const chapters = await this.readableChapters(tx, root);
        await tx.story.update({
          where: { id: branch.storyId },
          data: {
            mainBranchId: null,
            contributionCount: chapters.length,
            wordCount: chapters.reduce((n, c) => n + c.wordCount, 0),
            branchCount: { decrement: 1 + disposable.length },
          },
        });
      } else {
        await tx.story.update({
          where: { id: branch.storyId },
          data: { branchCount: { decrement: 1 + disposable.length } },
        });
      }

      return { deleted: true, id: branchId, revertedToRoot: live };
    });
  }

  /**
   * Take a branch back to private.
   *
   * The mirror of promoting. For the branch readers are on this takes the
   * whole story private, because a public story whose only readable branch is
   * a draft is not a state anyone should be able to reach - there would be
   * nothing to show and no error to explain it.
   */
  async unpublishBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const user = await this.currentUser.current();
    if (branch.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'NOT_BRANCH_OWNER',
        message: 'Chỉ ẩn được nhánh của chính bạn.',
      });
    }

    // Hiding removes nothing, so an empty branch of your own is left alone -
    // it just has nothing to inherit while this one is private.
    await this.assertNobodyBuiltOn(branch.id, user.id);

    const story = await this.prisma.story.findUniqueOrThrow({
      where: { id: branch.storyId },
    });
    const live = this.isMain(story, branch);

    return this.prisma.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id: branchId },
        data: { isDraft: true },
      });

      if (live) {
        await tx.story.update({
          where: { id: branch.storyId },
          data: { visibility: Visibility.PRIVATE },
        });
      }

      return { unpublished: true, id: branchId, storyWentPrivate: live };
    });
  }

  /**
   * The one thing that takes a branch out of its owner's hands.
   *
   * A fork reads its ancestors through `lineage`, so hiding or deleting a
   * branch somebody forked from does not release it - it breaks their story.
   * Nothing else is a reason to refuse: being published is a decision the
   * writer is allowed to reverse.
   */
  private async assertNobodyBuiltOn(
    branchId: string,
    userId: string,
  ): Promise<string[]> {
    const children = await this.prisma.branch.findMany({
      where: { lineage: { has: branchId } },
      select: {
        id: true,
        name: true,
        ownerId: true,
        _count: { select: { contributions: true } },
      },
    });

    // An empty branch of your own is not work, it is scaffolding - usually a
    // fork someone opened, looked at and never wrote in. Refusing on account
    // of one protects nothing and leaves the writer stuck behind a branch they
    // do not remember making. It goes with the parent instead.
    const disposable = children.filter(
      (c) => c.ownerId === userId && c._count.contributions === 0,
    );
    const blocking = children.filter((c) => !disposable.includes(c));

    if (blocking.length > 0) {
      const names = blocking.map((c) => `“${c.name}”`).join(', ');
      throw new ConflictException({
        code: 'BRANCH_HAS_FORKS',
        message: `${names} đọc truyện qua nhánh này, nên nó phải giữ nguyên. Hãy xoá nhánh đó trước nếu nó là của bạn.`,
      });
    }

    return disposable.map((c) => c.id);
  }

  /**
   * Make a branch the version readers get.
   *
   * The branch it replaces is left alone rather than deleted - it is what
   * anyone who forked from it still reads through, and it is the only record
   * of what the story said before.
   */
  async promote(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const { user } = await this.ownedStory(branch.storyId);
    if (branch.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'NOT_BRANCH_OWNER',
        message: 'Chỉ dùng được nhánh của chính bạn làm bản chính.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const chapters = await this.readableChapters(tx, branch);

      // The headline numbers describe what readers see, so they follow the
      // main branch rather than the root.
      // No longer a working copy: this is the version people read.
      if (branch.isDraft) {
        await tx.branch.update({
          where: { id: branch.id },
          data: { isDraft: false },
        });
      }

      await tx.story.update({
        where: { id: branch.storyId },
        data: {
          mainBranchId: branch.id,
          contributionCount: chapters.length,
          wordCount: chapters.reduce((n, c) => n + c.wordCount, 0),
        },
      });

      return { promoted: true, branchId: branch.id };
    });
  }

  // -------------------------------------------------------------------------
  // Editing a chapter
  //
  // Contributions are immutable because forks inherit them by reference - a
  // fork copies no rows. Rewriting a chapter someone has already built on
  // would change their story underneath them, and removing one would leave a
  // hole in the depth sequence that `@@unique([branchId, depth])` and the
  // parent chain both depend on.
  //
  // That is a reason to refuse when somebody depends on it, not a reason to
  // refuse always. A writer fixing a typo in a chapter nobody has touched is
  // the common case, and the model should not be the thing that stops them.
  // -------------------------------------------------------------------------

  /**
   * Loads a chapter and proves it is safe to change.
   *
   * Only direct children need checking: a grandchild's slice of this branch is
   * bounded by its parent's `forkedAtDepth`, and that parent is a direct child.
   */
  private async editableChapter(id: string) {
    const user = await this.currentUser.current();

    const chapter = await this.prisma.contribution.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);

    if (chapter.branch.ownerId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'NOT_OWNER',
        message: 'Chỉ chủ sở hữu nhánh mới sửa được chương này.',
      });
    }

    // A published story locks once someone else has forked it - not before.
    //
    // It used to lock the moment it was published, which made fixing a typo
    // in chapter 2 a revise-and-promote ritual even when nobody but its writer
    // had ever built on it. What actually needs protecting is other people's
    // work: a fork reads its ancestors' chapters, so changing one changes the
    // story someone else is writing on top of. Until that exists, the story
    // is its writer's to edit. Afterwards `revise` is still the way.
    const story = await this.prisma.story.findUniqueOrThrow({
      where: { id: chapter.branch.storyId },
    });
    if (
      this.isMain(story, chapter.branch) &&
      story.visibility !== Visibility.PRIVATE &&
      (await this.forkedByOthers(story)) > 0
    ) {
      throw new ConflictException({
        code: 'STORY_FORKED',
        message:
          'Đã có người đọc rẽ nhánh từ truyện này, nên chương không sửa hay xoá trực tiếp được nữa: nhánh của họ đang dựa vào nó. Hãy tạo bản sửa nếu cần.',
      });
    }

    const dependent = await this.prisma.branch.findFirst({
      where: {
        forkedFromBranchId: chapter.branchId,
        forkedAtDepth: { gte: chapter.depth },
      },
      select: { id: true },
    });
    if (dependent) {
      throw new ConflictException({
        code: 'CHAPTER_INHERITED',
        message:
          'Đã có người rẽ nhánh từ chương này, nên không sửa được nữa. Hãy viết một chương mới để chỉnh lại.',
      });
    }

    return { chapter, branch: chapter.branch };
  }

  async editChapter(id: string, dto: EditContributionDto) {
    const { chapter, branch } = await this.editableChapter(id);
    const words = countWords(dto.textPlain ?? chapter.textPlain);
    const delta = words - chapter.wordCount;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contribution.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.textPlain !== undefined
            ? {
                textPlain: dto.textPlain,
                content: (dto.content ?? { type: 'doc', text: dto.textPlain }) as never,
                wordCount: words,
              }
            : {}),
        },
      });

      // Narration read the old text, so it is now wrong. Deleting the clips
      // makes the next play regenerate rather than quietly playing a version
      // of the chapter that no longer exists.
      if (dto.textPlain !== undefined) {
        await tx.audioClip.deleteMany({ where: { contributionId: id } });
      }

      const story = await tx.story.findUniqueOrThrow({
        where: { id: branch.storyId },
      });
      if (this.isMain(story, branch) && delta !== 0) {
        await tx.story.update({
          where: { id: branch.storyId },
          data: { wordCount: { increment: delta } },
        });
      }
      return updated;
    });
  }

  /**
   * Removes the last chapter of a branch.
   *
   * The tip only. Deleting from the middle would renumber everything after it,
   * which breaks forks pointing at those depths, audio clips keyed by depth,
   * and the parent chain - for a convenience that "delete twice" already
   * covers.
   */
  async deleteChapter(id: string) {
    const { chapter, branch } = await this.editableChapter(id);

    if (chapter.depth !== branch.depth || branch.headContributionId !== id) {
      throw new ConflictException({
        code: 'NOT_LAST_CHAPTER',
        message: 'Chỉ xoá được chương cuối cùng.',
      });
    }

    // The only chapter a fork has of its own: removing it removes the fork.
    //
    // A fork and its first chapter are created as one act precisely so that
    // empty branches never exist - but deleting that chapter used to leave
    // one behind anyway: a branch with no chapters of its own, still listed
    // in the switcher, on the shelf and under the chapter it split from, and
    // leading to a chapter that no longer existed. Someone who pressed "Xoá"
    // on it reasonably believed the branch was gone. Delegating to
    // deleteBranch keeps its rules: owner only, refused if someone has built
    // on it, and the story's counters corrected.
    if (!branch.isRoot && chapter.parentId === null) {
      await this.deleteBranch(branch.id);
      return { deleted: true, id, branchDeleted: true, branchId: branch.id };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.contribution.delete({ where: { id } });

      await tx.branch.update({
        where: { id: branch.id },
        data: {
          headContributionId: chapter.parentId,
          // Back to the fork point when the branch is empty again, so the next
          // commit resumes where it did before anything was written.
          depth: chapter.parentId
            ? chapter.depth - 1
            : (branch.forkedAtDepth ?? 0),
        },
      });

      const story = await tx.story.findUniqueOrThrow({
        where: { id: branch.storyId },
      });
      if (this.isMain(story, branch)) {
        await tx.story.update({
          where: { id: branch.storyId },
          data: {
            contributionCount: { decrement: 1 },
            wordCount: { decrement: chapter.wordCount },
          },
        });
      }

      return { deleted: true, id };
    });
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

    // Reading is the public surface: no token required. Signed out you get
    // the free chapters, same as a signed-in stranger who has not unlocked it.
    const user = await this.currentUser.optional();
    await this.assertReadable(branch.story, user);

    // A draft is the author's working copy. 404 rather than 403: confirming
    // it exists would tell anyone listing branches that a revision is under
    // way, which is the author's business.
    if (
      branch.isDraft &&
      branch.ownerId !== user?.id &&
      user?.role !== Role.ADMIN
    ) {
      throw new NotFoundException(`Branch ${branchId} not found`);
    }

    const access = await this.paywall.access(branch.story, user?.id ?? null);
    const maxDepth = await this.paywall.readableDepth(
      branch.story,
      user?.id ?? null,
    );

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

    const contribution = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

      // A chapter goes onto a branch only from the person who owns it.
      //
      // This check did not exist. Any signed-in account could POST a chapter
      // onto anyone's branch - including a published story's main line, which
      // its own author is not allowed to edit directly - and the draft room
      // reached the same hole by passing a collaborator straight through. It
      // surfaced when an invited writer's test chapter appeared in someone
      // else's published story as if the author had written it.
      //
      // Other people's writing has a route: a fork, which is theirs, under
      // their name. That is what `commitForCollaborator` below does.
      if (!this.canCommitTo(branch, user)) {
        throw new ForbiddenException({
          code: 'NOT_BRANCH_OWNER',
          message:
            'Chỉ chủ nhánh mới đăng chương vào nhánh này. Hãy rẽ nhánh để viết theo hướng của bạn.',
        });
      }

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
          title: dto.title?.trim() || null,
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
      const story = await tx.story.findUniqueOrThrow({
        where: { id: branch.storyId },
      });

      if (this.isMain(story, branch)) {
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

    // Announced, not awaited. Indexing a chapter costs an embedding round trip,
    // and a writer pressing "đăng chương" should not wait on the retrieval
    // index any more than they wait on narration.
    this.events.emit('chapter.committed', {
      contributionId: contribution.id,
      branchId,
    });

    return contribution;
  }

  async fork(
    branchId: string,
    dto: ForkBranchDto,
    opts: {
      /**
       * The author invited this person into the branch's draft room. That is
       * a more specific grant than the public "allow forks" switch and the
       * paywall, both of which are about strangers - so neither stops someone
       * the author asked to write with them.
       */
      invited?: boolean;
    } = {},
  ): Promise<Branch> {
    const user = await this.currentUser.current();

    const branch = await this.prisma.$transaction(async (tx) => {
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
      if (
        !opts.invited &&
        story.allowForks !== true &&
        story.ownerId !== user.id
      ) {
        throw new ForbiddenException({
          code: 'FORKS_DISABLED',
          message: 'Tác giả đã tắt tính năng rẽ nhánh cho truyện này.',
        });
      }

      await this.assertReadable(story, user);

      const maxDepth = opts.invited
        ? Number.POSITIVE_INFINITY
        : await this.paywall.readableDepth(story, user.id);
      if (dto.atDepth > maxDepth) {
        throw new ForbiddenException({
          code: 'LOCKED_CHAPTERS',
          message: 'Mở khoá truyện trước khi rẽ nhánh từ chương này.',
          unlockPrice: story.unlockPrice,
        });
      }

      const created = await tx.branch.create({
        data: {
          storyId: parent.storyId,
          ownerId: user.id,
          name: dto.name?.trim() || `fork-${Date.now().toString(36)}`,
          forkedFromBranchId: parent.id,
          forkedAtDepth: dto.atDepth,
          // Ancestors of the parent, plus the parent itself. Root first.
          lineage: [...parent.lineage, parent.id],
          depth: dto.atDepth,
        },
      });

      // The branch and its first chapter are one act. Writing them separately
      // is what used to leave empty branches behind whenever the second half
      // never happened.
      const first = await tx.contribution.create({
        data: {
          branchId: created.id,
          parentId: null,
          depth: dto.atDepth + 1,
          title: dto.title,
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
        where: { id: created.id },
        data: { headContributionId: first.id, depth: first.depth },
      });

      await tx.story.update({
        where: { id: parent.storyId },
        data: { branchCount: { increment: 1 }, updatedAt: new Date() },
      });

      return { ...created, headContributionId: first.id, depth: first.depth };
    });

    // A fork's first chapter is a committed chapter like any other, and has
    // to be announced like one. It was not: the event lived only in
    // `commit()`, so every fork's opening chapter was never indexed for
    // retrieval - the AI continuing a branch could not see how it began.
    this.events.emit('chapter.committed', {
      contributionId: branch.headContributionId!,
      branchId: branch.id,
    });

    return branch;
  }

  /**
   * Branches this person wrote in other people's stories.
   *
   * The shelf listed only stories you own, so someone who had written two
   * whole branches of somebody else's story opened "Truyện của tôi" to be told
   * they had written nothing. A branch is the main thing a reader-turned-writer
   * makes here; it belongs on their shelf.
   *
   * A private story's branches are listed only while the person still has a
   * way in - an invitation - since otherwise the link would lead to a 404.
   */
  async myBranches() {
    const user = await this.currentUser.current();
    return this.prisma.branch.findMany({
      where: {
        ownerId: user.id,
        isRoot: false,
        // Nothing of their own on it, nothing to list.
        contributions: { some: {} },
        story: {
          ownerId: { not: user.id },
          OR: [
            { visibility: { not: Visibility.PRIVATE } },
            { branches: { some: { collaborators: { some: { userId: user.id } } } } },
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        depth: true,
        forkedAtDepth: true,
        updatedAt: true,
        _count: { select: { contributions: true } },
        story: {
          select: {
            id: true,
            title: true,
            coverUrl: true,
            genres: true,
            owner: { select: { handle: true, displayName: true } },
          },
        },
      },
    });
  }

  /**
   * Branches of this story written by someone other than its author.
   *
   * The one question behind every "can the author still change this?" rule:
   * once another reader has forked the story and written on it, its chapters
   * are the ground their branch stands on. Empty branches and the author's
   * own revisions do not count - neither is anybody else's work.
   */
  private forkedByOthers(story: { id: string; ownerId: string }) {
    return this.prisma.branch.count({
      where: {
        storyId: story.id,
        isRoot: false,
        isDraft: false,
        ownerId: { not: story.ownerId },
        contributions: { some: {} },
      },
    });
  }

  /**
   * Who may add a chapter straight onto a branch: its owner, or an admin.
   *
   * Kept as one predicate because the draft room has to make the same call
   * before it decides where a chapter goes, and two copies of a permission
   * rule drift until they disagree.
   */
  canCommitTo(
    branch: { ownerId: string },
    user: { id: string; role: Role },
  ): boolean {
    return branch.ownerId === user.id || user.role === Role.ADMIN;
  }

  /**
   * A chapter written in someone else's room, by someone they invited.
   *
   * It does not go onto their branch: it goes onto a branch of the writer's
   * own, split from the room's branch at its current last chapter and named
   * after them - so the author's story is untouched, and the new chapter
   * shows up as "@handle's version" rather than as the author's next chapter.
   *
   * Repeat commits from the same person while the author has not moved on
   * continue that same branch instead of sprouting a sibling each time.
   */
  async commitForCollaborator(
    parentBranchId: string,
    dto: CommitContributionDto,
  ): Promise<CollaboratorCommit> {
    const user = await this.currentUser.current();
    const parent = await this.prisma.branch.findUnique({
      where: { id: parentBranchId },
    });
    if (!parent) {
      throw new NotFoundException(`Branch ${parentBranchId} not found`);
    }

    // A split needs something to split from. On a story with no chapters yet
    // there is no shared history to keep, and inventing an empty fork point
    // would leave a branch that inherits nothing from a story that has
    // nothing - so the author goes first.
    if (!parent.headContributionId) {
      throw new BadRequestException({
        code: 'NOTHING_TO_BRANCH_FROM',
        message:
          'Truyện chưa có chương nào. Chủ truyện cần đăng chương đầu tiên trước.',
      });
    }

    const existing = await this.prisma.branch.findFirst({
      where: {
        ownerId: user.id,
        forkedFromBranchId: parent.id,
        forkedAtDepth: parent.depth,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const c = await this.commit(existing.id, dto);
      return { contributionId: c.id, branchId: existing.id, created: false };
    }

    const branch = await this.fork(
      parent.id,
      {
        atDepth: parent.depth,
        name: `@${user.handle}`,
        title: dto.title,
        content: dto.content,
        textPlain: dto.textPlain,
        authorType: dto.authorType,
        modelProvider: dto.modelProvider,
        modelName: dto.modelName,
      } as ForkBranchDto,
      { invited: true },
    );

    return {
      contributionId: branch.headContributionId!,
      branchId: branch.id,
      created: true,
    };
  }
}

export type CollaboratorCommit = {
  contributionId: string;
  /** Where the chapter actually landed - the collaborator's own branch. */
  branchId: string;
  /** True when this commit created that branch. */
  created: boolean;
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
