/** The model writing into a live room: does every connected client see it? */
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

  const story = await p.story.findFirst({ where: { ownerId: owner.id }, include: { branches: { where: { isRoot: true }, take: 1 } } });
  const branchId = story.branches[0].id;
  await p.draftDoc.deleteMany({ where: { branchId } });

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: 'ws://localhost:4000/collab', name: `branch:${branchId}`, document: doc,
    token, WebSocketPolyfill: WebSocket,
  });
  const body = doc.getText('body');
  const meta = doc.getMap('meta');

  const seen = [];
  meta.observe(() => seen.push(JSON.stringify(meta.get('ai'))));
  let grew = 0;
  body.observe(() => grew++);

  await sleep(1500);
  body.insert(0, 'Hắn đứng trước cánh cửa, tay còn vương mùi mưa. ');
  await sleep(600);
  const before = body.toString();
  console.log('watcher connected, draft has', before.length, 'chars\n');

  console.log('asking the model to continue...');
  const t0 = Date.now();
  const res = await fetch(`http://localhost:4000/api/branches/${branchId}/draft/ai`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paragraphs: 1 }),
  });
  const out = await res.json();
  console.log('  response          :', res.status, JSON.stringify(out).slice(0, 120));
  await sleep(1200);

  const after = body.toString();
  console.log('  text grew         :', ok(after.length > before.length), `${before.length} -> ${after.length} chars in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log('  arrived in pieces :', ok(grew > 3), `${grew} updates seen by the watcher`);
  console.log('  banner announced  :', ok(seen.length >= 2), seen.slice(0, 2).join(' then ').slice(0, 90));
  console.log('  banner cleared    :', ok(seen[seen.length - 1] === 'null'));
  console.log('  human text intact :', ok(after.startsWith(before.trim().slice(0, 40))));
  console.log('\n--- what the model wrote ---');
  console.log(after.slice(before.length).trim().slice(0, 300));

  provider.destroy();
  await sleep(300);
  await p.draftDoc.deleteMany({ where: { branchId } });
  await p.session.deleteMany({ where: { userAgent: 'ai-room' } });
  await p.$disconnect();
  process.exit(0);
})();
