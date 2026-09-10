import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalDiskStorage } from './local-disk.storage';
import { R2Storage } from './r2.storage';
import { AUDIO_STORAGE, type StorageDriver } from './storage-driver';

/**
 * Object storage when it is configured, the local disk when it is not.
 *
 * Selected on `R2_BUCKET` alone rather than on NODE_ENV, so the choice is made
 * by what actually exists rather than by what environment claims to be. A
 * fresh clone with no credentials runs on disk and everything works; filling in
 * four variables moves narration to R2 with no code change and no difference
 * the player can see.
 */
const DRIVER = {
  provide: AUDIO_STORAGE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): StorageDriver => {
    const log = new Logger('AudioStorage');

    if (!config.get<string>('R2_BUCKET')) {
      log.log('R2 not configured - audio is written to the local disk');
      return new LocalDiskStorage();
    }

    const missing = [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_PUBLIC_BASE',
    ].filter((k) => !config.get<string>(k));

    if (missing.length) {
      // Half-configured is the dangerous state: uploads would fail one at a
      // time inside a worker, long after the mistake was made. Say so at boot
      // and keep working on disk.
      log.error(
        `R2_BUCKET is set but ${missing.join(', ')} missing - falling back to local disk`,
      );
      return new LocalDiskStorage();
    }

    log.log('audio is stored in R2');
    return new R2Storage(config);
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [DRIVER],
  exports: [AUDIO_STORAGE],
})
export class StorageModule {}
