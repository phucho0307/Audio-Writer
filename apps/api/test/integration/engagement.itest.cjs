// Reading progress, follows, comments and related stories against a real
// Postgres - the parts that are SQL (newest-wins upsert, cursor pages,
// pgvector nearest neighbours) and cannot be trusted to a fake.
//
// Needs a throwaway database with the migrations applied. NEVER the live one:
// this file creates and deletes rows.
//
//   ITEST_DATABASE_URL=postgresql://user:pass@localhost:5432/aw_itest \
//     npx tsx --test test/integration/engagement.itest.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const url = process.env.ITEST_DATABASE_URL;
const skip = !url && 'ITEST_DATABASE_URL is not set';
if (url && !/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error('ITEST_DATABASE_URL must be a local throwaway database');
}

const { ProgressService } = require('../../src/reading/progress.service');
const { FollowsService } = require('../../src/reading/follows.service');
const { CommentsService, COMMENT_MAX } = require('../../src/comments/comments.service');
const { RelatedService } = require('../../src/discovery/related.service');

const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;

function fakeRedis() {
  const kv = new Map();
  const counts = new Map();
  return {
    kv,
    counts,
    client: {
      get: async (k) => kv.get(k) ?? null,
      set: async (k, v) => (kv.set(k, v), 'OK'),
    },
    incrementWindow: async (k) => {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k);
    },
  };
}

/** `as(user)` switches who is calling; `as(null)` is a signed-out visitor. */
function session() {
  let me = null;
  return {
    as: (user) => (me = user),
    service: {
      optional: async () => me,
      current: async () => {
        if (!me) throw new Error('AUTH_REQUIRED');
        return me;
      },
    },
  };
}

const config = (values = {}) => ({ get: (key, fallback) => values[key] ?? fallback });
const code = (c) => (e) => e.getResponse?.().code === c;

let author, reader, stranger, admin, story, hidden, chapters;

async function user(name, extra = {}) {
  const id = randomUUID();
  return prisma.user.create({
    data: { id, email: `${name}-${id}@itest.local`, handle: `${name}_${id.slice(0, 8)}`, displayName: name, ...extra },
  });
}

async function storyWith(owner, title, { visibility = 'PUBLIC', genres = [], count = 3, views = 0 } = {}) {
  const s = await prisma.story.create({
    data: { ownerId: owner.id, title, genres, visibility, allowForks: true, contributionCount: count, viewCount: views },
  });
  const branch = await prisma.branch.create({
    data: { storyId: s.id, ownerId: owner.id, name: 'main', isRoot: true, lineage: [] },
  });
  const rows = [];
  for (let depth = 0; depth < count; depth++) {
    rows.push(
      await prisma.contribution.create({
        data: {
          branchId: branch.id, depth, authorId: owner.id, authorType: 'HUMAN',
          content: {}, textPlain: `Chương ${depth + 1}`, wordCount: 2,
        },
      }),
    );
  }
  return { story: s, chapters: rows };
}

before(async () => {
  if (skip) return;
  author = await user('author');
  reader = await user('reader', { emailVerifiedAt: new Date() });
  stranger = await user('stranger', { emailVerifiedAt: new Date() });
  admin = await user('admin', { role: 'ADMIN', emailVerifiedAt: new Date() });
  ({ story, chapters } = await storyWith(author, 'Truyện công khai', { genres: ['Ngôn tình', 'Cổ đại'] }));
  ({ story: hidden } = await storyWith(author, 'Truyện riêng', { visibility: 'PRIVATE' }));
});

after(async () => {
  if (skip) return;
  // Everything hangs off these users; cascades take the rest.
  const ids = [author, reader, stranger, admin].filter(Boolean).map((u) => u.id);
  await prisma.story.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- progress

test('progress: newest position wins, whichever device writes last', { skip }, async () => {
  const s = session();
  const svc = new ProgressService(prisma, s.service);
  s.as(reader);
  const t = Date.now() - 60_000;

  await svc.save(story.id, { depth: 1, at: 50, updatedAt: t });
  // A phone that was offline comes back with an older position.
  await svc.save(story.id, { depth: 0, at: 10, updatedAt: t - 5000 });
  let [row] = await svc.list();
  assert.deepEqual([row.depth, row.at], [1, 50], 'the older write is ignored');
  assert.equal(row.title, 'Truyện công khai');
  assert.equal(row.totalChapters, 3);

  await svc.save(story.id, { depth: 2, at: 7, updatedAt: t + 5000 });
  [row] = await svc.list();
  assert.deepEqual([row.depth, row.at], [2, 7], 'the newer write replaces it');
});

test('progress: a clock in the future cannot make a position unbeatable', { skip }, async () => {
  const s = session();
  const svc = new ProgressService(prisma, s.service);
  s.as(reader);
  await svc.save(story.id, { depth: 0, at: 1, updatedAt: Date.now() + 365 * 86_400_000 });
  const [row] = await svc.list();
  assert.ok(row.updatedAt <= Date.now() + 1000, 'stored no later than now');
  // ... so an honest save a moment later still lands.
  await new Promise((r) => setTimeout(r, 15));
  await svc.save(story.id, { depth: 1, at: 2, updatedAt: Date.now() });
  assert.equal((await svc.list())[0].depth, 1);
});

test('progress: makes the reader a reader (rating asks for that), but not the author', { skip }, async () => {
  const s = session();
  const svc = new ProgressService(prisma, s.service);
  s.as(reader);
  await svc.save(story.id, { depth: 0, at: 0, updatedAt: Date.now() });
  s.as(author);
  await svc.save(story.id, { depth: 0, at: 0, updatedAt: Date.now() });
  const readers = await prisma.storyReader.findMany({ where: { storyId: story.id }, select: { userId: true } });
  assert.deepEqual(readers.map((r) => r.userId), [reader.id]);
});

test('progress: no position in a story the reader cannot open; forgetting removes it', { skip }, async () => {
  const s = session();
  const svc = new ProgressService(prisma, s.service);
  s.as(reader);
  await assert.rejects(svc.save(hidden.id, { depth: 0, at: 0, updatedAt: Date.now() }), code('STORY_NOT_FOUND'));
  await svc.forget(story.id);
  assert.equal((await svc.list()).length, 0);
});

// ----------------------------------------------------------------- follows

test('follows: new chapters are counted from the moment of following', { skip }, async () => {
  const s = session();
  const svc = new FollowsService(prisma, s.service);

  s.as(null);
  assert.deepEqual(await svc.state(story.id), { following: false, followers: 0 });

  s.as(reader);
  assert.deepEqual(await svc.follow(story.id), { following: true, followers: 1 });
  assert.equal((await svc.mine())[0].newChapters, 0, 'what was already there is not new');

  // The author publishes two more chapters. Nothing is written per follower.
  await prisma.story.update({ where: { id: story.id }, data: { contributionCount: 5 } });
  let [f] = await svc.mine();
  assert.deepEqual([f.newChapters, f.firstNew, f.totalChapters], [2, 4, 5]);

  await svc.seen(story.id);
  [f] = await svc.mine();
  assert.equal(f.newChapters, 0);

  // Following twice is one follow; unfollowing leaves none.
  await svc.follow(story.id);
  assert.equal((await svc.state(story.id)).followers, 1);
  assert.deepEqual(await svc.unfollow(story.id), { following: false, followers: 0 });
  await prisma.story.update({ where: { id: story.id }, data: { contributionCount: 3 } });
});

test('follows: a private story cannot be followed by a stranger', { skip }, async () => {
  const s = session();
  const svc = new FollowsService(prisma, s.service);
  s.as(reader);
  await assert.rejects(svc.follow(hidden.id), code('STORY_NOT_FOUND'));
});

// ---------------------------------------------------------------- comments

test('comments: posted, listed newest first, and who may delete', { skip }, async () => {
  const s = session();
  const svc = new CommentsService(config(), prisma, fakeRedis(), s.service);
  const chapter = chapters[0].id;

  s.as(reader);
  const first = await svc.add(chapter, '  Hay quá!\r\n\r\n\r\n\r\nĐoạn cuối bất ngờ‮ thật.\u0007 ');
  assert.equal(first.body, 'Hay quá!\n\nĐoạn cuối bất ngờ thật.', 'cleaned: line ends, blank runs, control and override characters');
  assert.equal(first.mine, true);
  s.as(stranger);
  await svc.add(chapter, 'Mình thì thấy hơi vội.');

  let page = await svc.list(chapter);
  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((c) => c.author.displayName), ['stranger', 'reader']);
  assert.deepEqual(page.items.map((c) => c.canDelete), [true, false], 'a stranger deletes only their own');

  s.as(author);
  page = await svc.list(chapter);
  assert.deepEqual(page.items.map((c) => [c.mine, c.canDelete]), [[false, true], [false, true]], 'the author moderates their story');

  s.as(null);
  page = await svc.list(chapter);
  assert.deepEqual(page.items.map((c) => c.canDelete), [false, false], 'signed out: read only');

  s.as(stranger);
  await assert.rejects(svc.remove(first.id), code('COMMENT_NOT_YOURS'));
  s.as(author);
  await svc.remove(first.id);
  assert.equal((await svc.list(chapter)).total, 1);
});

test('comments: empty, too long, repeated and too fast are refused', { skip }, async () => {
  const s = session();
  const redis = fakeRedis();
  const svc = new CommentsService(config(), prisma, redis, s.service);
  const chapter = chapters[1].id;
  s.as(reader);

  await assert.rejects(svc.add(chapter, ' \n​ '), code('COMMENT_EMPTY'));
  await assert.rejects(svc.add(chapter, 'a'.repeat(COMMENT_MAX + 1)), code('COMMENT_TOO_LONG'));
  await svc.add(chapter, 'Một lần thôi.');
  await assert.rejects(svc.add(chapter, 'Một lần thôi.'), code('COMMENT_DUPLICATE'));

  redis.counts.clear();
  for (let i = 0; i < 5; i++) await svc.add(chapter, `Bình luận ${i}`);
  await assert.rejects(svc.add(chapter, 'Cái thứ sáu trong một phút'), code('COMMENT_RATE'));
});

test('comments: twenty to a page, the cursor carries on where the page ended', { skip }, async () => {
  const s = session();
  const svc = new CommentsService(config(), prisma, fakeRedis(), s.service);
  const chapter = chapters[2].id;
  const base = Date.now() - 100_000;
  await prisma.comment.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      contributionId: chapter, userId: reader.id, body: `c${i}`, createdAt: new Date(base + i * 1000),
    })),
  });
  s.as(null);
  const one = await svc.list(chapter);
  assert.equal(one.items.length, 20);
  assert.equal(one.items[0].body, 'c24');
  assert.ok(one.nextCursor);
  const two = await svc.list(chapter, one.nextCursor);
  assert.deepEqual(two.items.map((c) => c.body), ['c4', 'c3', 'c2', 'c1', 'c0']);
  assert.equal(two.nextCursor, null);
});

test('comments: none on a private story; unverified email is asked to verify first', { skip }, async () => {
  const s = session();
  const hiddenChapter = await prisma.contribution.findFirst({ where: { branch: { storyId: hidden.id } } });
  const open = new CommentsService(config(), prisma, fakeRedis(), s.service);
  s.as(author);
  await assert.rejects(open.list(hiddenChapter.id), code('CHAPTER_NOT_FOUND'));

  const strict = new CommentsService(config({ REQUIRE_VERIFIED_EMAIL: 'true' }), prisma, fakeRedis(), s.service);
  await assert.rejects(strict.add(chapters[0].id, 'Chưa xác minh'), code('EMAIL_UNVERIFIED'));
  s.as(reader);
  assert.equal((await strict.add(chapters[0].id, 'Đã xác minh')).body, 'Đã xác minh');
});

// ----------------------------------------------------------------- related

/** A 768-dimension vector pointing mostly along one axis. */
const vec = (axis, tilt = 0) => {
  const v = new Array(768).fill(0);
  v[axis] = 1;
  v[(axis + 1) % 768] = tilt;
  return `[${v.join(',')}]`;
};

async function card(storyId, embedding) {
  await prisma.storyCard.create({
    data: { storyId, summary: 's', tropes: [], moods: [], ending: 'HE', keywords: [], document: 'd', model: 'm', version: 1 },
  });
  if (embedding) {
    await prisma.$executeRawUnsafe(`UPDATE story_cards SET embedding = '${embedding}'::vector WHERE "storyId" = '${storyId}'::uuid`);
  }
}

test('related: nearest by embedding, closest first, never the story itself or a private one', { skip }, async () => {
  const { story: near } = await storyWith(author, 'Rất giống', { count: 1 });
  const { story: far } = await storyWith(author, 'Khác hẳn', { count: 1 });
  const { story: secret } = await storyWith(author, 'Giống nhưng riêng tư', { count: 1, visibility: 'PRIVATE' });
  await card(story.id, vec(0));
  await card(near.id, vec(0, 0.1));
  await card(far.id, vec(5));
  await card(secret.id, vec(0, 0.01));

  const svc = new RelatedService(prisma, fakeRedis());
  const r = await svc.for(story.id);
  assert.equal(r.basis, 'similar');
  assert.deepEqual(r.stories.map((s) => s.title), ['Rất giống', 'Khác hẳn']);
});

test('related: with no card yet, falls back to shared genres and says so', { skip }, async () => {
  const { story: plain } = await storyWith(author, 'Chưa có thẻ', { count: 1, genres: ['cổ đại'] });
  const { story: popular } = await storyWith(author, 'Cổ đại đông người đọc', { count: 1, genres: ['Cổ đại'], views: 500 });
  await storyWith(author, 'Thể loại khác', { count: 1, genres: ['Kinh dị'] });

  const r = await new RelatedService(prisma, fakeRedis()).for(plain.id);
  assert.equal(r.basis, 'genre');
  const titles = r.stories.map((s) => s.title);
  assert.ok(titles.includes(popular.title) && titles.includes('Truyện công khai'), 'case-insensitive genre match');
  assert.ok(!titles.includes('Thể loại khác') && !titles.includes('Chưa có thẻ'));
  assert.equal(titles[0], 'Cổ đại đông người đọc', 'most read first among equal overlap');
});

test('related: answered from the cache the second time', { skip }, async () => {
  const redis = fakeRedis();
  const svc = new RelatedService(prisma, redis);
  const first = await svc.for(story.id);
  assert.equal(redis.kv.size, 1);
  assert.deepEqual(await svc.for(story.id), first);
});
