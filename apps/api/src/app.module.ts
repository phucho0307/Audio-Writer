import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { AwThrottlerModule } from './throttler/throttler.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { StoriesModule } from './stories/stories.module';
import { LlmModule } from './llm/llm.module';
import { EventsModule } from './events/events.module';
import { StorageModule } from './storage/storage.module';
import { ReferencesModule } from './references/references.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { CollabModule } from './collab/collab.module';
import { TtsModule } from './tts/tts.module';
import { UsersModule } from './users/users.module';
import { RatingsModule } from './ratings/ratings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Secrets live at the repo root so the API and the Python workers read
      // the same file.
      envFilePath: ['../../.env'],
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    AwThrottlerModule,
    AuthModule,
    HealthModule,
    StoriesModule,
    UsersModule,
    RatingsModule,
    LlmModule,
    EventsModule,
    StorageModule,
    TtsModule,
    CollabModule,
    ReferencesModule,
    DiscoveryModule,
  ],
})
export class AppModule {}
