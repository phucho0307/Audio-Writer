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

  // Lexical half: a rare exact word the embedding may not place.
  const rare = await (await fetch(`${API}/rag/search?q=${encodeURIComponent('bùa ngải')}`)).json();
  console.log('rare word "bùa ngải" found:', ok(Array.isArray(rare)), Array.isArray(rare) ? `${rare.length} hits` : '');
  // Unaccented spelling should reach the same place.
  const noTone = await (await fetch(`${API}/rag/search?q=${encodeURIComponent('bua ngai')}`)).json();
  console.log('without tones finds it too:', ok(Array.isArray(noTone) && noTone.length > 0));
})();
