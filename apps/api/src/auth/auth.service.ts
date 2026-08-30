import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface GoogleProfile {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
}

/** Vietnamese names carry diacritics that do not belong in a URL handle. */
function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a Google profile to an account, creating one if needed.
   *
   * Three cases, in order: we have seen this Google account before; we have
   * seen this email under a different sign-in method; or this is someone new.
   */
  async fromGoogle(profile: GoogleProfile): Promise<User> {
    // Google marks unverified addresses on some workspace accounts. Treating
    // one as proof of ownership would let someone claim an existing account.
    if (!profile.emailVerified) {
      throw new BadRequestException({
        code: 'EMAIL_UNVERIFIED',
        message: 'Email Google chưa được xác minh.',
      });
    }

    const existing = await this.prisma.user.findUnique({
      where: { googleSub: profile.googleSub },
    });
    if (existing) return existing;

    // Same person, different door: an account already exists on this verified
    // address, so link Google to it rather than creating a duplicate.
    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (byEmail) {
      this.logger.log(`Linking Google to existing account ${byEmail.handle}`);
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: profile.googleSub,
          avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        googleSub: profile.googleSub,
        email: profile.email,
        handle: await this.freeHandle(profile.email, profile.displayName),
        displayName: profile.displayName || profile.email.split('@')[0],
        avatarUrl: profile.avatarUrl,
        locale: 'vi',
      },
    });
  }

  /**
   * A handle nobody is using yet.
   *
   * Prefers the display name, falls back to the email local part, then to a
   * random suffix. `handle` is unique in the schema, so a race between two
   * signups would otherwise fail the insert.
   */
  private async freeHandle(email: string, displayName: string): Promise<string> {
    const base =
      slugify(displayName) || slugify(email.split('@')[0]) || 'nguoi_viet';

    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base}_${i + 1}`;
      const taken = await this.prisma.user.findUnique({
        where: { handle: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }

    return `${base}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
