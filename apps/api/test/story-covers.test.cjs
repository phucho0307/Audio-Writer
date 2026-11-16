const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { StoryCoversService } = require('../dist/stories/story-covers.service');

const catalog = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`cover-${i}`, {
  query: `foggy house ${i}`, photoId: String(i),
  sourceUrl: `https://www.pexels.com/photo/foggy-house-${i}/`, file: `cover-${i}.jpg`,
}]));

function fixture(config = {}) {
  const entries = new Map();
  const writes = [];
  const stored = [];
  let allowed = true;
  let quotaCalls = 0;
  const stories = { ownedStory: async (id) => {
    if (!allowed) throw new Error('not owner');
    return { story: { id, title: 'House in the fog', genres: ['horror'], synopsis: 'A mysterious house', mainBranchId: 'main' }, user: { id: 'owner' } };
  } };
  const prisma = {
    contribution: { findFirst: async () => ({ textPlain: 'Opening. '.repeat(2000) }) },
    story: { update: async (write) => { writes.push(write); return write.data; } },
  };
  const redis = {
    client: { get: async (key) => entries.get(key) ?? null, set: async (key, value) => { entries.set(key, value); } },
    incrementWindow: async () => ++quotaCalls,
  };
  const storage = { put: async (key, buffer, type) => {
    stored.push({ key, buffer, type }); return { url: `/uploads/covers/${key}` };
  } };
  const service = new StoryCoversService(stories, prisma, {
    get: (key, fallback) => ({ GEMINI_API_KEY: 'test-only', ...config })[key] ?? fallback,
  }, redis, storage);
  service.catalog = async () => catalog;
  return { service, entries, writes, stored, forbid: () => { allowed = false; }, quotaCalls: () => quotaCalls };
}

function geminiResponse() {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: ['foggy house'], picks: Object.keys(catalog) }) }] } }] });
}

test('uploaded images are decoded, cropped to 3:4, stripped of metadata and stored as JPEG', async () => {
  const f = fixture();
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#123456' } }).png().toBuffer();
  const result = await f.service.upload('story', original);
  assert.match(result.coverUrl, /^\/uploads\/covers\/[a-f0-9]{64}\.jpg$/);
  const meta = await sharp(f.stored[0].buffer).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 900); assert.equal(meta.height, 1200);
  assert.equal(meta.exif, undefined); assert.equal(f.stored[0].type, 'image/jpeg');
});

test('corrupt, SVG, tiny and oversized uploads never reach storage or database', async () => {
  const f = fixture();
  const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'red' } }).png().toBuffer();
  for (const bytes of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"></svg>'), tiny, Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    await assert.rejects(f.service.upload('story', bytes));
  }
  assert.equal(f.stored.length, 0); assert.equal(f.writes.length, 0);
});

test('ownership is checked before any paid search, upload or removal', async (t) => {
  const f = fixture(); f.forbid();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  await assert.rejects(f.service.upload('story', Buffer.from('image')), /not owner/);
  await assert.rejects(f.service.suggest('story'), /not owner/);
  await assert.rejects(f.service.remove('story'), /not owner/);
  assert.equal(fetch.mock.callCount(), 0); assert.equal(f.quotaCalls(), 0);
});

test('AI searches are cached, pagination reuses the same plan, and only a short opening is sent', async (t) => {
  const f = fixture();
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const payload = JSON.parse(options.body);
    const input = JSON.parse(payload.contents[0].parts[0].text);
    assert.equal(input.story.opening.length, 2400);
    assert.equal(input.story.title, 'House in the fog');
    return geminiResponse();
  });
  const first = await f.service.suggest('story');
  const cached = await f.service.suggest('story');
  const next = await f.service.suggest('story', '', 2);
  assert.deepEqual(first, cached); assert.equal(first.candidates.length, 6);
  assert.equal(first.source, 'library'); assert.equal(first.candidates[0].recommended, true);
  assert.equal(fetch.mock.callCount(), 1); assert.equal(f.quotaCalls(), 1);
  assert.equal(next.candidates[0].id, 'library:cover-6');
  assert.ok(!('file' in first.candidates[0]));
  const result = await f.service.select('story', first.searchId, first.candidates[0].id);
  assert.equal(result.coverUrl, '/covers/cover-0.jpg');
  assert.equal(result.coverCredit.sourceUrl, catalog['cover-0'].sourceUrl);
});

test('expired searches, foreign story/user tokens and arbitrary candidates cannot set a cover', async (t) => {
  const f = fixture();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  for (const record of [null,
    { storyId: 'another-story', userId: 'owner', candidates: [{ id: 'candidate' }] },
    { storyId: 'story', userId: 'another-user', candidates: [{ id: 'candidate' }] },
    { storyId: 'story', userId: 'owner', candidates: [{ id: 'another-candidate' }] },
  ]) {
    if (record) f.entries.set('cover:search:token', JSON.stringify(record));
    else f.entries.delete('cover:search:token');
    await assert.rejects(f.service.select('story', 'token', 'candidate'));
  }
  assert.equal(fetch.mock.callCount(), 0); assert.equal(f.writes.length, 0);
});

test('Pexels photo searches return source credits and selected images are saved locally', async (t) => {
  const f = fixture({ PEXELS_API_KEY: 'test-pexels' });
  const image = await sharp({ create: { width: 500, height: 700, channels: 3, background: '#222' } }).jpeg().toBuffer();
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('generativelanguage')) return geminiResponse();
    if (String(url).startsWith('https://api.pexels.com/')) {
      assert.equal(opts.headers.Authorization, 'test-pexels');
      return Response.json({ photos: [{ id: 123, alt: 'House in fog', url: 'https://www.pexels.com/photo/house-123/', photographer: 'Photographer', photographer_url: 'https://www.pexels.com/@photographer/', src: { medium: 'https://images.pexels.com/photos/123/preview.jpeg', large2x: 'https://images.pexels.com/photos/123/photo.jpeg' } }] });
    }
    assert.equal(opts.redirect, 'error');
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  });
  const result = await f.service.suggest('story');
  assert.equal(result.source, 'pexels'); assert.equal(result.candidates[0].credit.photographer, 'Photographer');
  assert.ok(!('downloadUrl' in result.candidates[0]));
  const saved = await f.service.select('story', result.searchId, result.candidates[0].id);
  assert.match(saved.coverUrl, /^\/uploads\/covers\//); assert.equal(saved.coverCredit.photographer, 'Photographer');
});

test('remote downloads reject untrusted hosts and URLs with credentials without issuing a request', async (t) => {
  const f = fixture();
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  for (const url of ['http://127.0.0.1/secret', 'https://images.pexels.com.evil.test/a.jpg', 'https://user:pass@images.pexels.com/a.jpg', 'https://images.pexels.com:8443/a.jpg']) {
    await assert.rejects(f.service.download(url));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('provider quota errors remain actionable and never overwrite the existing cover', async (t) => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(f.service.suggest('story'), (error) => error.getStatus() === 429);
  assert.equal(f.writes.length, 0);
});
