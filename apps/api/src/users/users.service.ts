import { isPremium } from '../premium/premium';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user.service';
import { RedisService } from '../redis/redis.service';
import { AUDIO_STORAGE, StorageFullError, type StorageDriver } from '../storage/storage-driver';

/** Lowercase letters, digits and underscores; what sign-up already produces. */
export const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
export const BIO_MAX = 300;
export const NAME_MAX = 50;
/**
 * The browser crops and shrinks the picture to a small square before sending
 * it, so a real avatar is a few tens of kilobytes. The cap is for anything
 * that skipped that step.
 */
// Under the JSON body limit (100 kB) once base64-encoded.
export const AVATAR_MAX_BYTES = 64 * 1024;
const AVATAR_UPLOADS_PER_DAY = 10;

/** Accepted formats, recognised by their first bytes rather than a label. */
const IMAGE_KINDS: { type: string; ext: string; is: (b: Buffer) => boolean }[] = [
  { type: 'image/webp', ext: 'webp', is: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { type: 'image/jpeg', ext: 'jpg', is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', is: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];

/** Long enough that a handle cannot be passed around to impersonate someone. */
export const HANDLE_COOLDOWN_DAYS = 14;

/**
 * Names that would read as the platform speaking, or collide with routes.
 * Checked after normalising, so `Admin` and `a_d_m_i_n` are not loopholes
 * for the first and are simply allowed for the second.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'mod', 'moderator',
  'staff', 'system', 'official', 'nhipbut', 'nhip_but', 'ronbut', 'ron_but', 'audiowriter',
  'api', 'me', 'settings', 'cai_dat', 'login', 'logout', 'null', 'undefined',
]);

export interface ProfileUpdate {
  displayName?: string;
  handle?: string;
  bio?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    // The one object store the app has. Avatars sit beside the narration
    // under their own prefix; they are public, as narration is.
    @Inject(AUDIO_STORAGE) private readonly storage: StorageDriver,
    private readonly redis: RedisService,
  ) {}

  /** Store a new picture (a data: URL) and make it the avatar. */
  async setAvatar(dataUrl: string) {
    const me = await this.currentUser.current();
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!m) throw new BadRequestException({ code: 'AVATAR_INVALID', message: 'Ảnh không hợp lệ.' });
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > AVATAR_MAX_BYTES) {
      throw new BadRequestException({ code: 'AVATAR_TOO_LARGE', message: 'Ảnh quá lớn.' });
    }
    const kind = IMAGE_KINDS.find((k) => k.is(bytes));
    if (!kind) {
      throw new BadRequestException({ code: 'AVATAR_TYPE', message: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.' });
    }
    // Each new picture is a new object in the storage budget narration shares,
    // and old ones are kept. Six a minute was the only limit: thousands a day.
    const today = await this.redis.incrementWindow(`avatar:uploads:${me.id}`, 24 * 3600).catch(() => 0);
    if (today > AVATAR_UPLOADS_PER_DAY) {
      throw new HttpException(
        { code: 'UPLOAD_LIMIT', message: 'Hôm nay bạn đã đổi ảnh đại diện nhiều lần rồi. Thử lại vào ngày mai nhé.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Content-addressed, so a new picture is a new URL and no cache anywhere
    // keeps showing the old one. No slash: the local driver writes keys flat.
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const key = `avatar-${me.id}-${digest}.${kind.ext}`;
    let stored;
    try {
      stored = await this.storage.put(key, bytes, kind.type);
    } catch (e) {
      if (e instanceof StorageFullError) {
        throw new ServiceUnavailableException({ code: 'STORAGE_FULL', message: 'Kho ảnh đang đầy, tạm thời chưa đổi được ảnh.' });
      }
      throw e;
    }
    const updated = await this.prisma.user.update({
      where: { id: me.id },
      data: { avatarUrl: stored.url },
    });
    return this.view(updated);
  }

  /** Back to initials. */
  async clearAvatar() {
    const me = await this.currentUser.current();
    const updated = await this.prisma.user.update({
      where: { id: me.id },
      data: { avatarUrl: null },
    });
    return this.view(updated);
  }

  /** Why a handle cannot be taken, or null if it can. */
  async handleProblem(handle: string, selfId?: string): Promise<string | null> {
    if (!HANDLE_RE.test(handle)) {
      return 'Username chỉ gồm chữ thường không dấu, số và dấu _, dài 3–24 ký tự.';
    }
    if (RESERVED.has(handle)) return 'Username này đã được giữ lại.';
    const owner = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (owner && owner.id !== selfId) return 'Username này đã có người dùng.';
    return null;
  }

  /** The caller's own settings, including what only they may see. */
  async mine() {
    return this.view(await this.currentUser.current());
  }

  private view(u: {
    id: string;
    handle: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
    handleChangedAt: Date | null;
  }) {
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      handleChangedAt: u.handleChangedAt,
      nextHandleChangeAt: this.nextChange(u.handleChangedAt),
    };
  }

  async update(dto: ProfileUpdate) {
    const me = await this.currentUser.current();
    const data: { displayName?: string; bio?: string | null; handle?: string; handleChangedAt?: Date } = {};

    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim().replace(/\s+/g, ' ');
      if (!name) throw new BadRequestException({ code: 'NAME_EMPTY', message: 'Tên hiển thị không được để trống.' });
      if (name.length > NAME_MAX) {
        throw new BadRequestException({ code: 'NAME_TOO_LONG', message: `Tên hiển thị tối đa ${NAME_MAX} ký tự.` });
      }
      data.displayName = name;
    }

    if (dto.bio !== undefined) {
      // Kept as typed, apart from trimming and capping runs of blank lines.
      const bio = (dto.bio ?? '').trim().replace(/\n{3,}/g, '\n\n');
      if (bio.length > BIO_MAX) {
        throw new BadRequestException({ code: 'BIO_TOO_LONG', message: `Giới thiệu tối đa ${BIO_MAX} ký tự.` });
      }
      data.bio = bio || null;
    }

    if (dto.handle !== undefined) {
      const handle = dto.handle.trim().replace(/^@/, '').toLowerCase();
      if (handle !== me.handle) {
        const next = this.nextChange(me.handleChangedAt);
        if (next && next > new Date()) {
          throw new BadRequestException({
            code: 'HANDLE_COOLDOWN',
            message: `Bạn vừa đổi username. Có thể đổi lại từ ${next.toLocaleDateString('vi-VN')}.`,
          });
        }
        const problem = await this.handleProblem(handle, me.id);
        if (problem) throw new ConflictException({ code: 'HANDLE_UNAVAILABLE', message: problem });
        data.handle = handle;
        data.handleChangedAt = new Date();
      }
    }

    try {
      // The written row, not mine(): the current user is cached for the
      // request and still holds the values from before this update.
      const updated = await this.prisma.user.update({ where: { id: me.id }, data });
      return this.view(updated);
    } catch (e) {
      // Taken between the check and the write.
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'HANDLE_UNAVAILABLE', message: 'Username này đã có người dùng.' });
      }
      throw e;
    }
  }

  /** What anyone may see: no email, and only public stories. */
  async profile(handle: string) {
    const u = await this.prisma.user.findUnique({
      where: { handle: handle.toLowerCase() },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        premiumUntil: true,
        stories: {
          where: { visibility: 'PUBLIC' },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            title: true,
            synopsis: true,
            coverUrl: true,
            genres: true,
            contributionCount: true,
            viewCount: true,
          },
        },
      },
    });
    if (!u) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng này.' });
    // Whether they are premium is public (the badge); until when is not.
    const { id: _id, premiumUntil, ...rest } = u;
    return { ...rest, premium: isPremium({ premiumUntil }) };
  }

  private nextChange(changedAt: Date | null): Date | null {
    if (!changedAt) return null;
    return new Date(changedAt.getTime() + HANDLE_COOLDOWN_DAYS * 86_400_000);
  }
}
