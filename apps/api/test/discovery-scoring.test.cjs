// AI search ranking: reciprocal-rank fusion and the request-driven nudges.
//
//   npx tsx --test test/discovery-scoring.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fuseRanks, boosted, BOOST, RRF_K } = require('../src/discovery/scoring');

const ids = (...xs) => xs.map((id) => ({ id }));
const story = (over = {}) => ({
  genres: [], viewCount: 0, ratingCount: 0, ratingSum: 0,
  card: { moods: [], ending: 'UNKNOWN' }, ...over,
});
const any = { genres: [], moods: [], ending: 'ANY' };

test('a story both searches found beats one found first by only one', () => {
  const s = fuseRanks([ids('a', 'b', 'c'), ids('c', 'x', 'y')]);
  assert.ok(s.get('c') > s.get('a'), 'found by both, even at rank 3 and 1, wins');
  assert.equal(s.get('a'), 1 / (RRF_K + 1));
});

test('fusion with one empty list keeps the other list in order', () => {
  const s = fuseRanks([[], ids('a', 'b')]);
  assert.ok(s.get('a') > s.get('b'));
  assert.equal(s.size, 2);
});

test('the asked-for ending lifts a story, a different known ending sinks it, unknown is neutral', () => {
  const want = { ...any, ending: 'HE' };
  const he = boosted(0, story({ card: { moods: [], ending: 'HE' } }), want, 4);
  const se = boosted(0, story({ card: { moods: [], ending: 'SE' } }), want, 4);
  const unk = boosted(0, story(), want, 4);
  assert.ok(he > unk && unk > se);
  assert.ok(Math.abs(he - unk - BOOST.ending) < 1e-12);
});

test('genre matches ignore case; each matching mood counts', () => {
  const want = { genres: ['ngôn tình'], moods: ['buồn', 'ngược'], ending: 'ANY' };
  const base = boosted(0, story(), want, 4);
  const g = boosted(0, story({ genres: ['Ngôn tình'] }), want, 4);
  const m2 = boosted(0, story({ card: { moods: ['buồn', 'ngược'], ending: 'UNKNOWN' } }), want, 4);
  assert.ok(Math.abs(g - base - BOOST.genre) < 1e-12);
  assert.ok(Math.abs(m2 - base - 2 * BOOST.mood) < 1e-12);
});

test('one nudge is worth a few places, not the whole answer', () => {
  // A genre match plus heavy reads on the 10th story of one list ...
  const want = { genres: ['x'], moods: [], ending: 'ANY' };
  const nudged = boosted(1 / (RRF_K + 10), story({ genres: ['x'], viewCount: 10_000 }), want, 4);
  // ... still loses to a story both searches put first.
  assert.ok(boosted(2 / (RRF_K + 1), story(), want, 4) > nudged);
  // But it does pass the 3rd story of one list.
  assert.ok(nudged > boosted(1 / (RRF_K + 3), story(), want, 4));
});

test('one five-star rating barely moves a story; many do', () => {
  const one = boosted(0, story({ ratingCount: 1, ratingSum: 5 }), any, 4);
  const many = boosted(0, story({ ratingCount: 100, ratingSum: 500 }), any, 4);
  const none = boosted(0, story(), any, 4);
  assert.ok(many > one && one > none);
  assert.ok(one - none < (many - none) / 5);
});
