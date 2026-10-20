import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private bucketName: string = 'uth-scientific-lakehouse';
  private provider: 'minio' | 'r2' = 'minio';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.initClient();
  }

  private initClient(): void {
    this.provider =
      (this.configService.get<string>('STORAGE_PROVIDER')?.toLowerCase() as 'minio' | 'r2') ||
      'minio';

    let endpoint: string;
    let accessKeyId: string;
    let secretAccessKey: string;
    let region: string = 'us-east-1';

    if (this.provider === 'r2') {
      endpoint = this.configService.get<string>('R2_ENDPOINT_URL') || '';
      accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID') || '';
      secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY') || '';
      this.bucketName =
        this.configService.get<string>('R2_BUCKET_NAME') || 'uth-scientific-lakehouse';
      region = 'auto';
    } else {
      endpoint =
        this.configService.get<string>('MINIO_ENDPOINT') || 'http://localhost:9000';
      accessKeyId = this.configService.get<string>('MINIO_ACCESS_KEY') || 'admin';
      secretAccessKey =
        this.configService.get<string>('MINIO_SECRET_KEY') || 'password123';
      this.bucketName =
        this.configService.get<string>('MINIO_BUCKET_NAME') || 'uth-scientific-lakehouse';
      region = this.configService.get<string>('MINIO_REGION') || 'us-east-1';
    }

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn(`Storage credentials not fully configured for provider: ${this.provider}`);
      return;
    }

    this.logger.log(
      `Initializing S3 Storage (${this.provider.toUpperCase()}): endpoint=${endpoint}, bucket=${this.bucketName}`,
    );

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  /**
   * Check if storage client is healthy and bucket is accessible.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.s3Client) return false;
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch and parse a JSON object from storage.
   */
  async getJson<T = any>(key: string): Promise<T | null> {
    if (!this.s3Client) return null;

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );

      if (!response.Body) return null;
      const str = await response.Body.transformToString('utf-8');
      return JSON.parse(str) as T;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      this.logger.warn(`Failed to read s3://${this.bucketName}/${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Upload JSON data to storage.
   */
  async putJson(key: string, data: any): Promise<void> {
    if (!this.s3Client) {
      throw new Error('Storage client not initialized');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      }),
    );
  }

  getBucketName(): string {
    return this.bucketName;
  }

  getProvider(): string {
    return this.provider;
  }
}
