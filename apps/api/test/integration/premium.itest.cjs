// Premium payments against a real Postgres: the duplicate-delivery guard is a
// unique index and the split-payment sum is a row lock, neither of which a
// fake can be trusted to reproduce.
//
// Throwaway database only - this file creates and deletes rows.
//
//   ITEST_DATABASE_URL=postgresql://user:pass@localhost:5432/aw_itest \
//     npx tsx --test test/integration/premium.itest.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const url = process.env.ITEST_DATABASE_URL;
const skip = !url && 'ITEST_DATABASE_URL is not set';
if (url && !/localhost|127\.0\.0\.1/.test(url)) throw new Error('ITEST_DATABASE_URL must be a local throwaway database');

const { PremiumService } = require('../../src/premium/premium.service');
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;

const config = (over = {}) => ({
  get: (k, d) =>
    ({ BANK_CODE: 'ACB', BANK_ACCOUNT_NO: '123456', BANK_ACCOUNT_NAME: 'NGUYEN VAN A', PREMIUM_PRICE: 15000, PREMIUM_DAYS: 30, REQUIRE_VERIFIED_EMAIL: 'false', ...over })[k] ?? d,
});

let me = null;
const currentUser = {
  current: async () => prisma.user.findUniqueOrThrow({ where: { id: me.id } }),
  optional: async () => (me ? prisma.user.findUnique({ where: { id: me.id } }) : null),
};
const users = [];
async function person(role = 'USER') {
  const id = randomUUID();
  const u = await prisma.user.create({ data: { id, email: `${id}@itest.local`, handle: `p${id.slice(0, 8)}`, displayName: 'P', role } });
  users.push(u.id);
  return u;
}
let svc;
const transfer = (code, amount, id = randomUUID()) => ({ id, transferType: 'in', transferAmount: amount, content: `NGUYEN VAN A chuyen tien ${code}`, referenceCode: 'FT1' });
const until = async (u) => (await prisma.user.findUnique({ where: { id: u.id } })).premiumUntil;
const DAY = 86_400_000;

before(async () => { if (!skip) svc = new PremiumService(config(), prisma, currentUser); });
after(async () => {
  if (skip) return;
  await prisma.bankTransfer.deleteMany({ where: { OR: [{ order: { userId: { in: users } } }, { content: { contains: 'ITEST' } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test('a paid transfer grants 30 days, and a redelivery grants nothing more', { skip }, async () => {
  me = await person();
  const order = await svc.createOrder();
  assert.match(order.qrUrl, /acc=123456/);
  assert.equal((await svc.createOrder()).code, order.code, 'reloading the page keeps the same code');

  const t = transfer(order.code.toLowerCase(), 15000);
  assert.equal(await svc.receive(t), 'PAID');
  const first = await until(me);
  assert.ok(Math.abs(first.getTime() - (Date.now() + 30 * DAY)) < 60_000);

  assert.equal(await svc.receive(t), 'duplicate');
  assert.equal((await until(me)).getTime(), first.getTime());
  assert.equal((await svc.order(order.code)).status, 'PAID');
});

test('a second month extends from the current end, not from today', { skip }, async () => {
  me = await person();
  await svc.receive(transfer((await svc.createOrder()).code, 15000));
  const end1 = await until(me);
  // A fresh order: the first is no longer pending.
  const o2 = await svc.createOrder();
  await svc.receive(transfer(o2.code, 15000));
  assert.ok(Math.abs((await until(me)).getTime() - (end1.getTime() + 30 * DAY)) < 5_000);
});

test('a short payment is held, and the rest completes it', { skip }, async () => {
  me = await person();
  const o = await svc.createOrder();
  assert.equal(await svc.receive(transfer(o.code, 10000)), 'UNDERPAID');
  assert.equal(await until(me), null);
  assert.equal(await svc.receive(transfer(o.code, 5000)), 'PAID');
  assert.ok(await until(me));
});

test('two halves arriving at once are both counted', { skip }, async () => {
  me = await person();
  const o = await svc.createOrder();
  const r = await Promise.all([svc.receive(transfer(o.code, 7500)), svc.receive(transfer(o.code, 7500))]);
  assert.deepEqual(r.sort(), ['PAID', 'UNDERPAID']);
  const row = await prisma.premiumOrder.findUnique({ where: { code: o.code } });
  assert.equal(row.paidAmount, 15000);
});

test('outgoing and code-less transfers grant nothing; the latter is kept for the admin', { skip }, async () => {
  me = await person();
  assert.equal(await svc.receive({ ...transfer('x', 15000), transferType: 'out' }), 'ignored');
  const id = randomUUID();
  assert.equal(await svc.receive({ id, transferType: 'in', transferAmount: 15000, content: 'ITEST chuyen tien quen ma' }), 'unmatched');
  const kept = await prisma.bankTransfer.findUnique({ where: { sepayId: id } });
  assert.equal(kept.orderId, null);

  // The owner attaches it by hand, once.
  const o = await svc.createOrder();
  me = await person('ADMIN');
  await svc.adminActivate(o.code, kept.id);
  await assert.rejects(svc.adminActivate(o.code), /kích hoạt rồi/);
  const row = await prisma.premiumOrder.findUnique({ where: { code: o.code } });
  assert.equal(row.status, 'PAID');
  assert.equal(row.paidAmount, 15000);
});

test('only an admin sees payments', { skip }, async () => {
  me = await person();
  await assert.rejects(svc.adminList());
  me = await person('ADMIN');
  const list = await svc.adminList();
  assert.ok(list.paidCount >= 1);
});

test('nothing is sold until a bank account is configured', { skip }, async () => {
  const off = new PremiumService(config({ BANK_ACCOUNT_NO: '' }), prisma, currentUser);
  me = await person();
  assert.equal((await off.status()).enabled, false);
  await assert.rejects(off.createOrder(), /chưa mở bán/);
});
