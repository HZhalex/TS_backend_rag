import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { PaperDetail } from '../types/scientific-rag';
import { PaperDetailDto } from './paper-detail.dto';
import { PapersService } from './papers.service';

@ApiTags('Papers')
@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  @Get(':paper_id')
  @ApiParam({
    name: 'paper_id',
    description:
      'URL-encoded; may contain "." and ":" (e.g. openalex%3AW2594538354)',
  })
  @ApiOkResponse({ type: PaperDetailDto })
  @ApiNotFoundResponse({ description: 'paper not found' })
  @ApiServiceUnavailableResponse({ description: 'qdrant unavailable' })
  get(@Param('paper_id') paperId: string): Promise<PaperDetail> {
    return this.papers.get(paperId);
  }
}
