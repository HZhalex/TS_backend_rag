import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsArray, IsOptional } from 'class-validator';

export class AsyncIngestDto {
  @ApiProperty({
    description: 'Unique Paper Identifier (e.g., arXiv ID)',
    example: '2410.12345',
  })
  @IsString()
  @IsNotEmpty()
  paper_id!: string;

  @ApiProperty({
    description: 'Title of the scientific paper',
    example: 'Fast Graph Reasoning with Asynchronous Queue Pipelines',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Full text or excerpt of the paper to be chunked and indexed',
    example:
      'We present a distributed asynchronous pipeline using RabbitMQ and Qdrant to index scientific literature at scale.',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional({
    description: 'List of authors',
    example: ['Geoffrey Hinton', 'Yann LeCun'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  authors?: string[];

  @ApiPropertyOptional({
    description: 'Primary arXiv category code',
    example: 'cs.AI',
    default: 'cs.AI',
  })
  @IsString()
  @IsOptional()
  primary_category?: string;

  @ApiPropertyOptional({
    description: 'Section title if applicable',
    example: 'Abstract',
  })
  @IsString()
  @IsOptional()
  section_title?: string;
}

export class AsyncIngestResponseDto {
  @ApiProperty({ example: 'queued' })
  status!: string;

  @ApiProperty({ example: '2410.12345' })
  paper_id!: string;

  @ApiProperty({
    example: 'Paper accepted into RabbitMQ queue for asynchronous ingestion & embedding.',
  })
  message!: string;

  @ApiProperty({ example: 1729175000000 })
  timestamp!: number;
}
