import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ENV, Env } from './config/env';

/** Configuração HTTP única — usada pelo servidor real e pelos testes de integração. */
export function setupApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: env.corsOrigins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], maxAge: 600 });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false }
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
