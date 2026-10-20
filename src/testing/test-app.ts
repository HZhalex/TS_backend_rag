import type {
  DynamicModule,
  INestApplication,
  Provider,
  Type,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configureApp } from '../app.setup';
import { LoggerModule } from '../common/logger.module';
import { AppConfigModule } from '../config/app-config.service';

export const TEST_ENV = {
  NODE_ENV: 'test',
  QDRANT_URL: 'http://127.0.0.1:1',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  MODEL_PATH: '/nonexistent/model.gguf',
  WORLD_DATA_DIR: '/nonexistent/world',
  MINING_DIR: '/nonexistent/mining',
};

/** In-memory single-node replica set (transactions work like in docker compose). */
export async function startMongo(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({ replSet: { count: 1 } });
}

export interface TestApp {
  app: INestApplication;
  server: () => Server;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  imports: Array<Type | DynamicModule>;
  overrides?: Array<{ provide: Type | string | symbol; useValue: unknown }>;
  providers?: Provider[];
  controllers?: Type[];
}

/** Boots the given feature modules with the real config, logger, filter and validation pipe. */
export async function createTestApp(
  mongo: MongoMemoryReplSet,
  opts: TestAppOptions,
): Promise<TestApp> {
  Object.assign(process.env, TEST_ENV, {
    MONGO_URI: mongo.getUri('rag_ts_test'),
  });
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule,
      LoggerModule,
      MongooseModule.forRoot(mongo.getUri('rag_ts_test')),
      ...opts.imports,
    ],
    providers: opts.providers ?? [],
    controllers: opts.controllers ?? [],
  });
  for (const o of opts.overrides ?? []) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    server: () => app.getHttpServer() as Server,
    close: () => app.close(),
  };
}
