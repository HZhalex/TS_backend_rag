import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { EnvValidationError, parseEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  try {
    parseEnv(process.env);
  } catch (e) {
    if (e instanceof EnvValidationError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
