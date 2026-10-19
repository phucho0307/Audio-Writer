import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
      create: { branchId, userId: invitee.id, role, invitedById: owner.id },
      update: { role },
    });

    return this.list(branchId);
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
