import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MiningService } from './mining.service';

import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [ConfigModule, StorageModule],
  providers: [MiningService],
  exports: [MiningService],
})
export class MiningModule {}
