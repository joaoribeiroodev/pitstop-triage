import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { ENV, Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Atrás do proxy do PaaS: sem isso o rate limit enxergaria o IP do proxy, não o do cliente.
  app.set('trust proxy', 1);
  setupApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.port, '0.0.0.0');
}

void bootstrap();
