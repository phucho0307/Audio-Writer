/**
 * Queue narration for every chapter that has none in the default voice.
 *
 *   npm run build && node --use-system-ca dist/scripts/narrate-all.js
 *
 * From the built output, not tsx: Nest resolves services from decorator
 * metadata, which esbuild does not emit, so under tsx nothing can be injected.
 *
 * Only enqueues. The running API's worker does the synthesis, at bulk
 * priority, so a reader pressing play still goes first. Safe to run again:
 * chapters that already have audio (or whose exact words do) are skipped.
 *
 * Boots the app without its worker, prerender listener or collab server, so
 * it can run beside the live API.
 */
process.env.RUN_WORKER = 'false';
process.env.COLLAB_ENABLED = 'false';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TtsService } from '../tts/tts.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const tts = app.get(TtsService);
    const { voices, default: voice } = tts.voices();
    if (!tts.available) throw new Error('no TTS driver is configured');
    console.log(`voice: ${voice} (${voices.length} on offer)`);
    const r = await tts.backfillAll();
    console.log(`${r.chapters} chapters, ${r.queued} queued, ${r.chapters - r.queued} already had audio`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
