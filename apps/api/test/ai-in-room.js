/**
 * The model writing into a live room.
 *
 * Uses a story with no committed chapters on purpose: then the draft is the
 * only text that exists, so a continuation can only come from the room. On a
 * branch that already has chapters, the model will happily continue those and
 * the test proves nothing.
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');
const p = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (b) => (b ? 'PASS' : '**FAIL**');

(async () => {
  const owner = await p.user.findFirst({ where: { handle: 'ho_tan_phuc' } });
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({ data: { userId: owner.id, refreshHash: createHash('sha256').update(raw).digest('hex'), userAgent: 'ai-room', expiresAt: new Date(Date.now()+864e5) } });
  const token = (await (await fetch('http://localhost:4000/api/auth/refresh', { method:'POST', headers:{cookie:`aw_refresh=${raw}`} })).json()).accessToken;

  const story = await p.story.create({
    data: {
      ownerId: owner.id, title: 'ZZ ai room probe', language: 'vi',
      genres: ['kinh dị'], visibility: 'PRIVATE', allowForks: true,
      branches: { create: { ownerId: owner.id, isRoot: true, name: 'main' } },
    },
    include: { branches: true },
  });
  const branchId = story.branches[0].id;
  console.log('fresh story, zero committed chapters\n');

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: 'ws://localhost:4000/collab', name: `branch:${branchId}`, document: doc,
    token, WebSocketPolyfill: WebSocket,
  });
  const body = doc.getXmlFragment('body');
  const meta = doc.getMap('meta');

  const seen = [];
  meta.observe(() => seen.push(JSON.stringify(meta.get('ai'))));
  let updates = 0;
  body.observeDeep(() => updates++);

  const write = (text) => {
    const para = new Y.XmlElement('paragraph');
    const node = new Y.XmlText();
    node.insert(0, text);
    para.insert(0, [node]);
    body.insert(body.length, [para]);
  };

  await sleep(1500);
  const SEED = 'Bà cụ bán nước ở góc chợ đưa cho Tâm một chiếc chìa khoá gỉ và dặn: phòng 304, đừng mở trước nửa đêm.';
  write(SEED);
  await sleep(600);
  const before = body.toString();
  updates = 0;

  console.log('asking the model to continue the room...');
  const t0 = Date.now();
  const res = await fetch(`http://localhost:4000/api/branches/${branchId}/draft/ai`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paragraphs: 1 }),
  });
  const out = await res.json();
  console.log('  response          :', res.status, JSON.stringify(out).slice(0, 100));
  await sleep(1200);

  const after = body.toString();
  const written = after.slice(before.length).replace(/<\/?[a-z]+>/g, '').trim();

  console.log('  wrote something   :', ok(after.length > before.length), `${before.length} -> ${after.length} chars in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log('  continued THE ROOM:', ok(/chìa khoá|chia khoa|304|bà cụ|Tâm|cửa|khoá/i.test(written)));
  console.log('  human text intact :', ok(after.includes('chiếc chìa khoá gỉ')));
  console.log('  banner cleared    :', ok(seen[seen.length - 1] === 'null'));
  console.log('  updates seen      :', updates, '(progressive if > 1)');
  console.log('\n--- what the model wrote ---');
  console.log(written.slice(0, 320));

  provider.destroy();
  await sleep(300);
  await p.draftDoc.deleteMany({ where: { branchId } });
  await p.ragChunk.deleteMany({ where: { storyId: story.id } });
  await p.contribution.deleteMany({ where: { branchId } });
  await p.branch.deleteMany({ where: { storyId: story.id } });
  await p.story.delete({ where: { id: story.id } });
  await p.session.deleteMany({ where: { userAgent: 'ai-room' } });
  console.log('\ncleaned up');
  await p.$disconnect();
  process.exit(0);
})();
