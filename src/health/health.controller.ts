import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthDto } from './health.dto';
import { Health, HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Always 200: read `status`. */
  @Get()
  @ApiOkResponse({ type: HealthDto })
  get(): Promise<Health> {
    return this.health.health();
  }

  /** Liveness: the process answers, no dependency is called. */
  @Get('live')
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: 503 when Mongo or Qdrant is down. */
  @Get('ready')
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const h = await this.health.health();
    if (h.status === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return h;
  }
}
