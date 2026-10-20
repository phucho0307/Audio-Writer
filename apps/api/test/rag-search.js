/**
 * Indexes the craft corpus, then asks it the kind of question a continuation
 * would ask. Checks that both halves of the hybrid search pull their weight.
 */
require('dotenv').config({ path: '../../.env', quiet: true });
const API = 'http://localhost:4000/api';
const ok = (b) => (b ? 'PASS' : '**FAIL**');

(async () => {
  const idx = await (await fetch(`${API}/rag/reindex`, { method: 'POST' })).json();
  console.log('indexed:', JSON.stringify(idx));

  const stats = await (await fetch(`${API}/rag/stats`)).json();
  console.log('stats  :', JSON.stringify(stats));
  console.log('  every chunk embedded:', ok(stats.embedded === stats.craft + stats.chapter), '\n');

  const queries = [
    ['kết chương ở đâu để người ta nghe tiếp', null],
    ['phát hiện chồng ngoại tình qua đồ vật nhỏ', 'INFIDELITY'],
    ['mở đầu truyện ma thế nào cho tự nhiên', 'HORROR'],
    ['đánh nhau trong hẻm ban đêm', 'ACTION'],
  ];

  for (const [q, genre] of queries) {
    const url = `${API}/rag/search?q=${encodeURIComponent(q)}${genre ? `&genre=${genre}` : ''}`;
    const hits = await (await fetch(url)).json();
    console.log(`"${q}"${genre ? ` [${genre}]` : ''}`);
    if (!Array.isArray(hits)) { console.log('  ERROR', JSON.stringify(hits).slice(0, 200)); continue; }
    hits.slice(0, 3).forEach((h) =>
      console.log(`   ${h.score.toFixed(4)}  ${h.label}`),
    );
    console.log('   returned:', ok(hits.length > 0), `${hits.length} passages`);
    if (genre) console.log('   genre respected:', ok(hits.every((h) => h.genre === genre || h.genre === null)));
    console.log();
  }

  // A rate limit is not a retrieval failure, and reporting it as one sent me
  // looking for a bug in the index that was never there.
  async function search(q) {
    const res = await fetch(`${API}/rag/search?q=${encodeURIComponent(q)}`);
    if (res.status === 429) return { throttled: true, hits: [] };
    return { throttled: false, hits: await res.json() };
  }

  // Lexical half: a rare exact word the embedding may not place.
  const rare = await search('bùa ngải');
  console.log(
    'rare word "bùa ngải" found:',
    rare.throttled ? 'SKIPPED (rate limited)' : ok(rare.hits.length > 0),
    rare.throttled ? '' : `${rare.hits.length} hits`,
  );

  // Unaccented spelling should reach the same place.
  const noTone = await search('bua ngai');
  console.log(
    'without tones finds it too:',
    noTone.throttled ? 'SKIPPED (rate limited)' : ok(noTone.hits.length > 0),
  );
  if (!rare.throttled && !noTone.throttled) {
    // Overlap, not identical order. The lexical half unaccents both queries, but
    // the dense half embeds the raw string, so dropping tones genuinely changes
    // the semantic ranking. Expecting the same top hit was testing a property
    // hybrid search does not have.
    const ids = new Set(rare.hits.map((h) => h.id));
    const shared = noTone.hits.filter((h) => ids.has(h.id)).length;
    console.log('  both reach the same material:', ok(shared > 0), `${shared} shared passage(s)`);
  }
})();
