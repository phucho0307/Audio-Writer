/**
 * PLACEHOLDER RATINGS - not real data.
 *
 * There is no rating system yet: no table, no endpoint, nobody has rated
 * anything. These numbers exist so the layout can be designed and judged with
 * ratings in it. Every place in the UI that shows a rating gets it from here,
 * so replacing this file with a call to a real endpoint is the whole job, and
 * nothing else in the app has to change.
 *
 * Must not ship to real readers as-is: a star rating nobody gave is a claim
 * about a story that is not true.
 *
 * Deterministic on purpose. Numbers derived from the id stay the same across
 * reloads and between the list and the detail page; Math.random would make a
 * story's rating jump every time the page was opened, which reads as a bug.
 */

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
 * between 4.0 and 4.8, and a few have thousands of ratings while most have
 * tens or hundreds.
 */
export function storyRating(storyId: string): Rating {
  const r = seeded(hash(`story:${storyId}`));
  const score = round1(clamp(3.7 + r() * 1.2, 1, 5));
  const count = Math.round(40 + Math.pow(r(), 2.2) * 4200);
  return { score, count };
}

/**
 * A chapter's rating: near its story's, because a story's rating is roughly
 * the mood across its chapters, and fewer people rate a chapter than a story -
 * fewer still the further in it is, since readers drop off.
 */
export function chapterRating(storyId: string, chapterId: string, depth: number): Rating {
  const story = storyRating(storyId);
  const r = seeded(hash(`chapter:${chapterId}`));
  const score = round1(clamp(story.score + (r() - 0.5) * 0.8, 1, 5));
  const dropOff = Math.pow(0.86, depth);
  const count = Math.max(3, Math.round(story.count * 0.35 * dropOff * (0.7 + r() * 0.6)));
  return { score, count };
}

/** A branch's rating: wider spread than the story's, and far fewer ratings. */
export function branchRating(branchId: string): Rating {
  const r = seeded(hash(`branch:${branchId}`));
  const score = round1(clamp(3.3 + r() * 1.6, 1, 5));
  const count = Math.round(4 + Math.pow(r(), 1.6) * 260);
  return { score, count };
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
