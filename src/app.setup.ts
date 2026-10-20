import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppConfigService } from './config/app-config.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/request-context';
import { createValidationPipe } from './common/validation';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: config.corsOrigins,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('RAG_TS API')
    .setDescription(
      'Scientific RAG backend (monolith). Contract: docs/API_DESIGN.md',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    `${API_PREFIX}/docs`,
    app,
    SwaggerModule.createDocument(app, doc),
    {
      jsonDocumentUrl: `${API_PREFIX}/docs-json`,
    },
  );
}
