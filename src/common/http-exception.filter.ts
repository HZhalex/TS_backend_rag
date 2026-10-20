import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { requestIdOf } from './request-context';

/** Error body of every endpoint (API_DESIGN §1.2). */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  request_id: string | null;
}

export function messageOf(exception: HttpException): string {
  const res = exception.getResponse();
  if (typeof res === 'string') return res;
  const m = (res as { message?: unknown }).message;
  if (Array.isArray(m)) return String(m[0] ?? exception.message);
  if (typeof m === 'string') return m;
  return exception.message;
}

export function toErrorBody(
  exception: unknown,
  requestId: string | null,
): ErrorBody {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  const message =
    exception instanceof HttpException
      ? messageOf(exception)
      : 'internal server error';
  return {
    statusCode: status,
    error: STATUS_CODES[status] ?? 'Error',
    message,
    request_id: requestId,
  };
}

/**
 * Turns every thrown error into the §1.2 body. Unexpected errors become 500 without leaking the
 * stack; the error is attached to the response so the request log line carries it.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response & { err?: unknown }>();
    const body = toErrorBody(exception, requestIdOf(req));
    if (body.statusCode >= 500) {
      res.err =
        exception instanceof Error ? exception : new Error(String(exception));
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(body.statusCode).json(body);
  }
}
