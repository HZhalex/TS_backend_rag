import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lancedb from '@lancedb/lancedb';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as path from 'path';
import * as fs from 'fs';
import { ScientificChunk } from '../types/scientific-rag';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private retrievalMode: 'qdrant' | 'lancedb' = 'qdrant';

  // LanceDB
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  // Qdrant
  private qdrantClient: QdrantClient | null = null;
  private qdrantCollection: string = 'scientific_papers_gold';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.retrievalMode =
      (this.configService.get<string>('RETRIEVAL_MODE')?.toLowerCase() as
        | 'qdrant'
        | 'lancedb') || 'qdrant';

    this.logger.log(`Active Vector Store retrieval mode: ${this.retrievalMode.toUpperCase()}`);

    if (this.retrievalMode === 'qdrant') {
      try {
        await this.initQdrant();
      } catch (error) {
        this.logger.warn(
          `Failed to initialize Qdrant during startup: ${(error as Error).message}. Will retry on search.`,
        );
      }
    } else {
      try {
        await this.initLanceDb();
      } catch (error) {
        this.logger.warn(
          `Failed to initialize LanceDB during startup: ${(error as Error).message}. Will retry on search.`,
        );
      }
    }
  }

  private async initQdrant(): Promise<void> {
    const qdrantUrl =
      this.configService.get<string>('QDRANT_URL') || 'http://localhost:6333';
    this.qdrantCollection =
      this.configService.get<string>('QDRANT_COLLECTION') || 'scientific_papers_gold';

    this.logger.log(`Connecting to Qdrant at: ${qdrantUrl}, collection: ${this.qdrantCollection}`);
    this.qdrantClient = new QdrantClient({ url: qdrantUrl });

    // Verify collection exists
    const collections = await this.qdrantClient.getCollections();
    const found = collections.collections.some((c) => c.name === this.qdrantCollection);
    if (!found) {
      this.logger.warn(`Collection "${this.qdrantCollection}" not found in Qdrant yet.`);
    } else {
      const info = await this.qdrantClient.getCollection(this.qdrantCollection);
      this.logger.log(
        `Successfully connected to Qdrant collection: ${this.qdrantCollection} (${info.points_count ?? 0} vectors)`,
      );
    }
  }

  private async initLanceDb(): Promise<void> {
    const tableName =
      this.configService.get<string>('LANCEDB_TABLE') || 'scientific_papers_gold';

    const localCandidates = [
      path.resolve(process.cwd(), '../data/gold/lancedb'),
      path.resolve(process.cwd(), 'data/gold/lancedb'),
      'C:\\document\\Study documents\\Uth-Data-Mining\\data\\gold\\lancedb',
    ];

    let targetUri: string | null = null;
    let isS3 = false;

    if (this.configService.get<string>('FORCE_REMOTE_LANCEDB') !== 'true') {
      for (const candidate of localCandidates) {
        if (
          fs.existsSync(path.join(candidate, `${tableName}.lance`)) ||
          fs.existsSync(path.join(candidate, tableName))
        ) {
          targetUri = candidate;
          break;
        }
      }
    }

    if (!targetUri) {
      targetUri =
        this.configService.get<string>('LANCEDB_URI') ||
        this.configService.get<string>('LANCEDB_PATH') ||
        '../data/gold/lancedb';
      isS3 = targetUri.startsWith('s3://');
    }

    this.logger.log(`Connecting to LanceDB at: ${targetUri}, table: ${tableName}`);

    if (isS3) {
      const awsEndpoint = this.configService.get<string>('R2_ENDPOINT_URL');
      const awsAccessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
      const awsSecretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');

      const storageOptions: Record<string, string> = {
        awsEndpoint: awsEndpoint || '',
        awsAccessKeyId: awsAccessKeyId || '',
        awsSecretAccessKey: awsSecretAccessKey || '',
        awsRegion: 'auto',
        allowHttp: 'false',
        virtualHostedStyleRequest: 'false',
      };

      this.db = await lancedb.connect(targetUri, { storageOptions });
    } else {
      const resolvedPath = path.isAbsolute(targetUri)
        ? targetUri
        : path.resolve(process.cwd(), targetUri);
      this.db = await lancedb.connect(resolvedPath);
    }

    this.table = await this.db.openTable(tableName);
    const count = await this.table.countRows();
    this.logger.log(`Successfully connected to LanceDB table: ${tableName} (${count} vectors)`);
  }

  /**
   * Search for top-K similar chunks using Cosine metric.
   * Delegates to Qdrant or LanceDB depending on RETRIEVAL_MODE.
   */
  async search(
    queryVector: number[],
    topK: number = 5,
    category?: string,
  ): Promise<ScientificChunk[]> {
    if (!queryVector || queryVector.length !== 768) {
      throw new BadRequestException('Query vector must be an array of exactly 768 dimensions');
    }

    if (this.retrievalMode === 'qdrant') {
      return this.searchQdrant(queryVector, topK, category);
    }

    return this.searchLanceDb(queryVector, topK, category);
  }

  private async searchQdrant(
    queryVector: number[],
    topK: number,
    category?: string,
  ): Promise<ScientificChunk[]> {
    if (!this.qdrantClient) {
      await this.initQdrant();
    }
    if (!this.qdrantClient) {
      throw new Error('Qdrant client is not available.');
    }

    const candidateLimit = Math.max(topK * 3, 20);

    const filter =
      category && category.trim() !== ''
        ? {
            must: [
              {
                key: 'primary_category',
                match: { value: category.trim() },
              },
            ],
          }
        : undefined;

    const response = await this.qdrantClient.query(this.qdrantCollection, {
      query: queryVector,
      limit: candidateLimit,
      filter,
      with_payload: true,
    });

    const points = response.points || [];

    return points.map((point) => {
      const payload = (point.payload || {}) as Record<string, any>;
      // In Qdrant, Cosine similarity is in [-1, 1], where 1 is identical.
      // LanceDB _distance is Cosine Distance (1 - Cosine Similarity).
      const score = point.score ?? 0;
      const distance = Math.max(0, 1 - score);

      return {
        chunk_id: payload.chunk_id || String(point.id),
        paper_id: payload.paper_id || '',
        title: payload.title || '',
        authors: Array.isArray(payload.authors) ? payload.authors : [],
        primary_category: payload.primary_category || '',
        section_title: payload.section_title || '',
        section_type: payload.section_type || '',
        text: payload.text || '',
        context_text: payload.context_text || '',
        word_count: Number(payload.word_count || 0),
        _distance: distance,
      } as ScientificChunk;
    });
  }

  private async searchLanceDb(
    queryVector: number[],
    topK: number,
    category?: string,
  ): Promise<ScientificChunk[]> {
    if (!this.table) {
      this.logger.log('LanceDB table not initialized yet. Attempting connection now...');
      await this.initLanceDb();
    }

    if (!this.table) {
      throw new Error('LanceDB table is not available.');
    }

    const candidateLimit = Math.max(topK * 3, 20);
    let builder = (this.table.search(queryVector) as any)
      .distanceType('cosine')
      .limit(candidateLimit);

    if (category && category.trim() !== '') {
      const sanitized = category.trim().replace(/'/g, "\\'");
      builder = builder.where(`primary_category = '${sanitized}'`);
    }

    builder = builder.select([
      'chunk_id',
      'paper_id',
      'title',
      'authors',
      'primary_category',
      'section_title',
      'section_type',
      'text',
      'context_text',
      'word_count',
      '_distance',
    ]);

    const results = await builder.toArray();
    return results as unknown as ScientificChunk[];
  }

  isReady(): boolean {
    if (this.retrievalMode === 'qdrant') {
      return this.qdrantClient !== null;
    }
    return this.table !== null;
  }

  getRetrievalMode(): 'qdrant' | 'lancedb' {
    return this.retrievalMode;
  }
}
