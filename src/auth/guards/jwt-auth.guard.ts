import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService, UNAUTHORIZED } from '../token.service';

/** `Bearer <token>` ➔ token; no header ➔ null; any other shape ➔ 401. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header === undefined) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  if (!m) throw new UnauthorizedException(UNAUTHORIZED);
  return m[1];
}

/** JWT required: attaches `req.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedException(UNAUTHORIZED);
    req.user = await this.tokens.verifyAccess(token);
    return true;
  }
}

/** JWT optional: valid ➔ `req.user`; no token ➔ anonymous; invalid or expired ➔ 401. */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (token) req.user = await this.tokens.verifyAccess(token);
    return true;
  }
}
