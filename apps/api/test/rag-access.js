/**
 * The search index must not be a way around the site's access rules.
 *
 * Found by probing: an anonymous GET /rag/search?storyId=…&kind=CHAPTER
 * returned the full text of a PRIVATE story. Every committed chapter is
 * indexed - the author's AI needs all of it - and search checked nothing.
 *
 * This writes a chapter with a nonsense marker word into a throwaway private
 * story, then asks for it as a stranger, as another account, and as the owner.
 * Only the owner may get it back. It then publishes the story and checks the
 * stranger can see it once it is public, so the filter is proven to be a rule
 * about access and not simply "never return chapters".
 *
 *   node test/rag-access.js
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');

const API = 'http://localhost:4000/api';
const TAG = 'rag-access-test';
const p = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : '**FAIL**'}  ${label}${detail ? `  (${detail})` : ''}`);
};

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
  const r = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { cookie: `aw_refresh=${raw}` } });
  return (await r.json()).accessToken;
}

const auth = (t) => (t ? { authorization: `Bearer ${t}` } : {});
const json = (t) => ({ 'content-type': 'application/json', ...auth(t) });

(async () => {
  const users = await p.user.findMany({ where: { role: 'USER' }, orderBy: { createdAt: 'asc' } });
  const [owner, other] = users;
  if (!owner || !other) {
    console.log('SKIPPED: needs two non-admin users');
    process.exit(0);
  }
  const ownerT = await tokenFor(owner.id);
  const otherT = await tokenFor(other.id);

  // A word no real chapter contains, so a hit can only be this chapter.
  const marker = `zqxmarker${Date.now().toString(36)}`;
  const story = await (
    await fetch(`${API}/stories`, {
      method: 'POST',
      headers: json(ownerT),
      body: JSON.stringify({ title: `ZZ ${TAG}`, genres: ['kinh dị'] }),
    })
  ).json();
  const main = story.mainBranchId ?? story.branches?.[0]?.id;

  try {
    const text = `Căn phòng tối om. Trên tường có một chữ lạ: ${marker}. Không ai nhớ đã viết nó.`;
    const r = await fetch(`${API}/branches/${main}/contributions`, {
      method: 'POST',
      headers: json(ownerT),
      body: JSON.stringify({
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        textPlain: text,
        authorType: 'HUMAN',
      }),
    });
    check('owner commits a chapter to their private story', r.status === 201, `HTTP ${r.status}`);

    // Indexing happens after the commit returns.
    let indexed = false;
    for (let i = 0; i < 30 && !indexed; i++) {
      indexed = (await p.ragChunk.count({ where: { storyId: story.id } })) > 0;
      if (!indexed) await sleep(1000);
    }
    check('chapter was indexed', indexed);

    const ask = async (token, withStory = true) => {
      const qs = new URLSearchParams({ q: marker, kind: 'CHAPTER', ...(withStory ? { storyId: story.id } : {}) });
      const res = await fetch(`${API}/rag/search?${qs}`, { headers: auth(token) });
      if (res.status === 429) return { limited: true, hit: false };
      const rows = await res.json();
      return { hit: Array.isArray(rows) && rows.some((x) => x.text.includes(marker)) };
    };

    console.log('\n=== while the story is PRIVATE ===');
    let a = await ask(null);
    check('anonymous, by story id: nothing', !a.hit);
    a = await ask(null, false);
    check('anonymous, searching everything: nothing', !a.hit);
    a = await ask(otherT);
    check('another account: nothing', !a.hit);
    a = await ask(ownerT);
    check('the owner: finds their own chapter', a.hit);

    console.log('\n=== once it is PUBLIC ===');
    const pub = await fetch(`${API}/stories/${story.id}`, {
      method: 'PATCH',
      headers: json(ownerT),
      body: JSON.stringify({ visibility: 'PUBLIC', allowForks: true }),
    });
    check('owner publishes it', pub.status === 200, `HTTP ${pub.status}`);
    a = await ask(null);
    check('anonymous can now find it', a.hit);
  } finally {
    await fetch(`${API}/stories/${story.id}`, { method: 'DELETE', headers: auth(ownerT) });
    const gone = !(await p.story.findUnique({ where: { id: story.id } }));
    if (!gone) await p.story.delete({ where: { id: story.id } }).catch(() => {});
    await p.session.deleteMany({ where: { userAgent: TAG } });
    console.log(`\ncleanup: story removed (${gone ? 'via API' : 'directly'})`);
    await p.$disconnect();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('CRASHED:', e);
  process.exit(1);
});
