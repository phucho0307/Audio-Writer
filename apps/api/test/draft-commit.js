/**
 * Committing a draft, and the edges around it.
 *
 * The interesting one is the race: persistence is debounced by a couple of
 * seconds, so a store scheduled before the row was deleted could write it back
 * afterwards and leave a ghost draft nobody asked for.
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
const API = 'http://localhost:4000/api';

(async () => {
  const owner = await p.user.findFirst({ where: { handle: 'ho_tan_phuc' } });
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({ data: { userId: owner.id, refreshHash: createHash('sha256').update(raw).digest('hex'), userAgent: 'commit-test', expiresAt: new Date(Date.now()+864e5) } });
  const token = (await (await fetch(`${API}/auth/refresh`, { method:'POST', headers:{cookie:`aw_refresh=${raw}`} })).json()).accessToken;
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const story = await p.story.create({
    data: { ownerId: owner.id, title: 'ZZ commit probe', language: 'vi', genres: ['kinh dị'],
      visibility: 'PRIVATE', allowForks: true,
      branches: { create: { ownerId: owner.id, isRoot: true, name: 'main' } } },
    include: { branches: true },
  });
  const branchId = story.branches[0].id;

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: 'ws://localhost:4000/collab', name: `branch:${branchId}`, document: doc, token, WebSocketPolyfill: WebSocket });
  const body = doc.getXmlFragment('body');
  const write = (t) => { const e = new Y.XmlElement('paragraph'); const n = new Y.XmlText(); n.insert(0, t); e.insert(0, [n]); body.insert(body.length, [e]); };
  await sleep(1500);

  // ---------------------------------------------------- empty draft refused
  let r = await fetch(`${API}/branches/${branchId}/draft/commit`, { method: 'POST', headers: auth, body: '{}' });
  console.log('empty draft refused      :', ok(r.status === 400), r.status);

  // ---------------------------------------------------------- normal commit
  write('Chiếc chìa khoá nằm im trong túi áo, lạnh hơn cả không khí ngoài kia.');
  write('Tâm đứng trước cửa phòng 304 lúc mười một giờ năm mươi.');
  await sleep(700);

  r = await fetch(`${API}/branches/${branchId}/draft/commit`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Phòng 304' }) });
  const chapter = await r.json();
  console.log('commit                   :', ok(r.status === 201), r.status);
  console.log('  title kept             :', ok(chapter.title === 'Phòng 304'), chapter.title);
  console.log('  paragraphs preserved   :', ok((chapter.content?.content?.length ?? 0) === 2), `${chapter.content?.content?.length} nodes`);
  console.log('  word count             :', chapter.wordCount);
  console.log('  depth 0 on first commit:', ok(chapter.depth === 0), chapter.depth);

  // ------------------------------------------------------ room emptied
  await sleep(500);
  const read = await (await fetch(`${API}/branches/${branchId}/draft`, { headers: auth })).json();
  console.log('  room emptied           :', ok(read.text.trim() === ''), JSON.stringify(read.text).slice(0, 40));

  // --------------------------------------------- the ghost-row race
  // Past the store debounce: if a queued write lands after the delete, a row
  // comes back carrying text that is already published.
  await sleep(5000);
  const ghost = await p.draftDoc.findUnique({ where: { branchId } });
  console.log('  no ghost draft row     :', ok(!ghost || ghost.wordCount === 0), ghost ? `row v${ghost.version}, ${ghost.wordCount} words` : 'no row');

  // ---------------------------------------------------- chapter indexed
  const chunks = await p.ragChunk.count({ where: { contributionId: chapter.id } });
  console.log('  chapter indexed for rag:', ok(chunks > 0), `${chunks} chunk(s)`);

  // ------------------------------------------------------- invite edges
  r = await fetch(`${API}/branches/${branchId}/draft/collaborators`, { method: 'POST', headers: auth, body: JSON.stringify({ handle: 'khong_ton_tai_dau' }) });
  console.log('\ninvite unknown handle    :', ok(r.status === 404), r.status);
  r = await fetch(`${API}/branches/${branchId}/draft/collaborators`, { method: 'POST', headers: auth, body: JSON.stringify({ handle: owner.handle }) });
  console.log('invite yourself refused  :', ok(r.status === 403), r.status);
  r = await fetch(`${API}/branches/${branchId}/draft`, {});
  console.log('draft needs auth         :', ok(r.status === 401 || r.status === 404), r.status);

  provider.destroy();
  await sleep(300);
  await p.ragChunk.deleteMany({ where: { storyId: story.id } });
  await p.draftDoc.deleteMany({ where: { branchId } });
  await p.contribution.deleteMany({ where: { branchId } });
  await p.branch.deleteMany({ where: { storyId: story.id } });
  await p.story.delete({ where: { id: story.id } });
  await p.session.deleteMany({ where: { userAgent: 'commit-test' } });
  console.log('\ncleaned up');
  await p.$disconnect();
  process.exit(0);
})();
