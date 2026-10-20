import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'RABBITMQ_URL':
          return 'amqp://admin:password123@localhost:5672';
        case 'RABBITMQ_QUEUE_INGEST':
          return 'scientific_paper_ingest';
        case 'RABBITMQ_QUEUE_EMBED':
          return 'scientific_chunk_embed';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.ingestQueue).toBe('scientific_paper_ingest');
    expect(service.embedQueue).toBe('scientific_chunk_embed');
  });

  it('should publish message to queue using channel', async () => {
    const mockChannel = {
      sendToQueue: jest.fn().mockReturnValue(true),
    };
    (service as any).channel = mockChannel;
    (service as any).isConnected = true;

    const payload = { paper_id: 'test_123', title: 'Test Paper' };
    const sent = await service.publish('scientific_paper_ingest', payload);

    expect(sent).toBe(true);
    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      'scientific_paper_ingest',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
  });

  it('should register consumer with callback', async () => {
    const mockChannel = {
      consume: jest.fn().mockImplementation((queue, callback) => {
        // simulate receiving a message
        const msg = {
          content: Buffer.from(JSON.stringify({ paper_id: 'test_123' })),
        };
        callback(msg);
      }),
      ack: jest.fn(),
    };
    (service as any).channel = mockChannel;
    (service as any).isConnected = true;

    const handler = jest.fn().mockResolvedValue(undefined);
    await service.consume('scientific_paper_ingest', handler);

    expect(mockChannel.consume).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ paper_id: 'test_123' });
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});
