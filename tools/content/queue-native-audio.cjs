/* Queue the reviewed native collection through the app's existing Edge TTS
 * service. This process is a producer only: it starts no HTTP server/worker,
 * changes no shared concurrency, and leaves existing narration jobs alone.
 * Run after building the API and seeding the reviewed text manifest.
 */
require('reflect-metadata');
const { join, resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const root = resolve(__dirname, '../..');
const collection = process.argv.includes('--chinese') ? 'chinese-stories' : 'native-texts';
const producerOption = process.argv.find((arg) => arg.startsWith('--producer-concurrency='));
const producerConcurrency = Number(producerOption?.split('=')[1] ?? 1);
if (!Number.isInteger(producerConcurrency) || producerConcurrency < 1 || producerConcurrency > 8) {
  throw new Error('Producer concurrency must be an integer from 1 to 8.');
}
require('dotenv').config({ path: join(root, '.env'), quiet: true });
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const fromApi = (path) => require(join(root, 'apps/api/dist', path));
const { PrismaService } = fromApi('prisma/prisma.service');
const { CurrentUserService } = fromApi('auth/current-user.service');
const { PaywallService } = fromApi('stories/paywall.service');
const { StoriesService } = fromApi('stories/stories.service');
const { DomainEvents } = fromApi('events/domain-events');
const { QueueConnection } = fromApi('queue/queue-connection');
const { NarrationQueue } = fromApi('queue/narration.queue');
const { AudioEncoder } = fromApi('tts/audio-encoder');
const { TtsService } = fromApi('tts/tts.service');
const { LocalDiskStorage } = fromApi('storage/local-disk.storage');

Logger.overrideLogger(['error', 'warn']);
const config = new ConfigService({ ...process.env, TTS_DRIVER: 'edge', PRERENDER_CHAPTERS: 'all', AUTH_DEV_USER: 'false' });
const prisma = new PrismaService();
const current = new CurrentUserService(prisma, config);
const paywall = new PaywallService(prisma, current, config);
const events = new DomainEvents();
const stories = new StoriesService(prisma, current, paywall, events);
const connections = new QueueConnection(config);
const queue = new NarrationQueue(connections);
const tts = new TtsService(config, prisma, stories, paywall, current, queue, events, new AudioEncoder(config), new LocalDiskStorage());

// Independent books can be enqueued together without changing the worker's
// provider limits. Settle the whole batch before closing connections on error.
async function visitBatches(works, phase, visit) {
  for (let offset = 0; offset < works.length; offset += producerConcurrency) {
    const batch = works.slice(offset, offset + producerConcurrency);
    const results = await Promise.allSettled(batch.map(visit));
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, `Audio queueing failed during ${phase}`);
    const visited = offset + batch.length;
    if (Math.floor(offset / 50) !== Math.floor(visited / 50) || visited === works.length) {
      console.log(JSON.stringify({ phase, worksVisited: visited, total: works.length }));
    }
  }
}

async function main() {
  await prisma.$connect();
  queue.onModuleInit();
  await tts.onModuleInit();
  if (!tts.available) throw new Error('Edge TTS is not available.');
  const manifest = JSON.parse(readFileSync(join(root, `apps/api/prisma/${collection}/manifest.json`), 'utf8'));
  const works = manifest.keys.map((key) => JSON.parse(readFileSync(join(root, `apps/api/prisma/${collection}/${key}.json`), 'utf8')));
  if (process.argv.includes('--smoke')) {
    let work = works.filter((w) => w.chapters.length === 1 && w.wordCount >= 200).sort((a, b) => a.wordCount - b.wordCount)[0];
    let depth = 0;
    if (!work) {
      let shortest = Number.POSITIVE_INFINITY;
      for (const candidate of works) candidate.chapters.forEach((chapter, index) => {
        const count = chapter.text.trim().split(/\s+/u).length;
        if (count >= 200 && count < shortest) { shortest = count; work = candidate; depth = index; }
      });
    }
    if (!work) throw new Error('No suitable readable chapter for narration verification.');
    const ticket = await tts.enqueueChapter(work.branchId, depth, 'edge:vi-VN-HoaiMyNeural');
    console.log(JSON.stringify({ storyId: work.storyId, title: work.title, branchId: work.branchId, depth, ...ticket }));
    return;
  }
  // First chapters go into the bulk queue before the remaining chapters, so
  // the whole shelf gets a ready opening before a single long book finishes.
  await visitBatches(works, 'openings', async (work) => {
    const first = await prisma.contribution.findFirst({ where: { branchId: work.branchId, depth: 0 } });
    if (!first) throw new Error(`Seed the text before queueing audio: ${work.key}`);
    // prerenderChapter uses the same idempotent cache and bulk priority as a
    // newly published story; no interactive request is manufactured here.
    await tts.prerenderChapter(first.id);
  });
  await visitBatches(works, 'remaining-chapters', async (work) => {
    await tts.prerenderHead(work.storyId);
  });
  const branches = works.map((w) => w.branchId);
  const statuses = await prisma.renderJob.groupBy({ by: ['status'], where: { branchId: { in: branches }, voice: 'edge:vi-VN-HoaiMyNeural' }, _count: true });
  const clips = await prisma.audioClip.count({ where: { contribution: { branchId: { in: branches } }, voice: 'edge:vi-VN-HoaiMyNeural' } });
  console.log(JSON.stringify({ works: works.length, chapters: manifest.counts.chapters, clipsReady: clips, statuses }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await queue.onModuleDestroy();
  await connections.onModuleDestroy();
  await prisma.$disconnect();
});
