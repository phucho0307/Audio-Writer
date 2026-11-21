// Names that pass for the site or its staff, and real names that must not.
//
//   npx tsx --test test/impersonation.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksOfficial, reservedHandle } = require('../src/users/impersonation');
const { AuthService } = require('../src/auth/auth.service');

test('the brand and staff titles are caught however they are written', () => {
  for (const name of [
    'Nhịp Bút', 'NHIP BUT', 'nhip.but', 'Nhịp Bút Official', 'Admin', 'admin2', 'Ban Quản Trị',
    'Quản trị viên', 'Hỗ trợ Nhịp Bút', 'Moderator', 'support', 'AudioWriter',
  ]) {
    assert.equal(looksOfficial(name), true, name);
  }
});

test('ordinary Vietnamese names are left alone', () => {
  for (const name of [
    'Hồ Trọng', 'Nguyễn Văn An', 'Badminton Girl', 'Lan', 'Phúc', 'Trị An', 'Quân', 'Mọt truyện', 'Bút chì',
  ]) {
    assert.equal(looksOfficial(name), false, name);
  }
});

test('handles: the exact list and anything official-looking', () => {
  for (const h of ['admin', 'api', 'me', 'nhip_but', 'nhipbut_vn', 'admin_1']) assert.equal(reservedHandle(h), true, h);
  for (const h of ['lan', 'ho_trong', 'badminton']) assert.equal(reservedHandle(h), false, h);
});

function world() {
  const rows = [];
  const match = (where) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  const prisma = {
    user: {
      findUnique: async ({ where }) => match(where) ?? null,
      create: async ({ data }) => { const u = { id: `u${rows.length + 1}`, ...data }; rows.push(u); return u; },
      update: async ({ where, data }) => Object.assign(match(where), data),
    },
    session: { updateMany: async () => ({ count: 0 }) },
  };
  return new AuthService(prisma);
}

test('signing up as "Admin" is refused', async () => {
  await assert.rejects(
    world().register({ email: 'x@example.com', password: 'mat-khau-dai', displayName: 'Admin' }),
    (e) => e.getResponse().code === 'NAME_RESERVED',
  );
});

test('an official-looking email does not become the handle either', async () => {
  const u = await world().register({ email: 'admin@example.com', password: 'mat-khau-dai', displayName: '' });
  assert.notEqual(u.handle, 'admin');
  assert.equal(reservedHandle(u.handle), false);
});

test('a Google account named "Nhịp Bút" gets its address as a name instead', async () => {
  const u = await world().fromGoogle({ googleSub: 's', email: 'lan@gmail.com', emailVerified: true, displayName: 'Nhịp Bút' });
  assert.equal(u.displayName, 'lan');
  assert.equal(reservedHandle(u.handle), false);
});
