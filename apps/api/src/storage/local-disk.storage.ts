import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageDriver, StoredObject } from './storage-driver';

/**
 * Development storage: files written into the web app's `public/` directory
 * and served by Next.
 *
 * This is deliberately the default, so a fresh clone runs with no cloud
 * credentials at all. It is also the thing that cannot be deployed: it assumes
 * the API and the web app share a filesystem, which stops being true the moment
 * either is containerised or replicated. `R2Storage` is what replaces it, and
 * the only difference the rest of the code sees is the string in
 * `AudioClip.url`.
 */
@Injectable()
export class LocalDiskStorage implements StorageDriver {
  readonly name = 'local-disk';
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly dir = join(__dirname, '../../../web/public/audio');

  async put(key: string, body: Buffer): Promise<StoredObject> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), body);
    // No cache header to set here - Next serves `public/` with its own
    // defaults. Immutability only becomes worth expressing once a CDN is in
    // front, which is the point at which this driver is no longer in use.
    return { url: `/audio/${key}`, bytes: body.length };
  }
}
