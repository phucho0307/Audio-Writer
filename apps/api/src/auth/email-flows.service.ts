import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { actionMail, MailService, mask } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { normaliseEmail } from './auth.service';
import { TokenService } from './token.service';

type Purpose = 'verify' | 'reset';

const TTL: Record<Purpose, number> = {
  verify: 24 * 3600,
  // Short: a reset link sitting in an inbox is a key to the account.
  reset: 60 * 60,
};
/** Emails of one kind to one address per hour. Stops the form being used to spam someone. */
const SENDS_PER_HOUR = 3;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * The two flows that prove someone reads an inbox: verifying a new email
 * sign-up, and resetting a forgotten password.
 *
 * Links carry a random 256-bit token. Only its SHA-256 is stored, in Redis
 * with an expiry, so a leaked Redis dump opens nothing and a stale link dies
 * on its own. Tokens are single-use (GETDEL), and asking for a new link
 * retires the previous one.
 */
/**
 * Every mail opens the same way, never with the account's display name. Anyone
 * can sign up with a stranger's address, and the name is whatever they typed:
 * "Chào <name>" turned a sign-up into a way to send any sentence, from the
 * site's own domain, to any inbox.
 */
const GREETING = 'Chào bạn,';

@Injectable()
export class EmailFlowsService {
  private readonly logger = new Logger(EmailFlowsService.name);
  private readonly web: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
  ) {
    this.web = config.get<string>('WEB_ORIGIN', 'http://localhost:3000').replace(/\/$/, '');
  }

  // --------------------------------------------------------------- tokens

  private async mint(purpose: Purpose, userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha(token);
    const last = `emailtok:last:${purpose}:${userId}`;
    const previous = await this.redis.client.get(last);
    const tx = this.redis.client.multi();
    if (previous) tx.del(`emailtok:${purpose}:${previous}`);
    tx.set(`emailtok:${purpose}:${hash}`, userId, 'EX', TTL[purpose]);
    tx.set(last, hash, 'EX', TTL[purpose]);
    await tx.exec();
    return token;
  }

  /** The user the token was for, once; null if unknown, used or expired. */
  private async redeem(purpose: Purpose, token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const userId = await this.redis.client.getdel(`emailtok:${purpose}:${sha(token)}`);
    if (userId) await this.redis.client.del(`emailtok:last:${purpose}:${userId}`);
    return userId;
  }

  /** False when this address has had enough of these for the hour. */
  private async underSendLimit(purpose: Purpose, email: string): Promise<boolean> {
    const n = await this.redis.incrementWindow(`mailsend:${purpose}:${email}`, 3600);
    return n <= SENDS_PER_HOUR;
  }

  // --------------------------------------------------------- verification

  /** After an email sign-up, and on "gửi lại". Does nothing for a verified address. */
  async sendVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt) return;
    if (!(await this.underSendLimit('verify', user.email))) {
      throw new HttpException(
        { code: 'MAIL_LIMIT', message: 'Đã gửi vài email trong giờ qua. Kiểm tra hộp thư (cả mục Spam) hoặc thử lại sau.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const token = await this.mint('verify', user.id);
    await this.mail.send(
      actionMail({
        to: user.email,
        subject: 'Xác minh email cho Nhịp Bút',
        greeting: GREETING,
        body: 'Bấm nút dưới đây để xác nhận đây là email của bạn. Liên kết có hiệu lực trong 24 giờ.',
        button: 'Xác minh email',
        url: `${this.web}/xac-minh?token=${token}`,
        footnote: 'Nếu bạn không tạo tài khoản Nhịp Bút, cứ bỏ qua email này.',
      }),
    );
  }

  async verify(token: string): Promise<{ email: string }> {
    const userId = await this.redeem('verify', token);
    if (!userId) {
      throw new BadRequestException({
        code: 'LINK_INVALID',
        message: 'Liên kết đã hết hạn hoặc đã được dùng. Đăng nhập rồi bấm "Gửi lại email xác minh".',
      });
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
      select: { email: true },
    });
    return user;
  }

  // ---------------------------------------------------------------- reset

  /**
   * "Quên mật khẩu". Always answers the same, whether or not the address has
   * an account - otherwise the form tells anyone which emails are registered.
   * A Google-only account may use it too: it is how such an account gets a
   * password, and it proves the inbox just as well.
   */
  async forgot(rawEmail: string): Promise<void> {
    const email = normaliseEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    if (!(await this.underSendLimit('reset', email))) {
      this.logger.warn(`reset mail limit reached for ${mask(email)}`);
      return;
    }
    const token = await this.mint('reset', user.id);
    await this.mail.send(
      actionMail({
        to: user.email,
        subject: 'Đặt lại mật khẩu Nhịp Bút',
        greeting: GREETING,
        body: 'Có người (hy vọng là bạn) vừa yêu cầu đặt lại mật khẩu. Bấm nút dưới đây để chọn mật khẩu mới. Liên kết có hiệu lực trong 1 giờ và chỉ dùng được một lần.',
        button: 'Đặt mật khẩu mới',
        url: `${this.web}/dat-lai-mat-khau?token=${token}`,
        footnote: 'Nếu không phải bạn yêu cầu, cứ bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên.',
      }),
    );
  }

  /**
   * Set the new password and sign out everywhere: whoever knew the old one
   * - possibly the reason for the reset - loses their sessions too. Opening
   * the link proved the inbox, so the address counts as verified.
   */
  async reset(token: string, password: string): Promise<User> {
    const userId = await this.redeem('reset', token);
    if (!userId) {
      throw new BadRequestException({
        code: 'LINK_INVALID',
        message: 'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu đặt lại mật khẩu lần nữa.',
      });
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    await this.tokens.revokeAllFor(user.id);
    return user;
  }
}
