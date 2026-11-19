// The two pure halves of taking payment by bank transfer: proving a webhook
// came from SePay, and finding the order code in what a bank did to the
// transfer description.
//
//   npx tsx --test test/premium-payments.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { sepayAuthentic } = require('../src/premium/sepay-signature');
const { orderCodeCandidates, newOrderCode, CODE_PATTERN, isPremium } = require('../src/premium/premium');

const body = Buffer.from('{"id":92704,"transferType":"in","transferAmount":15000,"content":"NBK7Q2XM"}');
const secret = 'test-secret';
const now = 1_800_000_000;
const sign = (ts, raw = body, key = secret) =>
  'sha256=' + createHmac('sha256', key).update(`${ts}.`).update(raw).digest('hex');
const hmac = (headers, extra = {}) =>
  sepayAuthentic({ secret, apiKey: '', rawBody: body, headers, nowSec: now, ...extra });

test('a correctly signed webhook is accepted', () => {
  assert.equal(hmac({ 'x-sepay-signature': sign(now), 'x-sepay-timestamp': String(now) }), true);
});

test('a forged, altered or replayed webhook is refused', () => {
  assert.equal(hmac({ 'x-sepay-signature': sign(now, body, 'wrong'), 'x-sepay-timestamp': String(now) }), false, 'wrong key');
  const altered = Buffer.from(body.toString().replace('15000', '15000000'));
  assert.equal(hmac({ 'x-sepay-signature': sign(now), 'x-sepay-timestamp': String(now) }, { rawBody: altered }), false, 'amount changed');
  assert.equal(hmac({ 'x-sepay-signature': sign(now - 301), 'x-sepay-timestamp': String(now - 301) }), false, 'too old');
  assert.equal(hmac({ 'x-sepay-timestamp': String(now) }), false, 'no signature');
  assert.equal(hmac({}), false, 'no headers');
});

test('API key mode checks the Authorization header', () => {
  const key = (h) => sepayAuthentic({ secret: '', apiKey: 'k123', rawBody: body, headers: h });
  assert.equal(key({ authorization: 'Apikey k123' }), true);
  assert.equal(key({ authorization: 'Apikey k124' }), false);
  assert.equal(key({ authorization: 'Bearer k123' }), false);
  assert.equal(key({}), false);
});

test('with nothing configured, nothing is accepted', () => {
  assert.equal(sepayAuthentic({ secret: '', apiKey: '', rawBody: body, headers: { authorization: 'Apikey ' } }), false);
});

test('order codes survive what banks do to the description', () => {
  assert.deepEqual(orderCodeCandidates('NBK7Q2XM'), ['NBK7Q2XM']);
  assert.deepEqual(orderCodeCandidates('nguyen van a chuyen tien nbk7q2xm'), ['NBK7Q2XM']);
  assert.ok(orderCodeCandidates('MBVCB.123.NB K7Q2-XM.CT tu 0123').includes('NBK7Q2XM'));
  assert.deepEqual(orderCodeCandidates('chuyen tien an trua'), []);
  // SePay's own extracted code field is tried first.
  assert.equal(orderCodeCandidates('NBAAAAAA', 'x NBK7Q2XM')[0], 'NBAAAAAA');
});

test('new codes match the pattern and avoid look-alike characters', () => {
  for (let i = 0; i < 500; i++) {
    const c = newOrderCode(randomBytes);
    assert.match(c, new RegExp(`^${CODE_PATTERN.source}$`));
    assert.doesNotMatch(c.slice(2), /[01OIL]/);
  }
});

test('premium is active only while the end date is in the future', () => {
  assert.equal(isPremium(null), false);
  assert.equal(isPremium({ premiumUntil: null }), false);
  assert.equal(isPremium({ premiumUntil: new Date(Date.now() - 1000) }), false);
  assert.equal(isPremium({ premiumUntil: new Date(Date.now() + 60_000) }), true);
});
