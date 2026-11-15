/**
 * Google-Docs-style link sharing for draft rooms.
 *
 * On a throwaway private story: the owner turns the link on as "editor", a
 * second account opens it and is in; the owner drops it to "viewer" and the
 * guest follows; the owner turns it off and the guest is out; resetting
 * invalidates the old token. An invitation by name is never downgraded by
 * the link.
 *
 *   node test/share-link.js
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');

const API = 'http://localhost:4000/api';
const TAG = 'share-link-test';
const p = new PrismaClient();
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : '**FAIL**'}  ${label}${detail ? `  (${detail})` : ''}`);
};

async function tokenFor(userId) {
  const raw = randomBytes(48).toString('base64url');
  await p.session.create({
    data: { userId, refreshHash: createHash('sha256').update(raw).digest('hex'), userAgent: TAG, expiresAt: new Date(Date.now() + 36e5) },
  });
  return (await (await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { cookie: `aw_refresh=${raw}` } })).json()).accessToken;
}
const H = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });

(async () => {
  const [owner, guest, third] = await p.user.findMany({ where: { role: 'USER' }, orderBy: { createdAt: 'asc' } });
  if (!owner || !guest || !third) {
    console.log('SKIPPED: needs three non-admin users');
    process.exit(0);
  }
  const [oT, gT, tT] = [await tokenFor(owner.id), await tokenFor(guest.id), await tokenFor(third.id)];
  const story = await (await fetch(`${API}/stories`, { method: 'POST', headers: H(oT), body: JSON.stringify({ title: `ZZ ${TAG}` }) })).json();
  const main = story.branches[0].id;
  const share = (t, body) =>
    fetch(`${API}/branches/${main}/draft/share`, { method: body ? 'PUT' : 'GET', headers: H(t), body: body && JSON.stringify(body) });
  const join = async (t, token) => {
    const r = await fetch(`${API}/share/${token}/join`, { method: 'POST', headers: H(t) });
    return { status: r.status, body: await r.json() };
  };
  const roomStatus = async (t) => (await fetch(`${API}/branches/${main}/draft`, { headers: H(t) })).status;

  try {
    check('a stranger cannot read the share settings', (await share(gT)).status >= 403);
    check('room is closed to the guest before sharing', (await roomStatus(gT)) === 404);

    let s = await (await share(oT, { access: 'EDITOR' })).json();
    check('owner turns the link on as editor', s.linkAccess === 'EDITOR' && !!s.token);
    const token = s.token;

    let j = await join(gT, token);
    check('guest joins through the link as editor', j.status === 201 && j.body.role === 'EDITOR' && j.body.branchId === main, `HTTP ${j.status}`);
    check('guest can now open the room', (await roomStatus(gT)) === 200);
    check('guest can read the private story', (await fetch(`${API}/stories/${story.id}`, { headers: H(gT) })).status === 200);

    // An invitation by name outranks the link.
    await fetch(`${API}/branches/${main}/draft/collaborators`, { method: 'POST', headers: H(oT), body: JSON.stringify({ handle: third.handle, role: 'EDITOR' }) });
    s = await (await share(oT, { access: 'VIEWER' })).json();
    check('owner lowers the link to viewer', s.linkAccess === 'VIEWER' && s.token === token);
    const roles = Object.fromEntries((await p.branchCollaborator.findMany({ where: { branchId: main } })).map((c) => [c.userId, c.role]));
    check('the link guest follows the link down', roles[guest.id] === 'VIEWER');
    check('the named invitee keeps editor', roles[third.id] === 'EDITOR');
    j = await join(tT, token);
    check('opening the link never downgrades a named invitee', j.body.role === 'EDITOR');

    await share(oT, { access: 'NONE' });
    check('turning the link off removes the link guest', (await roomStatus(gT)) === 404);
    check('...but not the named invitee', (await roomStatus(tT)) === 200);
    j = await join(gT, token);
    check('a switched-off link opens nothing', j.status === 404, `HTTP ${j.status}`);

    s = await (await share(oT, { access: 'EDITOR' })).json();
    await join(gT, s.token);
    const reset = await (await fetch(`${API}/branches/${main}/draft/share/reset`, { method: 'POST', headers: H(oT) })).json();
    check('reset issues a new token', reset.token && reset.token !== s.token);
    check('reset removes everyone who came through the old link', (await roomStatus(gT)) === 404);
    check('the old token is dead', (await join(gT, s.token)).status === 404);
  } finally {
    await p.story.delete({ where: { id: story.id } }).catch(() => {});
    await p.session.deleteMany({ where: { userAgent: TAG } });
    await p.$disconnect();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
