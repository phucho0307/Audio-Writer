/**
 * Names that would read as the site itself speaking.
 *
 * Once the site is promoted, the first scam is a comment from "Nhịp Bút" or
 * "@admin" with a link in it. Handles and display names are both checked, at
 * every door: sign-up, Google sign-in, and the settings form. These lists used
 * to apply only in the settings form, so signing up as "Admin" got @admin.
 */

/** Exact handles kept back: platform words, and names that collide with routes. */
const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'mod', 'moderator',
  'staff', 'system', 'official', 'nhipbut', 'nhip_but', 'ronbut', 'ron_but', 'audiowriter',
  'api', 'me', 'settings', 'cai_dat', 'login', 'logout', 'null', 'undefined',
]);

/** Whole words that claim authority, after accents are folded away. */
const AUTHORITY_WORDS = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'quantri', 'quantrivien', 'official',
  'support', 'hotro', 'staff',
]);

/** The brand, which may not appear anywhere in a name, joined up or spaced out. */
const BRAND = ['nhipbut', 'audiowriter'];

/** "Nhịp Bút" -> "nhip but"; "Đ" -> "d"; everything else non-alphanumeric is a space. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when a display name or handle would pass for the site or its staff. */
export function looksOfficial(text: string): boolean {
  const words = fold(text).split(' ').filter(Boolean);
  // Digits split off too, so "admin2" and "admin_1" are caught.
  const parts = words.flatMap((w) => w.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/));
  if (parts.some((w) => AUTHORITY_WORDS.has(w))) return true;
  // "Quản trị", "Hỗ trợ" as two words. Pairs, not a substring of the joined
  // name, or a real name like "Hồ Trọng" would read as "hotro…".
  for (let i = 0; i + 1 < words.length; i++) {
    if (AUTHORITY_WORDS.has(words[i] + words[i + 1])) return true;
  }
  const joined = words.join('');
  return BRAND.some((b) => joined.includes(b));
}

/** A handle nobody but the site may hold. */
export function reservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle) || looksOfficial(handle);
}
