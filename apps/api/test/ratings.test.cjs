// Story ratings: who may rate, and that count/sum on the story stay right
// through rate, re-rate and unrate.
//
//   npx tsx --test test/ratings.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RatingsService, MIN_RATINGS_SHOWN } = require('../src/ratings/ratings.service');

const STORY = 'story-1';

function world({ owner = 'author', reader = 'reader', read = true } = {}) {
  const story = { id: STORY, ownerId: owner, visibility: 'PUBLIC', ratingCount: 0, ratingSum: 0 };
  const ratings = new Map(); // userId -> stars
  const readers = new Set(read ? [reader] : []);
  const key = (w) => w.storyId_userId.userId;
  const prisma = {
    story: {
      findUnique: async () => ({ ...story }),
      update: async ({ data }) => {
        for (const [k, v] of Object.entries(data)) {
          if (v.increment !== undefined) story[k] += v.increment;
          if (v.decrement !== undefined) story[k] -= v.decrement;
        }
      },
    },
    storyRating: {
      findUnique: async ({ where }) => (ratings.has(key(where)) ? { stars: ratings.get(key(where)) } : null),
      upsert: async ({ where, create, update }) => ratings.set(key(where), ratings.has(key(where)) ? update.stars : create.stars),
      delete: async ({ where }) => ratings.delete(key(where)),
    },
    storyReader: {
      findUnique: async ({ where }) => (readers.has(key(where)) ? { storyId: STORY } : null),
    },
  };
  prisma.$transaction = (fn) => fn(prisma);
  let me = { id: reader };
  const currentUser = {
    optional: async () => me,
    current: async () => {
      if (!me) throw new Error('AUTH_REQUIRED');
      return me;
    },
  };
  return {
    svc: new RatingsService(prisma, currentUser),
    story,
    as: (id, role = 'USER') => (me = id ? { id, role } : null),
  };
}

test('a reader who has read the story can rate it, and re-rating replaces', async () => {
  const w = world();
  let r = await w.svc.rate(STORY, 4);
  assert.equal(r.mine, 4);
  assert.deepEqual([w.story.ratingCount, w.story.ratingSum], [1, 4]);
  r = await w.svc.rate(STORY, 2);
  assert.equal(r.mine, 2);
  assert.deepEqual([w.story.ratingCount, w.story.ratingSum], [1, 2], 'same count, sum moved by the difference');
});

test('unrating takes the stars back out', async () => {
  const w = world();
  await w.svc.rate(STORY, 5);
  const r = await w.svc.unrate(STORY);
  assert.equal(r.mine, null);
  assert.deepEqual([w.story.ratingCount, w.story.ratingSum], [0, 0]);
});

test('must have opened a chapter first', async () => {
  const w = world({ read: false });
  await assert.rejects(w.svc.rate(STORY, 5), /Đọc hoặc nghe/);
  assert.equal((await w.svc.summary(STORY)).reason, 'READ_FIRST');
});

test('an author cannot rate their own story', async () => {
  const w = world({ owner: 'reader' });
  await assert.rejects(w.svc.rate(STORY, 5), /của mình/);
  assert.equal((await w.svc.summary(STORY)).reason, 'OWN_STORY');
});

test('signed out sees the sign-in reason', async () => {
  const w = world();
  w.as(null);
  const r = await w.svc.summary(STORY);
  assert.equal(r.reason, 'SIGN_IN');
  assert.equal(r.canRate, false);
});

test('stars outside 1-5 are refused', async () => {
  const w = world();
  for (const bad of [0, 6, 3.5]) await assert.rejects(w.svc.rate(STORY, bad), /1 đến 5/);
});

test(`no average until ${MIN_RATINGS_SHOWN} readers have rated`, async () => {
  const w = world();
  w.story.ratingCount = MIN_RATINGS_SHOWN - 1;
  w.story.ratingSum = 4 * (MIN_RATINGS_SHOWN - 1);
  assert.equal((await w.svc.summary(STORY)).average, null);
  await w.svc.rate(STORY, 5);
  const r = await w.svc.summary(STORY);
  assert.equal(r.count, MIN_RATINGS_SHOWN);
  assert.equal(r.average, 4.2);
});

test('an admin may rate the library it owns, without the read-first rule', async () => {
  const w = world({ owner: 'boss', read: false });
  w.as('boss', 'ADMIN');
  assert.equal((await w.svc.summary(STORY)).canRate, true);
  const r = await w.svc.rate(STORY, 5);
  assert.equal(r.mine, 5);
  assert.deepEqual([w.story.ratingCount, w.story.ratingSum], [1, 5]);
});
