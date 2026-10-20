import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { decodeCursor, encodeCursor, PaginationQueryDto } from './pagination';

interface C {
  t: string;
  id: string;
}
const isC = (v: unknown): v is C =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as C).t === 'string' &&
  typeof (v as C).id === 'string';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { t: '2026-10-20T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(c), isC)).toEqual(c);
  });

  it.each([
    'abc!!',
    '',
    encodeCursor({ t: 1 }),
    Buffer.from('not json').toString('base64url'),
  ])('rejects %p', (bad) => {
    expect(() => decodeCursor(bad, isC)).toThrow(
      new BadRequestException('invalid cursor'),
    );
  });
});

describe('PaginationQueryDto', () => {
  const check = (q: object) =>
    validateSync(plainToInstance(PaginationQueryDto, q));

  it('defaults limit to 20', () => {
    expect(plainToInstance(PaginationQueryDto, {}).limit).toBe(20);
  });

  it('accepts 1..50', () => {
    expect(check({ limit: '1' })).toHaveLength(0);
    expect(check({ limit: '50' })).toHaveLength(0);
  });

  it('rejects out of range', () => {
    expect(check({ limit: '0' })).not.toHaveLength(0);
    expect(check({ limit: '51' })).not.toHaveLength(0);
  });
});
