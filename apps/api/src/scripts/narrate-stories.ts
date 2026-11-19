/**
 * Narrate the opening chapter(s) of the stories named, in the default voice,
 * ahead of anyone pressing play.
 *
 *   npm run build && node --use-system-ca dist/scripts/narrate-stories.js <storyId> [...]
 *   CHAPTERS=2 node ... # the first two chapters of each instead of one
 *
 * For the shelf a new visitor sees first: everything else is narrated when a
 * reader asks for it, which on a small server means waiting a minute or two
 * for the first chapter. Doing that for the whole library ahead of time was
 * five days of synthesis for chapters most of which nobody may open.
 *
 * Only enqueues; the running API's worker does the synthesis. Safe to run
 * again: chapters that already have audio are skipped.
 */
process.env.RUN_WORKER = 'false';
process.env.COLLAB_ENABLED = 'false';
process.env.RAG_BACKFILL_ON_BOOT = 'false';
process.env.RAG_INDEX_ON_COMMIT = 'false';
// Read when TtsService is constructed, so it is set before the app boots.
process.env.PRERENDER_CHAPTERS = process.env.CHAPTERS || '1';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TtsService } from '../tts/tts.service';

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('usage: narrate-stories <storyId> [...]');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const tts = app.get(TtsService);
    if (!tts.available) throw new Error('no TTS driver is configured');
    console.log(`voice: ${tts.voices().default}`);
    let queued = 0;
    for (const id of ids) queued += await tts.prerenderHead(id);
    console.log(`${ids.length} stories, ${queued} chapters queued`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
