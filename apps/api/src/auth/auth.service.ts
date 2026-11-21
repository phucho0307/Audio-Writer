import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { looksOfficial, reservedHandle } from '../users/impersonation';

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

/**
 * A display name that does not pass for the site or its staff. Google's name
 * cannot be refused - the person did nothing wrong - so it falls back to the
 * address, then to a plain default.
 */
function safeName(name: string | undefined, email: string): string {
  const local = email.split('@')[0];
  for (const candidate of [name?.trim() ?? '', local]) {
    if (candidate && !looksOfficial(candidate)) return candidate;
  }
  return 'Người đọc';
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
      // Dropping the password is not enough on its own. Whoever registered
      // the unproven address was signed straight in, and that session's
      // refresh token renews itself for as long as it is used - so they
      // would still be inside the real owner's account. End every session
      // the account had before its owner proved the address.
      if (!byEmail.emailVerifiedAt) {
        await this.prisma.session.updateMany({
          where: { userId: byEmail.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: profile.googleSub,
          avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl,
          // An unverified email sign-up could be anyone: someone may have
          // registered this address with a password of their choosing and
          // waited for the real owner to arrive through Google. Google has
          // just proved who owns the address, so a password set before the
          // address was proven is dropped - it cannot be a back door. A
          // verified account keeps its password: its owner set it.
          ...(byEmail.emailVerifiedAt ? {} : { passwordHash: null }),
          emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
        },
      });
    }

    return this.prisma.user.create({
      data: {
        googleSub: profile.googleSub,
        email: profile.email,
        handle: await this.freeHandle(profile.email, profile.displayName),
        displayName: safeName(profile.displayName, profile.email),
        avatarUrl: profile.avatarUrl,
        locale: 'vi',
        emailVerifiedAt: new Date(),
      },
    });
  }

  // -------------------------------------------------------------- password

  /** New account from email and password. */
  async register(input: { email: string; password: string; displayName: string }): Promise<User> {
    const email = normaliseEmail(input.email);
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { passwordHash: true, googleSub: true },
    });
    if (existing) {
      // Sign-up has to say the address is taken - there is nothing else it
      // can usefully do - so it says which door to use.
      throw new ConflictException({
        code: existing.passwordHash ? 'EMAIL_TAKEN' : 'EMAIL_USES_GOOGLE',
        message: existing.passwordHash
          ? 'Email này đã có tài khoản. Hãy đăng nhập.'
          : 'Email này đã đăng ký bằng Google. Hãy bấm "Tiếp tục với Google".',
      });
    }

    if (looksOfficial(input.displayName)) {
      throw new BadRequestException({
        code: 'NAME_RESERVED',
        message: 'Tên này dễ bị nhầm là tài khoản chính thức của Nhịp Bút. Hãy chọn tên khác.',
      });
    }
    const displayName = safeName(input.displayName, email);
    return this.prisma.user.create({
      data: {
        email,
        handle: await this.freeHandle(email, displayName),
        displayName,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        locale: 'vi',
      },
    });
  }

  /**
   * Email and password to an account, or one 401 for every failure.
   *
   * Unknown email, Google-only account and wrong password all answer the same
   * thing, after the same work: a hash is verified even when there is no
   * account, so the response time does not say which emails are registered.
   */
  async login(input: { email: string; password: string }): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: normaliseEmail(input.email) } });
    const hash = user?.passwordHash ?? (await this.dummyHash());
    const ok = await argon2.verify(hash, input.password).catch(() => false);
    if (!user?.passwordHash || !ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }
    return user;
  }

  private dummy?: Promise<string>;
  private dummyHash(): Promise<string> {
    this.dummy ??= argon2.hash('not-a-real-password', { type: argon2.argon2id });
    return this.dummy;
  }

  /**
   * A handle nobody is using yet.
   *
   * Prefers the display name, falls back to the email local part, then to a
   * random suffix. `handle` is unique in the schema, so a race between two
   * signups would otherwise fail the insert.
   */
  private async freeHandle(email: string, displayName: string): Promise<string> {
    // Reserved names are skipped at every step: a sign-up called "Admin" used
    // to be handed @admin, since only the settings form checked the list.
    const usable = (h: string) => (h.length >= 3 && !reservedHandle(h) ? h : '');
    const base =
      usable(slugify(displayName)) || usable(slugify(email.split('@')[0])) || 'nguoi_viet';

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

/** Emails are matched without case; Google sends them lower-cased too. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
