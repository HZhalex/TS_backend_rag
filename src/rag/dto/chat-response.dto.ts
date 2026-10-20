import { ApiProperty } from '@nestjs/swagger';
import type { GroundedChunk, Timings } from '../../types/scientific-rag';

export class TimingsDto implements Timings {
  @ApiProperty({ example: 35 }) embed_ms: number;
  @ApiProperty({ example: 2 }) route_ms: number;
  @ApiProperty({ example: 18 }) search_ms: number;
  @ApiProperty({ example: 1 }) rerank_ms: number;
  @ApiProperty({ example: 1600 }) llm_ms: number;
  @ApiProperty({ example: 1660 }) total_ms: number;
}

/** Body of `POST /rag/chat` (API_DESIGN §3). */
export class ChatResponseDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null without JWT',
  })
  session_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  message_id: string | null;

  @ApiProperty() query: string;
  @ApiProperty() answer: string;
  @ApiProperty({ type: [String] }) citations: string[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  grounded_chunks: GroundedChunk[];

  @ApiProperty({ type: [String] }) expanded_terms: string[];

  @ApiProperty({ type: () => TimingsDto })
  timings: Timings;
}
