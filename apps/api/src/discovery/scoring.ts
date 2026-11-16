/**
 * The arithmetic of AI search, kept free of I/O so it can be tested alone.
 *
 * Two ranked lists (by meaning, by words) are fused with reciprocal-rank
 * fusion, then nudged by what the reader asked for. Each nudge is worth a
 * few places in one list, never the whole answer: what the story is about
 * stays the main thing.
 */

export const RRF_K = 60;
export const RATING_PRIOR = 10;

export const BOOST = {
  genre: 0.006,
  mood: 0.003,
  ending: 0.006,
  rating: 0.002,
  reads: 0.0008,
} as const;

/**
 * Reciprocal-rank fusion: 1 / (k + rank) summed over lists. Agreement between
 * the lists beats a high place in one, and the raw scores of the two searches
 * (cosine distance, ts_rank) never have to be put on one scale.
 */
export function fuseRanks(lists: { id: string }[][], k = RRF_K): Map<string, number> {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((r, i) => score.set(r.id, (score.get(r.id) ?? 0) + 1 / (k + i + 1)));
  }
  return score;
}

export interface Wanted {
  genres: string[];
  moods: string[];
  /** HE, SE, OE, or ANY. */
  ending: string;
}

export interface Candidate {
  genres: string[];
  viewCount: number;
  ratingCount: number;
  ratingSum: number;
  card: { moods: string[]; ending: string } | null;
}

/** The fused score plus the nudges for genre, mood, ending, rating and reads. */
export function boosted(base: number, s: Candidate, want: Wanted, meanRating: number): number {
  let b = base;
  const genres = new Set(want.genres.map((g) => g.toLowerCase()));
  if (s.genres.some((g) => genres.has(g.toLowerCase()))) b += BOOST.genre;
  b += BOOST.mood * (s.card?.moods.filter((m) => want.moods.includes(m)).length ?? 0);
  if (want.ending !== 'ANY' && s.card) {
    if (s.card.ending === want.ending) b += BOOST.ending;
    // A known, different ending is a mismatch; an unknown one is not.
    else if (s.card.ending !== 'UNKNOWN') b -= BOOST.ending;
  }
  const bayes = (s.ratingSum + RATING_PRIOR * meanRating) / (s.ratingCount + RATING_PRIOR);
  b += BOOST.rating * (bayes - meanRating);
  b += BOOST.reads * Math.log10(1 + s.viewCount);
  return b;
}
