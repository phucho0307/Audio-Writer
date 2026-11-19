import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { unsafeProductionSettings } from './production-guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Keeps the request's exact bytes beside the parsed JSON: the payment
    // webhook's signature is over the raw body, and re-serialising the parsed
    // object would not reproduce it byte for byte.
    rawBody: true,
  });
  const config = app.get(ConfigService);

  const unsafe = unsafeProductionSettings((key) => config.get<string>(key));
  if (unsafe.length > 0) {
    Logger.error(`Refusing to start in production:\n - ${unsafe.join('\n - ')}`, 'Bootstrap');
    await app.close();
    process.exit(1);
  }

  // Both rate limiters key on the caller's address, so this has to be exact,
  // and it is wrong in opposite directions depending on the deployment. Off,
  // behind a load balancer, every request appears to come from the balancer and
  // the whole site shares one bucket. On, with no proxy in front, anyone can set
  // X-Forwarded-For and choose their own bucket - which is worse than no limit,
  // because it looks like one. So it is opt-in, and set to the number of proxy
  // hops actually in front of us.
  const hops = config.get<string>('TRUST_PROXY', '').trim();
  if (hops) app.set('trust proxy', /^\d+$/.test(hops) ? Number(hops) : hops);

  app.use(helmet());
  app.use(cookieParser());

  // Refresh tokens ride in an httpOnly cookie, so the browser must be allowed
  // to send credentials and the origin must be explicit - no wildcard.
  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
