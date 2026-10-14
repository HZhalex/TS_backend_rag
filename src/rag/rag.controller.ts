import { Controller, Post, Get, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { RagService } from './rag.service';
import { QueryDto } from './dto/query.dto';
import { RAGSynthesisResponse } from '../types/scientific-rag';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { LlmService } from '../llm/llm.service';

@Controller('api/rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly llmService: LlmService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() queryDto: QueryDto): Promise<RAGSynthesisResponse> {
    this.logger.log(`Received chat request: "${queryDto.query}"`);
    return this.ragService.executeRagPipeline(queryDto);
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'scientific-rag-backend',
      timestamp: new Date().toISOString(),
      components: {
        vectorStore: this.vectorStoreService.isReady() ? 'ready' : 'connecting_or_fallback',
        llm: this.llmService.isReady() ? 'ready' : 'fallback',
        gpu: this.llmService.getGpuStatus(),
      },
    };
  }
}
