/**
 * Read-only: what is on R2, and which of it nothing points at any more.
 *
 * References come from the database (covers, avatars, narration clips, scene
 * media, renders) and from files the web app ships with R2 links baked in
 * (the Chinese catalog, the background music list). Deletes nothing.
 *
 *   npx tsx src/scripts/r2-audit.ts
 */
import 'reflect-metadata';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { config as dotenv } from 'dotenv';

const ROOT = resolve(__dirname, '../../../..');
dotenv({ path: join(ROOT, '.env'), quiet: true });

const base = process.env.R2_PUBLIC_BASE!.replace(/\/+$/, '');
/** Cover art is stored as a site path (`/covers/x.jpg`) and served from R2 in production; see web/lib/thumb.ts. */
const STATIC = /^\/(chinese-covers|author-covers|covers)\/(.+)$/;
const THUMBED = /^(chinese-covers|author-covers|covers)\/([^/]+)\.(jpe?g|png|webp)$/i;
const keyOf = (url: string | null | undefined) => {
  if (!url) return null;
  if (url.startsWith(base + '/')) return decodeURIComponent(url.slice(base.length + 1).split('?')[0]);
  const m = STATIC.exec(url.split('?')[0]);
  return m ? `${m[1]}/${m[2]}` : null;
};

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) filesUnder(p, out);
    else if (/\.(ts|tsx|json)$/.test(name) && s.size < 50_000_000) out.push(p);
  }
  return out;
}

async function main() {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  const objects = new Map<string, { bytes: number; at: Date }>();
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET!, ContinuationToken: token }));
    for (const o of page.Contents ?? []) objects.set(o.Key!, { bytes: o.Size ?? 0, at: o.LastModified! });
    token = page.NextContinuationToken;
  } while (token);

  const db = new PrismaClient();
  const used = new Map<string, string>();
  const mark = (url: string | null | undefined, why: string) => {
    const k = keyOf(url);
    if (!k) return;
    used.set(k, why);
    // The 480px WebP the site actually shows.
    const t = THUMBED.exec(k);
    if (t) used.set(`${t[1]}/thumbs/${t[2]}.webp`, why + ':thumb');
  };
  for (const u of await db.user.findMany({ select: { avatarUrl: true } })) mark(u.avatarUrl, 'avatar');
  for (const s of await db.story.findMany({ select: { coverUrl: true } })) mark(s.coverUrl, 'cover');
  for (const c of await db.audioClip.findMany({ select: { url: true } })) mark(c.url, 'narration');
  for (const s of await db.scene.findMany({ select: { imageUrl: true, audioUrl: true } })) {
    mark(s.imageUrl, 'scene');
    mark(s.audioUrl, 'scene');
  }
  for (const r of await db.renderJob.findMany({ select: { outputUrl: true } })) mark(r.outputUrl, 'render');
  await db.$disconnect();

  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`${esc}/[^"'\\s)]+|/(?:chinese-covers|author-covers|covers)/[^"'\\s)]+`, 'g');
  for (const f of filesUnder(join(ROOT, 'apps/web'))) {
    for (const m of readFileSync(f, 'utf8').match(linkRe) ?? []) mark(m, 'web:' + f.slice(ROOT.length + 1));
  }

  const prefix = (k: string) =>
    k.includes('/') ? k.split('/').slice(0, k.startsWith('background-music') ? 2 : 1).join('/') : `(root) *.${k.split('.').pop()}`;
  const sum = new Map<string, { n: number; bytes: number; orphanN: number; orphanBytes: number }>();
  const orphans: { key: string; bytes: number; at: string }[] = [];
  let total = 0;
  for (const [k, o] of objects) {
    total += o.bytes;
    const g = sum.get(prefix(k)) ?? { n: 0, bytes: 0, orphanN: 0, orphanBytes: 0 };
    g.n++;
    g.bytes += o.bytes;
    if (!used.has(k)) {
      g.orphanN++;
      g.orphanBytes += o.bytes;
      orphans.push({ key: k, bytes: o.bytes, at: o.at.toISOString() });
    }
    sum.set(prefix(k), g);
  }
  const mb = (b: number) => (b / 1e6).toFixed(1) + ' MB';
  console.log(`objects ${objects.size}, ${mb(total)}; referenced keys ${used.size}`);
  const missing = [...used.keys()].filter((k) => !objects.has(k)).length;
  console.log(`referenced but missing on R2: ${missing}`);
  for (const [p, g] of [...sum].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`${p.padEnd(32)} ${String(g.n).padStart(6)} ${mb(g.bytes).padStart(10)}   unused ${String(g.orphanN).padStart(5)} ${mb(g.orphanBytes).padStart(10)}`);
  }
  const out = process.env.AUDIT_OUT;
  if (out) writeFileSync(out, JSON.stringify(orphans, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
