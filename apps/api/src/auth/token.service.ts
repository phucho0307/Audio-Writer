import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type * as jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from './request-context.middleware';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface IssuedTokens {
  accessToken: string;
  /** Raw value for the cookie. Only its hash is stored. */
  refreshToken: string;
  expiresIn: number;
}

/**
 * SHA-256, not argon2.
 *
 * A refresh token is 48 bytes of CSPRNG output, not a human-chosen password -
 * there is nothing to brute-force, so a slow salted hash buys no security. It
 * would also make the token unfindable, because a salted digest cannot be
 * looked up by value. This has to be deterministic to be queryable.
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtl: string;
  private readonly refreshDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshDays = Number(
      this.config.get<string>('JWT_REFRESH_TTL', '30d').replace(/\D/g, '') ||
        30,
    );
  }

  // -------------------------------------------------------------------------

  private signAccess(user: User): string {
    const payload: AccessTokenPayload = { sub: user.id, handle: user.handle };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      // Typed as a template-literal union ("15m", "7d"); ours comes from env
      // as a plain string, and is validated by accessSeconds() below.
      expiresIn: this.accessTtl as jwt.SignOptions['expiresIn'],
    });
  }

  /** Seconds, for the client to schedule its own refresh against. */
  private accessSeconds(): number {
    const m = /^(\d+)([smhd])$/.exec(this.accessTtl);
    if (!m) return 900;
    const n = Number(m[1]);
    return { s: n, m: n * 60, h: n * 3600, d: n * 86400 }[m[2]] ?? 900;
  }

  // -------------------------------------------------------------------------

  /** First sign-in: a fresh session with no ancestor. */
  async issue(user: User, meta: SessionMeta): Promise<IssuedTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: hash(refreshToken),
        userAgent: meta.userAgent?.slice(0, 300),
        ip: meta.ip,
        expiresAt,
      },
    });

    return {
      accessToken: this.signAccess(user),
      refreshToken,
      expiresIn: this.accessSeconds(),
    };
  }

  /**
   * Exchange a refresh token for a new pair, and burn the old one.
   *
   * Each refresh token is valid exactly once. If one is presented that has
   * already been used, two parties hold the same value - which can only mean a
   * copy exists. The whole chain is revoked and both are logged out.
   */
  async rotate(
    rawToken: string,
    meta: SessionMeta,
  ): Promise<{ tokens: IssuedTokens; user: User }> {
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: hash(rawToken) },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH',
        message: 'Phiên đăng nhập không hợp lệ.',
      });
    }

    if (session.revokedAt) {
      this.logger.warn(
        `Refresh token reuse for user ${session.userId} - revoking all sessions`,
      );
      await this.revokeAllFor(session.userId);
      throw new UnauthorizedException({
        code: 'REFRESH_REUSED',
        message: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.',
      });
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: 'REFRESH_EXPIRED',
        message: 'Phiên đăng nhập đã hết hạn.',
      });
    }

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshDays * 24 * 60 * 60 * 1000,
    );

    // Both halves in one transaction: a crash between them would either leave
    // the old token live or the user with no session at all.
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          userId: session.userId,
          refreshHash: hash(refreshToken),
          rotatedFrom: session.id,
          userAgent: meta.userAgent?.slice(0, 300),
          ip: meta.ip,
          expiresAt,
        },
      }),
    ]);

    return {
      tokens: {
        accessToken: this.signAccess(session.user),
        refreshToken,
        expiresIn: this.accessSeconds(),
      },
      user: session.user,
    };
  }

  /** Logout. Unknown tokens are ignored - logging out twice is not an error. */
  async revoke(rawToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { refreshHash: hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllFor(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
