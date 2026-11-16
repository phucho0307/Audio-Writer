const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
require('reflect-metadata');
require('dotenv').config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { NarrationQueue } = require('../dist/queue/narration.queue');
const { PRIORITY } = require('../dist/queue/queue.constants');

function job() {
  return { contributionId: randomUUID(), branchId: randomUUID(), renderJobId: randomUUID(), voice: 'edge:vi-VN-HoaiMyNeural' };
}

async function isolatedQueue(run) {
  const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const name = `test-narration-priority-${randomUUID()}`;
  const queue = new Queue(name, { connection });
  const service = new NarrationQueue({});
  // Use a uniquely owned test queue; no production queue is drained/consumed.
  service.queue = queue;
  try { await run(service, queue); }
  finally {
    assert(name.startsWith('test-narration-priority-'));
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  }
}

test('pressing play promotes the same waiting bulk job without a duplicate', async () => {
  await isolatedQueue(async (service, queue) => {
    const data = job();
    const id = await service.add(data, PRIORITY.BULK);
    assert.equal((await queue.getJob(id)).priority, PRIORITY.BULK);
    assert.equal(await service.add(data, PRIORITY.INTERACTIVE), id);
    const promoted = await queue.getJob(id);
    assert.equal(promoted.priority, PRIORITY.INTERACTIVE);
    assert.deepEqual(promoted.data, data);
    assert.equal(await queue.getJobCountByTypes('prioritized', 'waiting'), 1);
  });
});

test('background prefetch never demotes an interactive job', async () => {
  await isolatedQueue(async (service, queue) => {
    const data = job();
    const id = await service.add(data, PRIORITY.INTERACTIVE);
    await service.add(data, PRIORITY.BULK);
    assert.equal((await queue.getJob(id)).priority, PRIORITY.INTERACTIVE);
    assert.equal(await queue.getJobCountByTypes('prioritized', 'waiting'), 1);
  });
});

test('an active synthesis keeps its existing job and is never restarted', async () => {
  const service = new NarrationQueue({});
  let reprioritized = false;
  service.queue = { getJob: async () => ({
    priority: PRIORITY.BULK,
    getState: async () => 'active',
    changePriority: async () => { reprioritized = true; },
    remove: async () => { throw new Error('must not remove active work'); },
  }) };
  const data = job();
  const id = await service.add(data, PRIORITY.INTERACTIVE);
  assert(id.startsWith(`audio-${data.contributionId}-`));
  assert.equal(reprioritized, false);
});
