import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageFullError, type StorageDriver, type StoredObject } from './storage-driver';

/**
 * Stop writing at 9 GB, under R2's 10 GB free allowance. R2 has no spending
 * cap of its own - past the allowance it simply bills the card - so this is
 * the cap. The margin covers what other processes write between checks.
 */
const DEFAULT_MAX_BYTES = 9_000_000_000;

/** How long a measurement of the bucket is trusted before listing it again. */
const MEASURE_EVERY_MS = 30 * 60_000;
/** After a failed measurement, how soon to try again. */
const RETRY_MEASURE_MS = 60_000;

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
  private readonly maxBytes: number;

  /** Bytes in the bucket at the last listing, plus what this process wrote since. */
  private used: number | null = null;
  private measuredAt = 0;
  private measuring: Promise<void> | null = null;

  constructor(config: ConfigService) {
    const account = config.get<string>('R2_ACCOUNT_ID', '');
    this.bucket = config.get<string>('R2_BUCKET', '');
    this.publicBase = config
      .get<string>('R2_PUBLIC_BASE', '')
      .replace(/\/+$/, '');
    this.maxBytes = Number(config.get<string>('R2_MAX_BYTES', String(DEFAULT_MAX_BYTES)));

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
    await this.measure();
    if (!this.fits(body.length)) {
      throw new StorageFullError(this.fullMessage());
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    // Counted even when the key already existed (content-addressed keys make
    // that rare). Over-counting only errs towards stopping early, and the
    // next listing corrects it.
    if (this.used !== null) this.used += body.length;

    this.logger.log(`stored ${key} (${Math.round(body.length / 1024)} KB)`);
    return { url: `${this.publicBase}/${key}`, bytes: body.length };
  }

  async hasRoom(): Promise<boolean> {
    await this.measure();
    // Room for a typical chapter, so synthesis is not started for a file
    // that would then be refused.
    const room = this.fits(8 * 1024 * 1024);
    if (!room) this.logger.error(this.fullMessage());
    return room;
  }

  /**
   * Unknown usage counts as full. If the bucket cannot be measured, writing
   * blind is exactly how a bill appears; waiting a minute for the next
   * attempt costs nothing.
   */
  private fits(bytes: number): boolean {
    return this.used !== null && this.used + bytes <= this.maxBytes;
  }

  private fullMessage(): string {
    const gb = (n: number) => (n / 1e9).toFixed(2);
    return this.used === null
      ? 'R2 usage could not be measured - not writing until it can (check the R2 token can list the bucket)'
      : `R2 budget reached: ${gb(this.used)} GB used of ${gb(this.maxBytes)} GB (R2_MAX_BYTES) - not storing more`;
  }

  /** Lists the bucket and sums object sizes, at most every half hour. */
  private async measure(): Promise<void> {
    const age = Date.now() - this.measuredAt;
    if (age < (this.used === null ? RETRY_MEASURE_MS : MEASURE_EVERY_MS)) return;
    this.measuring ??= (async () => {
      try {
        let total = 0;
        let objects = 0;
        let token: string | undefined;
        do {
          const page = await this.client.send(
            new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
          );
          for (const o of page.Contents ?? []) {
            total += o.Size ?? 0;
            objects++;
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        this.used = total;
        this.logger.log(
          `R2 holds ${objects} objects, ${(total / 1e9).toFixed(2)} GB of ${(this.maxBytes / 1e9).toFixed(2)} GB budget`,
        );
      } catch (err) {
        this.logger.error(`could not measure R2 usage: ${(err as Error).message}`);
      } finally {
        this.measuredAt = Date.now();
        this.measuring = null;
      }
    })();
    await this.measuring;
  }
}
