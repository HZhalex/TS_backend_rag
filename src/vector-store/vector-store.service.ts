import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import { ScientificChunk } from '../types/scientific-rag';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.initLanceDb();
    } catch (error) {
      this.logger.warn(
        `Failed to initialize LanceDB during startup: ${(error as Error).message}. Will retry on search.`,
      );
    }
  }

  private async initLanceDb(): Promise<void> {
    const lancedbUri =
      this.configService.get<string>('LANCEDB_URI') ||
      this.configService.get<string>('LANCEDB_PATH') ||
      '../data/gold/lancedb';

    const tableName =
      this.configService.get<string>('LANCEDB_TABLE') || 'scientific_papers_gold';

    this.logger.log(`Connecting to LanceDB at: ${lancedbUri}, table: ${tableName}`);

    if (lancedbUri.startsWith('s3://')) {
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

      this.db = await lancedb.connect(lancedbUri, { storageOptions });
    } else {
      const resolvedPath = path.isAbsolute(lancedbUri)
        ? lancedbUri
        : path.resolve(process.cwd(), lancedbUri);
      this.db = await lancedb.connect(resolvedPath);
    }

    this.table = await this.db.openTable(tableName);
    this.logger.log(`Successfully connected to LanceDB table: ${tableName}`);
  }

  /**
   * Search for top-K similar chunks using Cosine metric and projection of required columns.
   */
  async search(
    queryVector: number[],
    topK: number = 5,
    category?: string,
  ): Promise<ScientificChunk[]> {
    if (!queryVector || queryVector.length !== 768) {
      throw new BadRequestException('Query vector must be an array of exactly 768 dimensions');
    }

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
    ]);

    const results = await builder.toArray();
    return results as unknown as ScientificChunk[];
  }

  isReady(): boolean {
    return this.table !== null;
  }
}
