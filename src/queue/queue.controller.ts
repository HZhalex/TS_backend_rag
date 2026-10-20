import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { AsyncIngestDto, AsyncIngestResponseDto } from './dto/ingest.dto';

@ApiTags('Ingestion')
@Controller('api/v1/ingest')
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(private readonly queueService: QueueService) {}

  @Post('async')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a scientific paper for background ingestion via RabbitMQ',
    description:
      'Pushes the paper payload into RabbitMQ durable queue for asynchronous metadata storage (MinIO), chunking, 768-D embedding, and Qdrant vector indexing.',
  })
  @ApiBody({ type: AsyncIngestDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Paper successfully queued for background processing.',
    type: AsyncIngestResponseDto,
  })
  async enqueuePaperIngest(
    @Body() dto: AsyncIngestDto,
  ): Promise<AsyncIngestResponseDto> {
    this.logger.log(`Received async ingest request for paper: ${dto.paper_id}`);

    await this.queueService.publish(this.queueService.ingestQueue, dto);

    return {
      status: 'queued',
      paper_id: dto.paper_id,
      message:
        'Paper accepted into RabbitMQ queue for asynchronous ingestion & embedding.',
      timestamp: Date.now(),
    };
  }
}
