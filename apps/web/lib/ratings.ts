/**
 * Story ratings: real ones, and the demo placeholders.
 *
 * Real ratings come from readers (PUT /stories/:id/rating) and are shown
 * once a story has MIN_RATINGS_SHOWN of them. Until then a story shows no
 * score at all.
 *
 * DEMO MODE ONLY: `placeholder*` below invents numbers so the layout can be
 * judged and demoed with ratings in it. It is on in development and off in
 * production builds (override with NEXT_PUBLIC_DEMO_RATINGS). A star rating
 * nobody gave must never reach a real reader: it is a false claim about the
 * story, and fake reviews are unlawful in many places.
 *
 * Placeholders are deterministic: derived from the id, so a story's number
 * does not jump between reloads or between the list and its own page.
 */

export const MIN_RATINGS_SHOWN = 5;

export const DEMO_RATINGS =
  process.env.NEXT_PUBLIC_DEMO_RATINGS !== undefined
    ? process.env.NEXT_PUBLIC_DEMO_RATINGS === 'true'
    : process.env.NODE_ENV !== 'production';

export type Rating = {
  /** 1.0 - 5.0, one decimal. */
  score: number;
  /** How many people rated. */
  count: number;
};

/** FNV-1a: a stable 32-bit number from any string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tiny seeded generator, so one id yields a fixed sequence of numbers. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A story's rating. Skewed the way real catalogues are: most stories sit
 * between 4.0 and 4.8, and most have a few dozen ratings while a few get
 * into the hundreds. Capped under 500 - a new site with thousands of ratings
 * per story would not be believable.
 */
function placeholderStory(storyId: string): Rating {
  const r = seeded(hash(`story:${storyId}`));
  const score = round1(clamp(3.7 + r() * 1.2, 1, 5));
  // 12 to 492.
  const count = Math.round(12 + Math.pow(r(), 2.2) * 480);
  return { score, count };
}

/** A branch's rating: wider spread than the story's, and far fewer ratings. */
function placeholderBranch(branchId: string): Rating {
  const r = seeded(hash(`branch:${branchId}`));
  const score = round1(clamp(3.3 + r() * 1.6, 1, 5));
  const count = Math.round(4 + Math.pow(r(), 1.6) * 260);
  return { score, count };
}

/**
 * What to show for a story: its real average once enough readers have
 * rated, a placeholder in demo mode, otherwise nothing.
 */
export function storyRating(story: {
  id: string;
  ratingCount?: number;
  ratingSum?: number;
  textSource?: unknown;
}): Rating | null {
  const count = story.ratingCount ?? 0;
  if (count >= MIN_RATINGS_SHOWN) {
    return { score: Math.round(((story.ratingSum ?? 0) / count) * 10) / 10, count };
  }
  // Never invent stars for a real author's published work, even in a demo.
  return DEMO_RATINGS && !story.textSource ? placeholderStory(story.id) : null;
}

/** Branches have no real ratings yet; demo mode only. */
export function branchRating(branchId: string): Rating | null {
  return DEMO_RATINGS ? placeholderBranch(branchId) : null;
}

/** "4,6" - Vietnamese uses a decimal comma. */
export function formatScore(score: number): string {
  return score.toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** "1.284", or "12,4k" once it stops fitting in a cover's corner. */
export function formatCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}k`;
  }
  return count.toLocaleString('vi-VN');
}
