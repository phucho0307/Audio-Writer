// Small WebP copies of the cover art, for grids.
//
//   node apps/web/scripts/make-thumbs.mjs
//
// A grid shows covers about 200 px wide, but the files behind them were up
// to 3 MB each - the Chinese shelf alone was 222 MB - so cards appeared one
// at a time as each download finished. This writes <dir>/thumbs/<name>.webp,
// 480 px wide (enough for a 2x screen), next to the originals, which stay
// for anywhere a cover is shown large. Skips thumbnails newer than their
// source, so it is cheap to run again after adding covers.
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const DIRS = ['chinese-covers', 'author-covers', 'covers'];
const WIDTH = 480;

let made = 0;
let skipped = 0;
let before = 0;
let after = 0;

for (const dir of DIRS) {
  const src = join(PUBLIC, dir);
  const out = join(src, 'thumbs');
  let names;
  try {
    names = (await readdir(src)).filter((n) => /\.(jpe?g|png|webp)$/i.test(n));
  } catch {
    continue;
  }
  await mkdir(out, { recursive: true });

  for (const name of names) {
    const from = join(src, name);
    const to = join(out, `${parse(name).name}.webp`);
    const s = await stat(from);
    const t = await stat(to).catch(() => null);
    if (t && t.mtimeMs >= s.mtimeMs) {
      skipped++;
      continue;
    }
    await sharp(from)
      .rotate()
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(to);
    before += s.size;
    after += (await stat(to)).size;
    made++;
  }
}

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`${made} thumbnails made (${mb(before)} MB -> ${mb(after)} MB), ${skipped} already up to date`);
