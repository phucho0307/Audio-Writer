/**
 * Where a chapter goes when someone other than the author publishes it.
 *
 * Found by hand, not by a test: an invited writer pressed "đăng chương" in
 * someone else's room and their chapter appeared in that person's *published*
 * story, as its next chapter, under its title. Underneath was a broader hole -
 * POST /branches/:id/contributions checked nothing, so any signed-in account
 * could append to any branch.
 *
 * This proves the rule now holds end to end, on a throwaway private story that
 * it creates and deletes:
 *
 *   - a stranger cannot append to someone else's branch directly
 *   - an invited writer's room commit lands on a branch of their own,
 *     named after them, inheriting the story so far - and the author's main
 *     line and its counters do not move
 *   - their next commit continues that branch rather than sprouting another
 *   - the owner's own room commit still goes onto main
 *
 *   node test/collab-branching.js        (API on :4000, two users in the DB)
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');

const API = 'http://localhost:4000/api';
const WS = 'ws://localhost:4000/collab';
const TAG = 'collab-branching-test';
const p = new PrismaClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : '**FAIL**'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function tokenFor(userId) {
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({
    data: {
      userId,
      refreshHash: createHash('sha256').update(raw).digest('hex'),
      userAgent: TAG,
      expiresAt: new Date(Date.now() + 36e5),
    },
  });
  const r = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `aw_refresh=${raw}` },
  });
  return (await r.json()).accessToken;
}

const headers = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });

/** Type a paragraph into a room the way TipTap does: XmlElement > XmlText. */
async function writeInRoom(branchId, token, text) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: WS,
    name: `branch:${branchId}`,
    document: doc,
    token,
    WebSocketPolyfill: WebSocket,
  });
  await new Promise((resolve, reject) => {
    provider.on('synced', resolve);
    provider.on('authenticationFailed', ({ reason }) => reject(new Error(reason)));
    setTimeout(() => reject(new Error('no sync')), 10000);
  });
  const body = doc.getXmlFragment('body');
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText(text)]);
  body.insert(body.length, [para]);
  // Long enough for the server's debounced store to see it.
  await sleep(2500);
  provider.destroy();
}

(async () => {
  // Two real accounts: the first admin-free user stands in for the stranger,
  // so the admin override cannot make the stranger checks pass by accident.
  const users = await p.user.findMany({ orderBy: { createdAt: 'asc' } });
  const owner = users.find((u) => u.role !== 'ADMIN');
  const guest = users.find((u) => u.role !== 'ADMIN' && u.id !== owner?.id);
  if (!owner || !guest) {
    console.log('SKIPPED: needs two non-admin users in the database');
    process.exit(0);
  }
  console.log(`owner @${owner.handle}, guest @${guest.handle}\n`);

  const ownerT = await tokenFor(owner.id);
  const guestT = await tokenFor(guest.id);

  // A private story, so nothing here is ever visible to anyone.
  const story = await (
    await fetch(`${API}/stories`, {
      method: 'POST',
      headers: headers(ownerT),
      body: JSON.stringify({ title: `ZZ ${TAG} ${Date.now()}` }),
    })
  ).json();
  const main = story.mainBranchId ?? story.branches?.[0]?.id;

  try {
    const chapter = (text) => ({
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      textPlain: text,
      authorType: 'HUMAN',
    });

    let r = await fetch(`${API}/branches/${main}/contributions`, {
      method: 'POST',
      headers: headers(ownerT),
      body: JSON.stringify(chapter('Chương một, do chính tác giả viết.')),
    });
    check('owner appends to their own branch', r.status === 201, `HTTP ${r.status}`);

    console.log('\n=== a stranger posting straight onto the author\'s branch ===');
    r = await fetch(`${API}/branches/${main}/contributions`, {
      method: 'POST',
      headers: headers(guestT),
      body: JSON.stringify(chapter('Chương lạ chen vào.')),
    });
    const refused = await r.json();
    check('refused', r.status === 403, `HTTP ${r.status}`);
    check('says why', refused.code === 'NOT_BRANCH_OWNER', refused.code);

    console.log('\n=== an invited writer publishing from the room ===');
    r = await fetch(`${API}/branches/${main}/draft/collaborators`, {
      method: 'POST',
      headers: headers(ownerT),
      body: JSON.stringify({ handle: guest.handle, role: 'EDITOR' }),
    });
    check('owner invites guest as editor', r.status === 201, `HTTP ${r.status}`);

    await writeInRoom(main, guestT, 'Đoạn này do người được mời viết trong phòng chung.');
    r = await fetch(`${API}/branches/${main}/draft/commit`, {
      method: 'POST',
      headers: headers(guestT),
      body: JSON.stringify({ title: 'Hướng khác' }),
    });
    const landed = await r.json();
    check('commit accepted', r.status === 201, `HTTP ${r.status}`);
    check('reported as forked', landed.forked === true);
    check('landed somewhere other than main', landed.branchId && landed.branchId !== main);

    const own = await p.branch.findUnique({ where: { id: landed.branchId } });
    check('branch belongs to the guest', own?.ownerId === guest.id);
    check('branch is named after them', own?.name === `@${guest.handle}`, own?.name);
    check('split from main at chapter 1', own?.forkedFromBranchId === main && own?.forkedAtDepth === 0);

    // A fork's opening chapter must reach the retrieval index like any other
    // commit. It did not: only commit() announced chapters, so every fork's
    // first chapter was invisible to the AI continuing that branch.
    let indexed = 0;
    for (let i = 0; i < 20 && !indexed; i++) {
      indexed = await p.ragChunk.count({ where: { contributionId: landed.id } });
      if (!indexed) await sleep(1000);
    }
    check("the branch's first chapter was indexed", indexed > 0, `${indexed} chunk(s)`);

    const mainRow = await p.branch.findUnique({ where: { id: main } });
    const storyRow = await p.story.findUnique({ where: { id: story.id } });
    check('main did not move', mainRow.depth === 0, `depth ${mainRow.depth}`);
    check('story still counts 1 chapter', storyRow.contributionCount === 1, `${storyRow.contributionCount}`);

    const read = await (await fetch(`${API}/branches/${landed.branchId}`, { headers: headers(guestT) })).json();
    const texts = (read.contributions ?? []).map((c) => c.textPlain);
    check(
      "guest's branch reads: author's chapter, then theirs",
      texts.length === 2 && texts[0].startsWith('Chương một') && texts[1].includes('người được mời'),
      `${texts.length} chapters`,
    );

    console.log('\n=== the same guest publishing again ===');
    await writeInRoom(main, guestT, 'Và thêm một chương nữa, vẫn theo hướng của họ.');
    r = await fetch(`${API}/branches/${main}/draft/commit`, {
      method: 'POST',
      headers: headers(guestT),
      body: '{}',
    });
    const again = await r.json();
    check('continues the same branch', again.branchId === landed.branchId);
    const ownAfter = await p.branch.findUnique({ where: { id: landed.branchId } });
    check('which is now 3 chapters deep', ownAfter.depth === 2, `depth ${ownAfter.depth}`);
    const siblings = await p.branch.count({ where: { forkedFromBranchId: main, ownerId: guest.id } });
    check('no second branch sprouted', siblings === 1, `${siblings}`);

    console.log('\n=== the owner publishing from the same room ===');
    await writeInRoom(main, ownerT, 'Chương hai của tác giả.');
    r = await fetch(`${API}/branches/${main}/draft/commit`, {
      method: 'POST',
      headers: headers(ownerT),
      body: '{}',
    });
    const mine = await r.json();
    check('lands on main', mine.branchId === main && mine.forked === false);
    const mainAfter = await p.branch.findUnique({ where: { id: main } });
    check('main advanced to chapter 2', mainAfter.depth === 1, `depth ${mainAfter.depth}`);
  } finally {
    const d = await fetch(`${API}/stories/${story.id}`, { method: 'DELETE', headers: headers(ownerT) });
    const gone = !(await p.story.findUnique({ where: { id: story.id } }));
    console.log(`\ncleanup: story deleted (HTTP ${d.status}, gone: ${gone})`);
    if (!gone) {
      // The API refused - leave nothing behind regardless.
      await p.story.delete({ where: { id: story.id } }).catch(() => {});
    }
    await p.session.deleteMany({ where: { userAgent: TAG } });
    await p.$disconnect();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
