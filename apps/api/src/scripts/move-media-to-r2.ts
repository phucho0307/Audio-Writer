/**
 * Copy narration and avatars written to the local disk up to R2, and point
 * the database at the copies.
 *
 *   npm run build && node --use-system-ca dist/scripts/move-media-to-r2.js [--dry-run]
 *
 * From the built output, not tsx: Nest resolves services from decorator
 * metadata, which esbuild does not emit.
 *
 * Needs the R2_* variables set - it refuses to run against the disk driver,
 * which would only copy files onto themselves. Keys are kept as they are, so
 * a file lands at `${R2_PUBLIC_BASE}/<same name>`. Each row is updated only
 * after its upload succeeded, so it is safe to stop and run again: rows
 * already on R2 no longer start with `/audio/` and are skipped. Local files
 * are left in place; delete them by hand once the site plays from R2.
 */
process.env.RUN_WORKER = 'false';
process.env.COLLAB_ENABLED = 'false';
process.env.PRERENDER_ON_PUBLISH = 'false';
// Indexing would start embedding calls the script then has to wait out.
process.env.RAG_BACKFILL_ON_BOOT = 'false';
process.env.RAG_INDEX_ON_COMMIT = 'false';

import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIO_STORAGE, type StorageDriver } from '../storage/storage-driver';

const PUBLIC_DIR = join(__dirname, '../../../web/public');
const TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const storage = app.get<StorageDriver>(AUDIO_STORAGE);
    if (storage.name !== 'r2') {
      throw new Error('R2 is not configured (check the R2_* variables in .env) - nothing to move to');
    }

    const clips = await prisma.audioClip.findMany({
      where: { url: { startsWith: '/audio/' } },
      select: { id: true, url: true },
    });
    const users = await prisma.user.findMany({
      where: { avatarUrl: { startsWith: '/audio/' } },
      select: { id: true, avatarUrl: true },
    });
    console.log(`${clips.length} narration clips, ${users.length} avatars on the local disk${dryRun ? ' (dry run)' : ''}`);

    let moved = 0;
    let missing = 0;
    let bytes = 0;

    const move = async (url: string, save: (newUrl: string) => Promise<unknown>) => {
      const key = url.replace(/^\/audio\//, '');
      let body: Buffer;
      try {
        body = await readFile(join(PUBLIC_DIR, 'audio', key));
      } catch {
        // The row outlived its file. Leave it; the player already treats a
        // dead clip as "not rendered" and narration renders it again.
        missing++;
        console.warn(`  missing on disk: ${key}`);
        return;
      }
      bytes += body.length;
      if (dryRun) return void moved++;
      const stored = await storage.put(key, body, TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream');
      await save(stored.url);
      moved++;
    };

    for (const c of clips) {
      await move(c.url, (url) => prisma.audioClip.update({ where: { id: c.id }, data: { url } }));
    }
    for (const u of users) {
      await move(u.avatarUrl!, (url) => prisma.user.update({ where: { id: u.id }, data: { avatarUrl: url } }));
    }

    console.log(
      `${dryRun ? 'would move' : 'moved'} ${moved} files (${(bytes / 1048576).toFixed(1)} MB), ${missing} missing on disk`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
