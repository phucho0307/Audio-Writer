// The public shelf cache: answered from the stored copy, rebuilt behind the
// reader, and never marked fresh by a rebuild that raced a write.
//
//   npx tsx --test test/shelf-cache.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShelfCache } = require('../src/stories/shelf-cache');

function world() {
  const kv = new Map();
  const redis = {
    client: {
      mget: async (...keys) => keys.map((k) => kv.get(k) ?? null),
      set: async (k, v) => (kv.set(k, v), 'OK'),
      del: async (k) => kv.delete(k),
    },
  };
  let rows = [{ id: 'a', title: 'A' }];
  let builds = 0;
  let gate = null; // when set, findMany waits on it
  const prisma = {
    story: {
      findMany: async () => {
        builds++;
        const snapshot = JSON.parse(JSON.stringify(rows));
        if (gate) await gate;
        return snapshot;
      },
    },
  };
  const handlers = {};
  const events = { on: (name, fn) => (handlers[name] = fn) };
  const cache = new ShelfCache(prisma, redis, events);
  cache.onApplicationBootstrap();
  return {
    cache, kv, handlers,
    builds: () => builds,
    setRows: (r) => (rows = r),
    hold: () => { let open; gate = new Promise((r) => (open = r)); return () => { gate = null; open(); }; },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('built once, then answered from the stored copy', async () => {
  const w = world();
  assert.equal(await w.cache.json(), '[{"id":"a","title":"A"}]');
  await w.cache.json();
  await w.cache.json();
  assert.equal(w.builds(), 1);
});

test('after a change the reader gets the old copy at once and the new one next', async () => {
  const w = world();
  await w.cache.json();
  w.setRows([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  const release = w.hold();
  await w.handlers['story.published']({ storyId: 'b' });
  // The rebuild is still reading the database: nobody waits for it.
  assert.equal(await w.cache.json(), '[{"id":"a","title":"A"}]');
  release();
  await settle();
  assert.match(await w.cache.json(), /"id":"b"/);
});

test('a write that lands during a rebuild is not lost', async () => {
  const w = world();
  await w.cache.json();
  const release = w.hold();
  await w.handlers['story.changed']({ storyId: 'a' }); // rebuild 1 starts, snapshots [a]
  w.setRows([{ id: 'c', title: 'C' }]);
  await w.handlers['story.changed']({ storyId: 'c' }); // lands mid-rebuild
  release();
  await settle();
  assert.equal(await w.cache.json(), '[{"id":"c","title":"C"}]');
  assert.equal(w.kv.get('shelf:public:v1:fresh'), '1');
});

test('many readers at once cause one rebuild', async () => {
  const w = world();
  const release = w.hold();
  const all = Promise.all([w.cache.json(), w.cache.json(), w.cache.json()]);
  release();
  await all;
  assert.equal(w.builds(), 1);
});

test('Redis down: the shelf still loads, from the database', async () => {
  const w = world();
  w.cache.redis.client.mget = async () => { throw new Error('down'); };
  assert.equal(await w.cache.json(), '[{"id":"a","title":"A"}]');
});
