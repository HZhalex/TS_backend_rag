import { Module } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { AppConfigService } from '../config/app-config.service';
import {
  QDRANT_CLIENT,
  QDRANT_TIMEOUT_MS,
  VECTOR_STORE_PORT,
  VectorStoreService,
} from './vector-store.service';

@Module({
  providers: [
    {
      provide: QDRANT_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new QdrantClient({
          url: config.get('QDRANT_URL'),
          apiKey: config.get('QDRANT_API_KEY') || undefined,
          timeout: QDRANT_TIMEOUT_MS,
          checkCompatibility: false,
        }),
    },
    VectorStoreService,
    { provide: VECTOR_STORE_PORT, useExisting: VectorStoreService },
  ],
  exports: [VECTOR_STORE_PORT],
})
export class VectorStoreModule {}
