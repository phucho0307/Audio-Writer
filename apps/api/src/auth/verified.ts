import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Whether things that cost money or reach other people (AI turns, comments)
 * are held back until an email sign-up has clicked its link.
 *
 * On in production: without it a script can register accounts by the
 * thousand, each with its own free AI allowance, and drain the shared quota
 * in an afternoon. Off elsewhere, so a laptop with no mail provider still
 * runs every feature. REQUIRE_VERIFIED_EMAIL overrides either way.
 */
export function requiresVerifiedEmail(config: ConfigService): boolean {
  const v = config.get<string>('REQUIRE_VERIFIED_EMAIL');
  if (v !== undefined && v !== '') return v.toLowerCase() === 'true';
  return config.get<string>('NODE_ENV') === 'production';
}

export function emailUnverified(): ForbiddenException {
  return new ForbiddenException({
    code: 'EMAIL_UNVERIFIED',
    message: 'Hãy xác minh email trước. Mở thư Nhịp Bút đã gửi, hoặc bấm "Gửi lại email" ở đầu trang.',
  });
}
