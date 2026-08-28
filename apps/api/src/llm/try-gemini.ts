/**
 * Manual smoke test for the Gemini driver. Temporary - delete once the
 * generation endpoints exist and can be exercised through the API.
 *
 *   npx dotenv -e ../../.env -- npx tsx src/llm/try-gemini.ts
 */
import type { PlotOption, SeedRequest, SuggestRequest } from '@aw/shared';
import { GeminiDriver } from './drivers/gemini.driver';

async function main() {
  const driver = new GeminiDriver(
    process.env.GEMINI_API_KEY ?? '',
    process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  );

  console.log(`driver: ${driver.name} / ${driver.model}`);
  console.log(`configured: ${driver.isConfigured()}\n`);

  // --- 1. seed: streaming prose -------------------------------------------
  console.log('═══ MODE: seed (streaming) ═══');
  const seed: SeedRequest = {
    mode: 'seed',
    genres: ['ngoại tình', 'kinh dị'],
    language: 'vi',
    pov: 'third_limited',
    paragraphs: 1,
  };

  const t0 = Date.now();
  let firstChunkAt = 0;
  let chunks = 0;
  let text = '';

  for await (const piece of driver.streamProse(seed)) {
    if (!firstChunkAt) firstChunkAt = Date.now() - t0;
    chunks++;
    text += piece;
  }

  console.log(`time to first chunk: ${firstChunkAt}ms`);
  console.log(
    `chunks: ${chunks}   total: ${Date.now() - t0}ms   chars: ${text.length}\n`,
  );
  console.log(text.trim());

  // --- 2. suggest: structured JSON ----------------------------------------
  console.log('\n\n═══ MODE: suggest (structured) ═══');
  const suggest: SuggestRequest = {
    mode: 'suggest',
    language: 'vi',
    storySoFar: text.trim(),
    count: 4,
  };

  const t1 = Date.now();
  const res = await driver.generateJson<{ options: PlotOption[] }>(suggest);
  console.log(`time: ${Date.now() - t1}ms`);
  console.log(
    `usage: in=${res.usage?.inputTokens} out=${res.usage?.outputTokens}\n`,
  );

  res.value.options.forEach((o, i) => {
    console.log(`── option ${i + 1}: ${o.title}   [${o.tone}]`);
    console.log(`   ${o.pitch}`);
    console.log(`   mở đầu: "${o.firstLine}"\n`);
  });
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
