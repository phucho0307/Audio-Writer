/**
 * The whole retrieval path: a committed chapter indexes itself, and a
 * continuation is given both halves of the corpus.
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');
const API = 'http://localhost:4000/api';
const p = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (b) => (b ? 'PASS' : '**FAIL**');

(async () => {
  const owner = await p.user.findFirst({ where: { handle: 'ho_tan_phuc' } });
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({ data: { userId: owner.id, refreshHash: createHash('sha256').update(raw).digest('hex'), userAgent: 'rag-test', expiresAt: new Date(Date.now()+864e5) } });
  const token = (await (await fetch(`${API}/auth/refresh`, { method:'POST', headers:{cookie:`aw_refresh=${raw}`} })).json()).accessToken;

  // A throwaway story in one of the five genres.
  const story = await p.story.create({
    data: {
      ownerId: owner.id, title: 'ZZ rag probe', language: 'vi',
      genres: ['ngoại tình', 'kinh dị'], visibility: 'PRIVATE', allowForks: true,
      branches: { create: { ownerId: owner.id, isRoot: true, name: 'main' } },
    },
    include: { branches: true },
  });
  const branchId = story.branches[0].id;
  console.log('story genres:', story.genres.join(', '));

  const before = await (await fetch(`${API}/rag/stats`)).json();

  const text = [
    'Hằng tìm thấy hoá đơn trong túi áo khoác của chồng: hai ly cà phê, lúc ba giờ chiều thứ Năm.',
    'Thứ Năm là ngày anh nói phải họp ở công ty suốt buổi. Cô gấp tờ giấy lại, để đúng chỗ cũ.',
    'Tối đó cô nấu món anh thích. Cô muốn xem anh ăn có ngon miệng không.',
  ].join('\n\n');

  const committed = await (await fetch(`${API}/branches/${branchId}/contributions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      content: { type: 'doc', content: [] },
      textPlain: text,
      title: 'Hoá đơn',
      authorType: 'HUMAN',
    }),
  })).json();
  console.log('committed chapter:', committed.id ? committed.id.slice(0, 8) : JSON.stringify(committed).slice(0, 120));

  // Indexing is announced, not awaited, so give the handler a moment.
  await sleep(4000);
  const after = await (await fetch(`${API}/rag/stats`)).json();
  console.log('\nchapter chunks:', before.chapter, '->', after.chapter);
  console.log('  self-indexed on commit :', ok(after.chapter > before.chapter));

  const rows = await p.ragChunk.findMany({ where: { contributionId: committed.id } });
  console.log('  genre inferred from tags:', ok(rows.every((r) => r.genre === 'INFIDELITY')), rows[0]?.genre);
  console.log('  embedded                :', ok(rows.every((r) => r.embeddedBy)), rows[0]?.embeddedBy ?? '');

  // Retrieval over the story's own text.
  const hits = await (await fetch(`${API}/rag/search?q=${encodeURIComponent('hoá đơn cà phê thứ Năm')}&storyId=${story.id}`)).json();
  console.log('\nsearch finds the new chapter:', ok(hits.some((h) => h.kind === 'CHAPTER')));
  hits.slice(0, 3).forEach((h) => console.log(`   ${h.kind.padEnd(7)} ${h.label}`));

  // And both corpora answer a continuation-shaped query.
  const mixed = await (await fetch(`${API}/rag/search?q=${encodeURIComponent('cô nghi ngờ chồng, tìm được bằng chứng nhỏ')}&genre=INFIDELITY`)).json();
  const kinds = new Set(mixed.map((h) => h.kind));
  console.log('\nmixed query returns both kinds:', ok(kinds.has('CRAFT') && kinds.has('CHAPTER')), [...kinds].join(' + '));

  await p.ragChunk.deleteMany({ where: { storyId: story.id } });
  await p.contribution.deleteMany({ where: { branchId } });
  await p.branch.deleteMany({ where: { storyId: story.id } });
  await p.story.delete({ where: { id: story.id } });
  await p.session.deleteMany({ where: { userAgent: 'rag-test' } });
  console.log('\ncleaned up');
  await p.$disconnect();
})();
