import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private isConnected = false;

  public readonly ingestQueue: string;
  public readonly embedQueue: string;

  constructor(private readonly configService: ConfigService) {
    this.ingestQueue =
      this.configService.get<string>('RABBITMQ_QUEUE_INGEST') ||
      'scientific_paper_ingest';
    this.embedQueue =
      this.configService.get<string>('RABBITMQ_QUEUE_EMBED') ||
      'scientific_chunk_embed';
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (err: any) {
      this.logger.warn(
        `Failed to connect to RabbitMQ during startup: ${err.message}. Will retry on demand.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  public async connect(): Promise<void> {
    if (this.isConnected && this.channel) {
      return;
    }

    const url =
      this.configService.get<string>('RABBITMQ_URL') ||
      'amqp://admin:password123@localhost:5672';

    this.logger.log(`Connecting to RabbitMQ at ${url}...`);
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();

    // Assert durable queues
    await this.channel.assertQueue(this.ingestQueue, { durable: true });
    await this.channel.assertQueue(this.embedQueue, { durable: true });

    // Fair dispatch - 1 message per worker at a time
    await this.channel.prefetch(1);

    this.isConnected = true;
    this.logger.log(
      `Successfully connected to RabbitMQ. Queues asserted: [${this.ingestQueue}, ${this.embedQueue}]`,
    );

    this.connection.on('error', (err) => {
      this.logger.error(`RabbitMQ connection error: ${err.message}`);
      this.isConnected = false;
    });

    this.connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed.');
      this.isConnected = false;
    });
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (err: any) {
      this.logger.warn(`Error while closing RabbitMQ: ${err.message}`);
    } finally {
      this.channel = null;
      this.connection = null;
      this.isConnected = false;
    }
  }

  /**
   * Publish a message to a durable queue.
   */
  async publish(queue: string, message: any): Promise<boolean> {
    if (!this.isConnected || !this.channel) {
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available.');
    }

    const content = Buffer.from(JSON.stringify(message));
    const sent = this.channel.sendToQueue(queue, content, {
      persistent: true,
      timestamp: Date.now(),
    });

    this.logger.log(`Published task to queue [${queue}]: ${JSON.stringify(message).slice(0, 100)}...`);
    return sent;
  }

  /**
   * Register a consumer for a queue.
   */
  async consume<T = any>(
    queue: string,
    onMessage: (msg: T) => Promise<void>,
  ): Promise<void> {
    if (!this.isConnected || !this.channel) {
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available.');
    }

    this.logger.log(`Registering consumer for queue [${queue}]...`);

    await this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) return;

        try {
          const parsed = JSON.parse(msg.content.toString('utf-8')) as T;
          await onMessage(parsed);
          this.channel?.ack(msg);
        } catch (err: any) {
          this.logger.error(
            `Error processing message from queue [${queue}]: ${err.message}`,
            err.stack,
          );
          // Reject and requeue on error, or reject without requeue
          this.channel?.nack(msg, false, false);
        }
      },
      { noAck: false },
    );
  }

  isReady(): boolean {
    return this.isConnected && this.channel !== null;
  }
}
