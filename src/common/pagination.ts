import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const INVALID_CURSOR = 'invalid cursor';

/** One page of a cursor-paginated list (API_DESIGN §1.4). */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(obj: object): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor; `isValid` checks its shape. Anything malformed ➔ 400 `invalid cursor`.
 */
export function decodeCursor<T>(
  str: string,
  isValid: (v: unknown) => v is T,
): T {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('bad alphabet');
    const obj: unknown = JSON.parse(
      Buffer.from(str, 'base64url').toString('utf8'),
    );
    if (!isValid(obj)) throw new Error('bad shape');
    return obj;
  } catch {
    throw new BadRequestException(INVALID_CURSOR);
  }
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
