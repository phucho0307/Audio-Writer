/**
 * Exercises the draft room the way clients will: two writers in one document,
 * a bad token, a read-only viewer, and a reconnect to prove persistence.
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');

const API = 'http://localhost:4000/api';
const WS = 'ws://localhost:4000/collab';
const p = new PrismaClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (b) => (b ? 'PASS' : '**FAIL**');

async function tokenFor(userId, tag) {
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({
    data: {
      userId,
      refreshHash: createHash('sha256').update(raw).digest('hex'),
      userAgent: tag,
      expiresAt: new Date(Date.now() + 864e5),
    },
  });
  const r = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `aw_refresh=${raw}` },
  });
  return (await r.json()).accessToken;
}

function join(branchId, token, name) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: WS,
    name: `branch:${branchId}`,
    document: doc,
    token,
    WebSocketPolyfill: WebSocket,
    onAuthenticationFailed: () => {
      provider.failed = true;
    },
  });
  provider.setAwarenessField?.('user', { name });
  return { doc, provider, text: doc.getText('body') };
}

(async () => {
  const owner = await p.user.findFirst({ where: { handle: 'ho_tan_phuc' } });

  // A second human, created for this test and removed at the end.
  const mate = await p.user.upsert({
    where: { handle: 'collab_test_mate' },
    create: {
      handle: 'collab_test_mate',
      email: 'collab_test_mate@example.test',
      displayName: 'Bạn Viết Chung',
      googleSub: "collab-test-" + Date.now(),
    },
    update: {},
  });

  const story = await p.story.findFirst({
    where: { ownerId: owner.id },
    include: { branches: { where: { isRoot: true }, take: 1 } },
  });
  const branchId = story.branches[0].id;
  console.log(`story "${story.title}" · branch ${branchId.slice(0, 8)}\n`);

  await p.draftDoc.deleteMany({ where: { branchId } });

  const ownerToken = await tokenFor(owner.id, 'collab-test');
  const mateToken = await tokenFor(mate.id, 'collab-test');

  // ---------------------------------------------------------------- 1. auth
  console.log('=== a token the server did not issue ===');
  const bogus = join(branchId, 'not-a-real-token', 'kẻ lạ');
  await sleep(1200);
  console.log('  rejected          :', ok(bogus.failed || !bogus.provider.isAuthenticated));
  bogus.provider.destroy();

  console.log('\n=== a real user with no seat at this branch ===');
  const outsider = join(branchId, mateToken, 'người ngoài');
  await sleep(1200);
  console.log('  rejected          :', ok(outsider.failed || !outsider.provider.isAuthenticated));
  outsider.provider.destroy();

  // ------------------------------------------------------- 2. two writers
  console.log('\n=== owner invites them, then both type at once ===');
  await fetch(`${API}/branches/${branchId}/draft/collaborators`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'collab_test_mate', role: 'EDITOR' }),
  });

  const a = join(branchId, ownerToken, 'phúc');
  const b = join(branchId, mateToken, 'bạn viết');
  await sleep(1500);
  console.log('  both connected    :', ok(a.provider.isAuthenticated && b.provider.isAuthenticated));

  // Interleaved writes from both ends, with no coordination at all.
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    a.text.insert(a.text.length, `A${i} `);
    b.text.insert(b.text.length, `B${i} `);
    await sleep(10);
  }
  await sleep(900);
  const converged = a.text.toString() === b.text.toString();
  console.log('  converged         :', ok(converged), `in ~${Date.now() - t0}ms`);
  console.log('  both saw everything:', ok(a.text.toString().includes('A19') && a.text.toString().includes('B19')));
  console.log('  same length       :', a.text.length, '/', b.text.length);

  // ------------------------------------------------------- 3. persistence
  console.log('\n=== persistence ===');
  const snapshot = a.text.toString();
  await sleep(2600); // past the store debounce
  const row = await p.draftDoc.findUnique({ where: { branchId } });
  console.log('  row written       :', ok(!!row), row ? `${row.state.length} bytes, v${row.version}, ${row.wordCount} words` : '');

  a.provider.destroy();
  b.provider.destroy();
  await sleep(600);

  const c = join(branchId, ownerToken, 'phúc again');
  await sleep(1500);
  console.log('  reconnect restores:', ok(c.text.toString() === snapshot));
  c.provider.destroy();

  // ------------------------------------------------------- 4. read-only
  console.log('\n=== a viewer may watch but not type ===');
  await fetch(`${API}/branches/${branchId}/draft/collaborators`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'collab_test_mate', role: 'VIEWER' }),
  });
  const watcher = join(branchId, mateToken, 'người xem');
  await sleep(1500);
  const before = watcher.text.toString();
  console.log('  viewer connected  :', ok(watcher.provider.isAuthenticated));
  watcher.text.insert(0, 'XIN CHAO ');
  await sleep(1200);
  const stored = await p.draftDoc.findUnique({ where: { branchId } });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(stored.state));
  const serverText = doc.getText('body').toString();
  console.log('  server ignored it :', ok(!serverText.startsWith('XIN CHAO')));
  console.log('  viewer saw text   :', ok(before.length > 0));
  watcher.provider.destroy();

  // ------------------------------------------------------- 5. HTTP read
  console.log('\n=== HTTP view of the same draft ===');
  const read = await (
    await fetch(`${API}/branches/${branchId}/draft`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    })
  ).json();
  console.log('  GET /draft        :', ok(typeof read.text === 'string'), `${read.wordCount} words`);

  await sleep(400);
  await p.draftDoc.deleteMany({ where: { branchId } });
  await p.branchCollaborator.deleteMany({ where: { branchId } });
  await p.session.deleteMany({ where: { userAgent: 'collab-test' } });
  await p.user.delete({ where: { id: mate.id } }).catch(() => {});
  console.log('\ncleaned up');
  await p.$disconnect();
  process.exit(0);
})();
