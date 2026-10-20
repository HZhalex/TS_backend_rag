import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueService } from './queue.service';
import { QueueConsumer } from './queue.consumer';
import { QueueController } from './queue.controller';
import { EmbeddingModule } from '../embedding/embedding.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ConfigModule, EmbeddingModule, StorageModule],
  controllers: [QueueController],
  providers: [QueueService, QueueConsumer],
  exports: [QueueService],
})
export class QueueModule {}
