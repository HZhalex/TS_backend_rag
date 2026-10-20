import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'STORAGE_PROVIDER':
          return 'minio';
        case 'MINIO_ENDPOINT':
          return 'http://localhost:9000';
        case 'MINIO_ACCESS_KEY':
          return 'admin';
        case 'MINIO_SECRET_KEY':
          return 'password123';
        case 'MINIO_BUCKET_NAME':
          return 'uth-scientific-lakehouse';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize with minio provider and correct bucket', () => {
    expect(service.getProvider()).toBe('minio');
    expect(service.getBucketName()).toBe('uth-scientific-lakehouse');
  });

  it('should return parsed json when s3 returns body', async () => {
    const mockData = { test: 'value', number: 42 };
    (service as any).s3Client = {
      send: jest.fn().mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(JSON.stringify(mockData)),
        },
      }),
    };

    const result = await service.getJson('test-key.json');
    expect(result).toEqual(mockData);
  });

  it('should return null when object is not found (404)', async () => {
    const notFoundError = new Error('NoSuchKey');
    (notFoundError as any).name = 'NoSuchKey';

    (service as any).s3Client = {
      send: jest.fn().mockRejectedValue(notFoundError),
    };

    const result = await service.getJson('missing-key.json');
    expect(result).toBeNull();
  });

  it('should upload json via putJson', async () => {
    const sendMock = jest.fn().mockResolvedValue({});
    (service as any).s3Client = { send: sendMock };

    await service.putJson('sample.json', { message: 'hello' });
    expect(sendMock).toHaveBeenCalled();
  });
});
