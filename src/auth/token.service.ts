import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { AppConfigService } from '../config/app-config.service';
import type { AuthUser, Role } from '../types/auth-user';
import { RefreshToken } from './schemas/refresh-token.schema';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const TOKEN_EXPIRED = 'token expired';
export const UNAUTHORIZED = 'unauthorized';

interface AccessClaims {
  sub: string;
  roles: Role[];
}

export interface IssuedTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

/** Outcome of consuming a refresh token (the caller decides what to log and throw). */
export type ConsumeResult =
  | { ok: true; userId: string; familyId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'race' };

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokens: Model<RefreshToken>,
  ) {}

  /** HMAC-SHA256 keyed with JWT_REFRESH_SECRET: a leaked DB alone cannot be replayed. */
  hashRefresh(raw: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET'))
      .update(raw)
      .digest('hex');
  }

  newFamilyId(): string {
    return randomUUID();
  }

  async issue(user: AuthUser, familyId: string): Promise<IssuedTokens> {
    const claims: AccessClaims = { sub: user.id, roles: user.roles };
    const access_token = await this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TTL_SECONDS,
    });
    const raw = randomBytes(32).toString('base64url');
    await this.refreshTokens.create({
      user_id: new Types.ObjectId(user.id),
      token_hash: this.hashRefresh(raw),
      family_id: familyId,
      expires_at: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: raw,
    };
  }

  /** Verifies an access token; expired ➔ 401 `token expired`, anything else ➔ 401 `unauthorized`. */
  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const c = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      if (typeof c.sub !== 'string' || !Array.isArray(c.roles)) {
        throw new UnauthorizedException(UNAUTHORIZED);
      }
      return { id: c.sub, roles: c.roles };
    } catch (e) {
      throw new UnauthorizedException(
        e instanceof TokenExpiredError ? TOKEN_EXPIRED : UNAUTHORIZED,
      );
    }
  }

  /**
   * Revokes a refresh token so it can be used once. A token that was already revoked means it
   * leaked: its whole family is revoked. The conditional update makes two concurrent refreshes
   * with the same token succeed at most once.
   */
  async consume(raw: string): Promise<ConsumeResult> {
    const hash = this.hashRefresh(raw);
    const rec = await this.refreshTokens.findOne({ token_hash: hash }).lean();
    if (!rec) return { ok: false, reason: 'invalid' };
    if (rec.expires_at.getTime() <= Date.now())
      return { ok: false, reason: 'expired' };
    if (rec.revoked_at) {
      await this.revokeFamily(rec.family_id);
      return { ok: false, reason: 'reused' };
    }
    const won = await this.refreshTokens.findOneAndUpdate(
      { _id: rec._id, revoked_at: null },
      { $set: { revoked_at: new Date() } },
    );
    if (!won) return { ok: false, reason: 'race' };
    return {
      ok: true,
      userId: rec.user_id.toString(),
      familyId: rec.family_id,
    };
  }

  async revokeOne(raw: string, userId: string): Promise<void> {
    await this.refreshTokens.updateOne(
      {
        token_hash: this.hashRefresh(raw),
        user_id: new Types.ObjectId(userId),
        revoked_at: null,
      },
      { $set: { revoked_at: new Date() } },
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.updateMany(
      { family_id: familyId, revoked_at: null },
      { $set: { revoked_at: new Date() } },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.updateMany(
      { user_id: new Types.ObjectId(userId), revoked_at: null },
      { $set: { revoked_at: new Date() } },
    );
  }
}
