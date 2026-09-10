import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { StorageDriver, StoredObject } from './storage-driver';

/**
 * Cloudflare R2, over the S3 API.
 *
 * R2 rather than S3 for one reason that dominates every other consideration
 * here: audio is almost entirely egress, and R2 charges none of it. A six
 * minute chapter is a few megabytes and a full listen-through of a long story
 * is hundreds; at any real number of listeners the bandwidth bill is larger
 * than the synthesis bill, and on S3 it would be the whole cost of the product.
 *
 * Everything written is immutable - the key is a hash of the content - so the
 * cache header is as far in the future as the header allows. A CDN in front of
 * this should serve each file from the edge approximately forever and hit the
 * origin once.
 */
@Injectable()
export class R2Storage implements StorageDriver {
  readonly name = 'r2';
  private readonly logger = new Logger(R2Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    const account = config.get<string>('R2_ACCOUNT_ID', '');
    this.bucket = config.get<string>('R2_BUCKET', '');
    this.publicBase = config
      .get<string>('R2_PUBLIC_BASE', '')
      .replace(/\/+$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get<string>('R2_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('R2_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    this.logger.log(`stored ${key} (${Math.round(body.length / 1024)} KB)`);
    return { url: `${this.publicBase}/${key}`, bytes: body.length };
  }
}
