import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { StorageService } from '../storage/storage.service';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';

export interface PaperIngestPayload {
  paper_id: string;
  title: string;
  authors?: string[];
  primary_category?: string;
  abstract?: string;
  text: string;
  section_title?: string;
  section_type?: string;
}

function chunkIdToUuid(chunkId: string): string {
  const hash = crypto.createHash('md5').update(chunkId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

@Injectable()
export class QueueConsumer implements OnModuleInit {
  private readonly logger = new Logger(QueueConsumer.name);
  private qdrantClient: QdrantClient | null = null;
  private readonly collectionName: string;

  constructor(
    private readonly queueService: QueueService,
    private readonly embeddingService: EmbeddingService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {
    this.collectionName =
      this.configService.get<string>('QDRANT_COLLECTION') || 'scientific_papers_gold';
  }

  async onModuleInit(): Promise<void> {
    const qdrantUrl =
      this.configService.get<string>('QDRANT_URL') || 'http://localhost:6333';
    this.qdrantClient = new QdrantClient({ url: qdrantUrl });

    // Register queue consumers
    await this.registerConsumers();
  }

  private async registerConsumers(): Promise<void> {
    try {
      await this.queueService.consume<PaperIngestPayload>(
        this.queueService.ingestQueue,
        async (payload) => {
          await this.processPaperIngestion(payload);
        },
      );
      this.logger.log(`QueueConsumer registered for [${this.queueService.ingestQueue}].`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to register QueueConsumer during startup: ${err.message}. Will retry when connection is established.`,
      );
    }
  }

  /**
   * Pipeline executed when a paper ingestion message is dequeued:
   * 1. Save raw metadata in MinIO (Bronze tier).
   * 2. Split paper into text chunks.
   * 3. Compute 768-D dense vector embedding via EmbeddingService.
   * 4. Upsert chunk and vector into Qdrant (Gold tier).
   */
  public async processPaperIngestion(payload: PaperIngestPayload): Promise<void> {
    const { paper_id, title, text } = payload;
    this.logger.log(`[Worker] Received paper ingestion task for: "${title}" (ID: ${paper_id})`);

    // 1. Save to MinIO Bronze Tier
    try {
      await this.storageService.putJson(`bronze/papers/${paper_id}.json`, {
        ...payload,
        ingested_at: new Date().toISOString(),
      });
      this.logger.log(`[Worker] Saved raw metadata to MinIO: bronze/papers/${paper_id}.json`);
    } catch (err: any) {
      this.logger.warn(`[Worker] Failed to save raw metadata to MinIO: ${err.message}`);
    }

    // 2. Chunking (Simple paragraph/length chunking)
    const chunks = this.createChunks(text, 250);
    this.logger.log(`[Worker] Paper ${paper_id} split into ${chunks.length} chunks.`);

    // 3. Embedding and Indexing into Qdrant
    const points: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const chunkId = `${paper_id}_chunk_${i}`;
      const pointId = chunkIdToUuid(chunkId);

      // Generate 768-D vector
      const vector = await this.embeddingService.generateEmbedding(chunkText);

      points.push({
        id: pointId,
        vector,
        payload: {
          chunk_id: chunkId,
          paper_id,
          title,
          authors: payload.authors || [],
          primary_category: payload.primary_category || 'cs.AI',
          section_title: payload.section_title || (i === 0 ? 'Abstract' : `Section ${i}`),
          section_type: payload.section_type || (i === 0 ? 'abstract' : 'method'),
          text: chunkText,
          context_text: `Paper: "${title}" | ${chunkText}`,
          word_count: chunkText.split(/\s+/).length,
        },
      });
    }

    // 4. Batch upsert into Qdrant
    if (this.qdrantClient && points.length > 0) {
      await this.qdrantClient.upsert(this.collectionName, {
        wait: true,
        points,
      });
      this.logger.log(
        `[Worker] Successfully upserted ${points.length} vectors for paper ${paper_id} into Qdrant collection "${this.collectionName}".`,
      );
    }
  }

  private createChunks(text: string, maxWordsPerChunk: number): string[] {
    if (!text || text.trim() === '') return [];

    const words = text.split(/\s+/);
    if (words.length <= maxWordsPerChunk) {
      return [text.trim()];
    }

    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWordsPerChunk) {
      const chunk = words.slice(i, i + maxWordsPerChunk).join(' ');
      chunks.push(chunk.trim());
    }
    return chunks;
  }
}
