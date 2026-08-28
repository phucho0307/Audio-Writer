import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { StoriesModule } from './stories/stories.module';
import { LlmModule } from './llm/llm.module';
import { TtsModule } from './tts/tts.module';

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
    AuthModule,
    HealthModule,
    StoriesModule,
    LlmModule,
    TtsModule,
  ],
})
export class AppModule {}
