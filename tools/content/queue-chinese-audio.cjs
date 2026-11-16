/* Bulk producer for the reviewed 500-work import. Uses the existing durable
 * render rows and NarrationQueue; the existing worker still checks audio by
 * contribution and content before synthesizing. No worker/rate changes.
 */
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '../..');
require('dotenv').config({ path: join(root, '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const { QueueConnection } = require(join(root, 'apps/api/dist/queue/queue-connection'));
const { NarrationQueue } = require(join(root, 'apps/api/dist/queue/narration.queue'));
const { PRIORITY } = require(join(root, 'apps/api/dist/queue/queue.constants'));
Logger.overrideLogger(['error', 'warn']);
const prisma = new PrismaClient();
const connections = new QueueConnection(new ConfigService(process.env));
const queue = new NarrationQueue(connections);
const voice = 'edge:vi-VN-HoaiMyNeural';
const json = (name) => JSON.parse(readFileSync(join(root, 'apps/api/prisma/chinese-stories', name), 'utf8'));

function stableId(key) {
  const bytes = createHash('sha256').update(`audio-writer:chinese-stories:v1:${key}`).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function batches(items, size, visit) {
  for (let offset = 0; offset < items.length; offset += size) {
    const results = await Promise.allSettled(items.slice(offset, offset + size).map(visit));
    const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
    if (failures.length) throw new AggregateError(failures, 'Narration queue batch failed');
  }
}

async function main() {
  const manifest = json('manifest.json');
  assert.equal(manifest.target, 500);
  assert.equal(new Set(manifest.keys).size, 500);
  const works = manifest.keys.map((key) => {
    const work = json(`${key}.json`);
    assert.equal(work.storyId, stableId(key));
    assert.equal(work.branchId, stableId(`${key}:main`));
    assert.equal(work.rights.basis, 'OWNER_AUTHORIZATION');
    assert.equal(work.rights.confirmedAt, '2026-11-16');
    assert.equal(work.cleanupRuleset, 2);
    return { key, storyId: work.storyId, branchId: work.branchId, chapters: work.chapters.length };
  });
  const publicWorks = await prisma.story.findMany({ where: { id: { in: works.map((w) => w.storyId) } }, select: {
    id: true, mainBranchId: true, visibility: true, status: true, textSource: true,
    freeChapters: true, contributionCount: true, unlockPrice: true,
  } });
  assert.equal(publicWorks.length, 500);
  const byStory = new Map(publicWorks.map((row) => [row.id, row]));
  const expected = [];
  for (const work of works) {
    const row = byStory.get(work.storyId);
    assert.equal(row.mainBranchId, work.branchId);
    assert.equal(row.visibility, 'PUBLIC');
    assert.equal(row.status, 'COMPLETE');
    assert.equal(row.textSource.collectionId, 'chinese-drama');
    assert.equal(row.freeChapters, work.chapters);
    assert.equal(row.contributionCount, work.chapters);
    assert.equal(row.unlockPrice, 0);
    for (let depth = 0; depth < work.chapters; depth++) expected.push({
      id: stableId(`${work.key}:chapter:${depth}`), branchId: work.branchId, depth,
    });
  }
  assert.equal(expected.length, manifest.counts.chapters);
  const chapters = await prisma.contribution.findMany({ where: { branchId: { in: works.map((w) => w.branchId) } }, select: {
    id: true, branchId: true, depth: true, branch: { select: { isDraft: true } },
  } });
  assert.equal(chapters.length, expected.length);
  const byChapter = new Map(chapters.map((c) => [c.id, c]));
  for (const chapter of expected) {
    const actual = byChapter.get(chapter.id);
    assert(actual, `Missing reviewed chapter ${chapter.id}`);
    assert.equal(actual.branchId, chapter.branchId);
    assert.equal(actual.depth, chapter.depth);
    assert.equal(actual.branch.isDraft, false);
  }
  const chapterIds = expected.map((c) => c.id);
  const ready = new Set((await prisma.audioClip.findMany({ where: { voice, contributionId: { in: chapterIds } }, select: { contributionId: true } })).map((c) => c.contributionId));
  // Preserve manifest popularity order while putting every opening first.
  const ordered = [...expected.filter((c) => c.depth === 0), ...expected.filter((c) => c.depth > 0)];
  const pending = ordered.filter((c) => !ready.has(c.id));
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ works: works.length, chapters: expected.length, clipsReady: ready.size, pending: pending.length }));
    return;
  }
  let createdJobs = 0;
  for (let offset = 0; offset < pending.length; offset += 200) {
    const result = await prisma.renderJob.createMany({ skipDuplicates: true, data: pending.slice(offset, offset + 200).map((c) => ({
      id: randomUUID(), branchId: c.branchId, contributionId: c.id, userId: null,
      kind: 'AUDIO', status: 'QUEUED', voice, idempotencyKey: `audio:${c.id}:${voice}`,
    })) });
    createdJobs += result.count;
  }
  const rows = await prisma.renderJob.findMany({ where: { voice, contributionId: { in: chapterIds } }, select: {
    id: true, contributionId: true, branchId: true, kind: true, status: true, idempotencyKey: true,
  } });
  const byContribution = new Map(rows.map((row) => [row.contributionId, row]));
  // Refresh clips after the database batch: a worker or reader may have
  // finished an opening while the producer was creating the remaining rows.
  for (const c of await prisma.audioClip.findMany({ where: { voice, contributionId: { in: chapterIds } }, select: { contributionId: true } })) ready.add(c.contributionId);
  const todo = pending.filter((c) => !ready.has(c.id));
  for (const chapter of todo) {
    const row = byContribution.get(chapter.id);
    assert(row, `Missing durable narration row ${chapter.id}`);
    assert.equal(row.kind, 'AUDIO');
    assert.equal(row.branchId, chapter.branchId);
    assert.equal(row.idempotencyKey, `audio:${chapter.id}:${voice}`);
    // Never reopen/reset an existing running, finished or failed row here.
    assert(['QUEUED', 'RUNNING'].includes(row.status), `Use the normal reader retry for ${row.id}: ${row.status}`);
  }
  await batches(todo, 24, async (chapter) => {
    const row = byContribution.get(chapter.id);
    await queue.add({ contributionId: chapter.id, branchId: chapter.branchId, voice, renderJobId: row.id }, PRIORITY.BULK);
  });
  // Verify delivery as well as durable rows, without interrupting live work.
  await batches(todo, 24, async (chapter) => {
    const live = await queue.find(chapter.id, voice);
    assert(live, `Missing Redis narration job ${chapter.id}`);
    assert.equal(live.data.renderJobId, byContribution.get(chapter.id).id);
  });
  const clipsReady = await prisma.audioClip.count({ where: { voice, contributionId: { in: chapterIds } } });
  const statuses = await prisma.renderJob.groupBy({ by: ['status'], where: { voice, contributionId: { in: chapterIds } }, _count: true });
  console.log(JSON.stringify({ works: 500, chapters: expected.length, createdJobs, queueEnsured: todo.length, clipsReady, statuses }));
}

(async () => {
  queue.onModuleInit();
  try { await main(); }
  finally { await queue.onModuleDestroy(); await connections.onModuleDestroy(); await prisma.$disconnect(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
