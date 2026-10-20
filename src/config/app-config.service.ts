import { Global, Injectable, Module } from '@nestjs/common';
import { AppConfig, parseEnv } from './env.schema';

/** Typed, validated configuration. Built once from process.env at startup. */
@Injectable()
export class AppConfigService {
  readonly values: AppConfig;

  constructor(values?: AppConfig) {
    this.values = values ?? parseEnv(process.env);
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.values[key];
  }

  get corsOrigins(): string[] {
    return this.values.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
}

@Global()
@Module({
  providers: [
    { provide: AppConfigService, useFactory: () => new AppConfigService() },
  ],
  exports: [AppConfigService],
})
export class AppConfigModule {}
