// Run against the local API after building and applying migrations.
// Creates two temporary users and one private story, then removes the fixtures.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env'), quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { JwtService } = require('@nestjs/jwt');
const sharp = require('sharp');

const prisma = new PrismaClient();
const base = 'http://localhost:4000/api';
const fixtures = [];
let storyId;
let uploadedUrl;

async function request(path, token, body, method = 'POST') {
  const multipart = body instanceof FormData;
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { 'content-type': 'application/json' } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

function form(bytes, type = 'image/png') {
  const body = new FormData(); body.append('file', new Blob([bytes], { type }), 'cover.png'); return body;
}

(async () => {
  try {
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      const user = await prisma.user.create({ data: { id, handle: `cover_test_${id.slice(0, 8)}`, email: `${id}@example.invalid`, displayName: 'Temporary thumbnail test' } });
      fixtures.push({ ...user, token: new JwtService().sign({ sub: user.id, handle: user.handle }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' }) });
    }
    const [owner, other] = fixtures;
    const created = await request('/stories', owner.token, { title: 'Căn nhà trong sương — kiểm thử thumbnail', genres: ['kinh dị', 'huyền bí'] });
    assert.equal(created.status, 201); storyId = created.body.id;
    const route = `/stories/${storyId}/cover`;
    assert.equal((await request(route + '/suggest', null, {})).status, 401);
    assert.equal((await request(route + '/suggest', other.token, {})).status, 403);
    const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#384656' } }).png().toBuffer();
    assert.equal((await request(route + '/upload', owner.token, form(Buffer.from('not an image'), 'image/jpeg'))).status, 400);
    assert.equal((await request(route + '/upload', owner.token, form(bytes))).status, 201);
    let story = await request(`/stories/${storyId}`, owner.token, null, 'GET');
    uploadedUrl = story.body.coverUrl;
    const imageResponse = await fetch('http://localhost:3000' + uploadedUrl);
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('content-type'), /image\/jpeg/);
    const image = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
    assert.equal(image.width, 900); assert.equal(image.height, 1200);
    assert.equal((await request(route, other.token, null, 'DELETE')).status, 403);
    assert.equal((await request(route + '/select', owner.token, { searchId: randomUUID(), candidateId: 'http://127.0.0.1/' })).status, 400);
    assert.equal((await request(route + '/suggest', owner.token, { url: 'http://127.0.0.1/' })).status, 400);
    const ai = await request(route + '/suggest', owner.token, { hint: 'một căn nhà vắng trong sương, không có người', page: 1 });
    assert.equal(ai.status, 201, JSON.stringify(ai.body));
    assert.ok(ai.body.candidates.length > 0);
    const candidate = ai.body.candidates[0];
    assert.equal((await fetch(candidate.previewUrl.startsWith('/') ? 'http://localhost:3000' + candidate.previewUrl : candidate.previewUrl)).status, 200);
    const selected = await request(route + '/select', owner.token, { searchId: ai.body.searchId, candidateId: candidate.id });
    assert.equal(selected.status, 201); assert.ok(selected.body.coverUrl);
    if (ai.body.source === 'library') assert.equal(selected.body.coverUrl, candidate.previewUrl);
    assert.equal(selected.body.coverCredit.provider, 'Pexels');
    const cached = await request(route + '/suggest', owner.token, { hint: 'một căn nhà vắng trong sương, không có người', page: 1 });
    assert.equal(cached.status, 201); assert.equal(cached.body.searchId, ai.body.searchId);
    const removed = await request(route, owner.token, null, 'DELETE');
    assert.equal(removed.status, 200); assert.equal(removed.body.coverUrl, null);
    story = await request(`/stories/${storyId}`, owner.token, null, 'GET');
    assert.equal(story.body.coverCredit, null);
    console.log(JSON.stringify({ passed: true, realGeminiSearch: true, candidates: ai.body.candidates.length, source: ai.body.source, uploadDimensions: `${image.width}x${image.height}`, checks: ['auth', 'ownership', 'invalid image', 'upload and HTTP image', 'DTO validation', 'AI suggestions', 'candidate selection', 'search caching', 'remove cover'] }));
  } finally {
    if (storyId) {
      await prisma.story.deleteMany({ where: { id: storyId } });
      const Redis = require('ioredis'); const redis = new Redis(process.env.REDIS_URL);
      const keys = await redis.keys(`cover:*`);
      for (const key of keys) {
        if (key.includes(storyId) || fixtures.some((u) => key.includes(u.id))) await redis.del(key);
        else if (key.startsWith('cover:search:')) {
          const record = JSON.parse(await redis.get(key) || '{}');
          if (record.storyId === storyId) await redis.del(key);
        }
      }
      await redis.quit();
    }
    await prisma.user.deleteMany({ where: { id: { in: fixtures.map((u) => u.id) } } });
    if (uploadedUrl?.startsWith('/uploads/covers/')) {
      const { unlink } = require('node:fs/promises');
      await unlink(require('node:path').resolve(__dirname, '../../web/public', uploadedUrl.slice(1))).catch(() => {});
    }
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
