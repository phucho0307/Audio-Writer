/**
 * Upload the cover art that ships in apps/web/public to R2, under the same
 * paths, so the web app can point NEXT_PUBLIC_MEDIA_BASE at the bucket and
 * stop carrying ~350 MB of images.
 *
 *   npx dotenv -e ../../.env -- tsx scripts/upload-static-covers.ts [--dry-run]
 *
 * Covers both the originals and the thumbs/ made by make-thumbs.mjs. Objects
 * already in the bucket are skipped (one listing per folder), so it is safe
 * to run again after adding covers. Every write goes through R2Storage, so
 * the R2_MAX_BYTES budget applies: if the bucket is near it, this stops
 * rather than going over.
 *
 * Plain class use, no Nest container - nothing here needs injection.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { R2Storage } from '../src/storage/r2.storage';
import { StorageFullError } from '../src/storage/storage-driver';

const PUBLIC = join(__dirname, '../../web/public');
const FOLDERS = ['covers', 'author-covers', 'chinese-covers'];
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const env = { get: (k: string, d?: string) => process.env[k] ?? d } as never;

async function existing(prefix: string): Promise<Set<string>> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) if (o.Key) keys.add(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(PUBLIC, dir), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) out.push(...(await files(`${dir}/${entry.name}`)));
    else if (TYPES[extname(entry.name).toLowerCase()]) out.push(`${dir}/${entry.name}`);
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  for (const k of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE']) {
    if (!process.env[k]) throw new Error(`${k} is not set`);
  }
  const r2 = new R2Storage(env);

  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  for (const folder of FOLDERS) {
    const have = await existing(`${folder}/`);
    const todo = (await files(folder)).filter((key) => {
      if (have.has(key)) skipped++;
      return !have.has(key);
    });
    console.log(`${folder}: ${todo.length} to upload, ${have.size} already there`);

    // A few at a time: R2 is fast, the uplink is not, and one failure
    // should not leave hundreds of requests in flight.
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(
        todo.slice(i, i + 8).map(async (key) => {
          const body = await readFile(join(PUBLIC, key));
          bytes += body.length;
          if (!dryRun) await r2.put(key, body, TYPES[extname(key).toLowerCase()]);
          uploaded++;
        }),
      );
      if (!dryRun && (i / 8) % 25 === 0) console.log(`  ${uploaded} uploaded so far`);
    }
  }
  console.log(
    `${dryRun ? 'would upload' : 'uploaded'} ${uploaded} files (${(bytes / 1048576).toFixed(1)} MB), skipped ${skipped} already in R2`,
  );
}

main().catch((e) => {
  if (e instanceof StorageFullError) console.error(`stopped: ${e.message}`);
  else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
