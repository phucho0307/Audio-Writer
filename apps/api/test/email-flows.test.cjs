// Verification and password-reset links: single use, expiring, hashed at
// rest, and a reset signs out every session.
//
//   npx tsx --test test/email-flows.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { EmailFlowsService } = require('../src/auth/email-flows.service');

function fakeRedis() {
  const kv = new Map();
  const counts = new Map();
  const client = {
    get: async (k) => kv.get(k) ?? null,
    getdel: async (k) => { const v = kv.get(k) ?? null; kv.delete(k); return v; },
    del: async (k) => kv.delete(k),
    multi() {
      const ops = [];
      const tx = {
        del: (k) => (ops.push(() => kv.delete(k)), tx),
        set: (k, v) => (ops.push(() => kv.set(k, v)), tx),
        exec: async () => ops.forEach((f) => f()),
      };
      return tx;
    },
  };
  return { kv, client, incrementWindow: async (k) => { counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k); } };
}

function world() {
  const user = { id: 'u1', email: 'lan@example.com', displayName: 'Lan', emailVerifiedAt: null, passwordHash: null };
  const prisma = {
    user: {
      findUnique: async ({ where }) => (where.email === user.email ? user : null),
      update: async ({ data }) => Object.assign(user, data),
    },
  };
  const sent = [];
  const mail = { send: async (m) => (sent.push(m), true) };
  const revoked = [];
  const tokens = { revokeAllFor: async (id) => revoked.push(id) };
  const redis = fakeRedis();
  const config = { get: (_k, d) => d };
  const svc = new EmailFlowsService(config, prisma, redis, mail, tokens);
  const linkToken = () => new URL(sent.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  return { svc, user, sent, revoked, redis, linkToken };
}

test('verification link works once, and only its hash is stored', async () => {
  const w = world();
  await w.svc.sendVerification(w.user);
  const token = w.linkToken();
  assert.ok(![...w.redis.kv.keys(), ...w.redis.kv.values()].some((x) => String(x).includes(token)), 'raw token not stored');
  await w.svc.verify(token);
  assert.ok(w.user.emailVerifiedAt);
  await assert.rejects(w.svc.verify(token), (e) => e.getResponse().code === 'LINK_INVALID');
});

test('a new link retires the previous one', async () => {
  const w = world();
  await w.svc.sendVerification(w.user);
  const first = w.linkToken();
  await w.svc.sendVerification(w.user);
  await assert.rejects(w.svc.verify(first));
  await w.svc.verify(w.linkToken());
});

test('forgot password answers the same for an unknown address and sends nothing', async () => {
  const w = world();
  await w.svc.forgot('nobody@example.com');
  assert.equal(w.sent.length, 0);
  await w.svc.forgot(' LAN@example.com ');
  assert.equal(w.sent.length, 1);
});

test('reset sets the password, verifies the address and signs out everywhere', async () => {
  const w = world();
  await w.svc.forgot('lan@example.com');
  await w.svc.reset(w.linkToken(), 'mat-khau-moi-1');
  assert.ok(await argon2.verify(w.user.passwordHash, 'mat-khau-moi-1'));
  assert.ok(w.user.emailVerifiedAt);
  assert.deepEqual(w.revoked, ['u1']);
});

test('no more than three of one kind of mail an hour', async () => {
  const w = world();
  for (let i = 0; i < 3; i++) await w.svc.sendVerification(w.user);
  await assert.rejects(w.svc.sendVerification(w.user), (e) => e.getResponse().code === 'MAIL_LIMIT');
  for (let i = 0; i < 5; i++) await w.svc.forgot('lan@example.com');
  assert.equal(w.sent.filter((m) => m.subject.includes('Đặt lại')).length, 3);
});
