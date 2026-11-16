// R2 storage budget: refuses writes past R2_MAX_BYTES, treats an unmeasurable
// bucket as full, and counts its own writes between listings.
//
//   npx tsx --test test/r2-budget.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { R2Storage } = require('../src/storage/r2.storage');
const { StorageFullError } = require('../src/storage/storage-driver');

function make({ max, objects = [], listFails = false }) {
  const env = {
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET: 'b',
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_PUBLIC_BASE: 'https://pub.example/',
    R2_MAX_BYTES: String(max),
  };
  const r2 = new R2Storage({ get: (k, d) => env[k] ?? d });
  const calls = { list: 0, put: 0 };
  r2.client = {
    send: async (cmd) => {
      if (cmd.constructor.name === 'ListObjectsV2Command') {
        calls.list++;
        if (listFails) throw new Error('AccessDenied');
        // Two pages, to exercise pagination.
        const half = Math.ceil(objects.length / 2);
        return cmd.input.ContinuationToken
          ? { Contents: objects.slice(half).map((Size) => ({ Size })), IsTruncated: false }
          : { Contents: objects.slice(0, half).map((Size) => ({ Size })), IsTruncated: true, NextContinuationToken: 't' };
      }
      calls.put++;
      return {};
    },
  };
  r2.logger = { log() {}, error() {} };
  return { r2, calls };
}

test('stores while under budget and returns the public URL', async () => {
  const { r2, calls } = make({ max: 1000, objects: [100, 200] });
  const out = await r2.put('a.mp3', Buffer.alloc(300), 'audio/mpeg');
  assert.equal(out.url, 'https://pub.example/a.mp3');
  assert.equal(calls.put, 1);
});

test('refuses a write that would cross the budget, without uploading', async () => {
  const { r2, calls } = make({ max: 1000, objects: [400, 400] });
  await assert.rejects(r2.put('b.mp3', Buffer.alloc(300), 'audio/mpeg'), StorageFullError);
  assert.equal(calls.put, 0);
});

test('counts its own writes between listings', async () => {
  const { r2, calls } = make({ max: 1000, objects: [] });
  await r2.put('1', Buffer.alloc(600), 'x');
  const listed = calls.list;
  await assert.rejects(r2.put('2', Buffer.alloc(600), 'x'), StorageFullError);
  assert.equal(calls.list, listed, 'did not list again; trusted its own count');
});

test('an unmeasurable bucket counts as full', async () => {
  const { r2, calls } = make({ max: 1000, listFails: true });
  await assert.rejects(r2.put('c', Buffer.alloc(1), 'x'), StorageFullError);
  assert.equal(await r2.hasRoom(), false);
  assert.equal(calls.put, 0);
});

test('hasRoom wants space for a whole chapter, not just a byte', async () => {
  const roomy = make({ max: 9_000_000_000, objects: [1_000_000_000] });
  assert.equal(await roomy.r2.hasRoom(), true);
  const tight = make({ max: 9_000_000_000, objects: [8_995_000_000] });
  assert.equal(await tight.r2.hasRoom(), false);
});
