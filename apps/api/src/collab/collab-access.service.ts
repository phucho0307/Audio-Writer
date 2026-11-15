import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CollabRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';

export type DraftRole = 'OWNER' | 'EDITOR' | 'VIEWER';

/**
 * Who may open, type in, or invite to a branch's draft room.
 *
 * Separate from the gateway because the same question is asked over HTTP (the
 * invite endpoints) and over the socket (on connect), and the two must not be
 * allowed to drift apart - a rule enforced in one place and not the other is
 * the usual way a private draft stops being private.
 */
@Injectable()
export class CollabAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** Null when this user may not open the room at all. */
  async roleFor(branchId: string, userId: string): Promise<DraftRole | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { ownerId: true, story: { select: { ownerId: true } } },
    });
    if (!branch) return null;

    // The story's owner can always write in their own story's branches, even
    // ones a collaborator created - otherwise an invited writer could fork off
    // a branch the owner cannot touch.
    if (branch.ownerId === userId || branch.story.ownerId === userId) {
      return 'OWNER';
    }

    const seat = await this.prisma.branchCollaborator.findUnique({
      where: { branchId_userId: { branchId, userId } },
      select: { role: true },
    });
    if (!seat) return null;
    return seat.role === CollabRole.VIEWER ? 'VIEWER' : 'EDITOR';
  }

  /** The signed-in caller's role, or 403. */
  async require(branchId: string, need: 'read' | 'write' | 'own') {
    const user = await this.currentUser.current();
    const role = await this.roleFor(branchId, user.id);
    if (!role) throw new NotFoundException('Draft not found');

    if (need === 'own' && role !== 'OWNER') {
      throw new ForbiddenException('Only the branch owner can do that');
    }
    if (need === 'write' && role === 'VIEWER') {
      throw new ForbiddenException('You can watch this draft but not edit it');
    }
    return { user, role };
  }

  async invite(branchId: string, handle: string, role: CollabRole) {
    const { user: owner } = await this.require(branchId, 'own');

    const invitee = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true, displayName: true, avatarUrl: true },
    });
    if (!invitee) throw new NotFoundException(`Không tìm thấy @${handle}`);
    if (invitee.id === owner.id) {
      throw new ForbiddenException('Bạn đã là chủ nhánh này');
    }

    await this.prisma.branchCollaborator.upsert({
      where: { branchId_userId: { branchId, userId: invitee.id } },
      // An invitation by name is deliberate, so it outranks - and replaces -
      // access that only came through the link.
      create: { branchId, userId: invitee.id, role, invitedById: owner.id, viaLink: false },
      update: { role, viaLink: false },
    });

    return this.list(branchId);
  }

  // ---------------------------------------------------------- link sharing
  //
  // Google Docs' "General access": a room is restricted to the people named,
  // or open to anyone with the link as a viewer or as an editor. Someone who
  // comes in through the link is recorded with `viaLink`, so turning the link
  // off or resetting it takes their access away again - otherwise a link
  // pasted into the wrong chat once would be permanent.

  async share(branchId: string) {
    await this.require(branchId, 'own');
    const b = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { shareToken: true, linkAccess: true },
    });
    return { linkAccess: b.linkAccess, token: b.shareToken };
  }

  async setShare(branchId: string, access: 'NONE' | 'VIEWER' | 'EDITOR') {
    await this.require(branchId, 'own');
    if (access === 'NONE') {
      await this.prisma.$transaction([
        this.prisma.branch.update({ where: { id: branchId }, data: { linkAccess: null } }),
        this.prisma.branchCollaborator.deleteMany({ where: { branchId, viaLink: true } }),
      ]);
    } else {
      const b = await this.prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { shareToken: true },
      });
      await this.prisma.$transaction([
        this.prisma.branch.update({
          where: { id: branchId },
          data: { linkAccess: access, shareToken: b.shareToken ?? newToken() },
        }),
        // People who came in through the link follow the link's level.
        this.prisma.branchCollaborator.updateMany({
          where: { branchId, viaLink: true },
          data: { role: access },
        }),
      ]);
    }
    return this.share(branchId);
  }

  /** A new link. The old one stops working and everyone who used it is out. */
  async resetShare(branchId: string) {
    await this.require(branchId, 'own');
    await this.prisma.$transaction([
      this.prisma.branch.update({ where: { id: branchId }, data: { shareToken: newToken() } }),
      this.prisma.branchCollaborator.deleteMany({ where: { branchId, viaLink: true } }),
    ]);
    return this.share(branchId);
  }

  /** Opening a share link: join the room at the link's level. */
  async joinByLink(token: string) {
    const user = await this.currentUser.current();
    const b = await this.prisma.branch.findUnique({
      where: { shareToken: token },
      select: { id: true, storyId: true, ownerId: true, linkAccess: true },
    });
    // One answer for "no such link" and "link switched off": either way it
    // opens nothing, and saying which would leak that it existed.
    if (!b || !b.linkAccess) {
      throw new NotFoundException('Liên kết này không còn hiệu lực.');
    }
    const result = { storyId: b.storyId, branchId: b.id };
    if (b.ownerId === user.id) return { ...result, role: 'OWNER' as const };

    const existing = await this.prisma.branchCollaborator.findUnique({
      where: { branchId_userId: { branchId: b.id, userId: user.id } },
    });
    // Someone invited by name keeps what they were given; the link never
    // downgrades a deliberate invitation.
    if (existing && !existing.viaLink) return { ...result, role: existing.role };

    await this.prisma.branchCollaborator.upsert({
      where: { branchId_userId: { branchId: b.id, userId: user.id } },
      create: { branchId: b.id, userId: user.id, role: b.linkAccess, viaLink: true },
      update: { role: b.linkAccess, viaLink: true },
    });
    return { ...result, role: b.linkAccess };
  }

  async revoke(branchId: string, userId: string) {
    await this.require(branchId, 'own');
    await this.prisma.branchCollaborator.deleteMany({
      where: { branchId, userId },
    });
    return this.list(branchId);
  }

  async list(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        ownerId: true,
        owner: {
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        },
        collaborators: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                handle: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    return {
      owner: branch.owner,
      collaborators: branch.collaborators.map((c) => ({
        ...c.user,
        role: c.role,
        since: c.createdAt,
      })),
    };
  }
}

/** Unguessable and URL-safe: the link is the only thing that grants access. */
function newToken(): string {
  return randomBytes(18).toString('base64url');
}
