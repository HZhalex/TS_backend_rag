import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Global DTO Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS for frontend
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  app.enableCors({
    origin: [frontendOrigin, 'http://localhost:3000', 'http://127.0.0.1:5173'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const port = process.env.GATEWAY_PORT || process.env.PORT || 8000;
  await app.listen(port);
  logger.log(`Scientific RAG Backend server listening on port ${port}`);
  logger.log(`Health endpoint: http://localhost:${port}/api/rag/health`);
  logger.log(`Chat endpoint: http://localhost:${port}/api/rag/chat`);
}
bootstrap();
