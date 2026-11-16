// Email and password accounts: sign-up, sign-in, and the Google link that
// must not leave an unverified password behind.
//
//   npx tsx --test test/password-auth.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../src/auth/auth.service');

function world(users = []) {
  const rows = users.map((u) => ({ avatarUrl: null, ...u }));
  const match = (where) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  const prisma = {
    user: {
      findUnique: async ({ where }) => match(where) ?? null,
      create: async ({ data }) => { const u = { id: `u${rows.length + 1}`, ...data }; rows.push(u); return u; },
      update: async ({ where, data }) => Object.assign(match(where), data),
    },
  };
  return { svc: new AuthService(prisma), rows };
}

test('sign up stores a hash, never the password, and the email lower-cased', async () => {
  const w = world();
  const u = await w.svc.register({ email: ' Lan@Example.com ', password: 'mat-khau-dai', displayName: 'Lan' });
  assert.equal(u.email, 'lan@example.com');
  assert.match(u.passwordHash, /^\$argon2id\$/);
  assert.ok(!JSON.stringify(u).includes('mat-khau-dai'));
  assert.equal(u.handle, 'lan');
});

test('then signs in with the right password, any case of email', async () => {
  const w = world();
  await w.svc.register({ email: 'lan@example.com', password: 'mat-khau-dai', displayName: 'Lan' });
  const u = await w.svc.login({ email: 'LAN@example.com', password: 'mat-khau-dai' });
  assert.equal(u.email, 'lan@example.com');
});

test('wrong password, unknown email and Google-only account all fail the same way', async () => {
  const w = world([{ id: 'g', email: 'g@example.com', handle: 'g', googleSub: 'sub', passwordHash: null }]);
  await w.svc.register({ email: 'lan@example.com', password: 'mat-khau-dai', displayName: 'Lan' });
  for (const attempt of [
    { email: 'lan@example.com', password: 'sai-mat-khau' },
    { email: 'nobody@example.com', password: 'mat-khau-dai' },
    { email: 'g@example.com', password: 'mat-khau-dai' },
  ]) {
    await assert.rejects(w.svc.login(attempt), (e) => e.getResponse().code === 'INVALID_CREDENTIALS');
  }
});

test('a taken email says which way to sign in', async () => {
  const w = world([{ id: 'g', email: 'g@example.com', handle: 'g', googleSub: 'sub', passwordHash: null }]);
  await assert.rejects(
    w.svc.register({ email: 'g@example.com', password: 'mat-khau-dai', displayName: 'G' }),
    (e) => e.getResponse().code === 'EMAIL_USES_GOOGLE',
  );
  await w.svc.register({ email: 'lan@example.com', password: 'mat-khau-dai', displayName: 'Lan' });
  await assert.rejects(
    w.svc.register({ email: 'lan@example.com', password: 'khac-hoan-toan', displayName: 'X' }),
    (e) => e.getResponse().code === 'EMAIL_TAKEN',
  );
});

test('Google arriving on an email someone registered drops that unverified password', async () => {
  const w = world();
  // A squatter registers the victim's address with a password they know ...
  await w.svc.register({ email: 'victim@gmail.com', password: 'squatter-pass', displayName: 'X' });
  // ... the real owner signs in with Google ...
  const u = await w.svc.fromGoogle({ googleSub: 'real', email: 'victim@gmail.com', emailVerified: true, displayName: 'V' });
  assert.equal(u.passwordHash, null);
  // ... and the squatter's password no longer opens the account.
  await assert.rejects(w.svc.login({ email: 'victim@gmail.com', password: 'squatter-pass' }));
});
