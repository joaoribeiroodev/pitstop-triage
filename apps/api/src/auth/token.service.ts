import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, jwtVerify, JWTPayload, SignJWT } from 'jose';
import type { AuthClaims } from '../common/context';
import { ENV, Env } from '../config/env';

export const APP_ISSUER = 'pitstop-api';

type AppTokenType = 'access' | 'refresh' | 'impersonation';

@Injectable()
export class TokenService {
  private readonly appKey: Uint8Array;
  private readonly supabaseKey: Uint8Array | null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.appKey = new TextEncoder().encode(env.appJwtSecret);
    this.supabaseKey = env.supabaseJwtSecret ? new TextEncoder().encode(env.supabaseJwtSecret) : null;
  }

  /** Valida um access token de qualquer um dos dois emissores aceitos e normaliza as claims. */
  async verifyAccessToken(token: string): Promise<AuthClaims> {
    try {
      const issuer = decodeJwt(token).iss;
      const payload = issuer === APP_ISSUER ? await this.verifyAppToken(token, ['access', 'impersonation']) : await this.verifySupabase(token);
      if (!payload.sub) throw new Error('token sem sub');
      return {
        sub: payload.sub,
        email: String(payload.email ?? ''),
        appMetadata: (payload.app_metadata as AuthClaims['appMetadata']) ?? {},
        impersonatedBy: payload.impersonated_by ? String(payload.impersonated_by) : undefined
      };
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }

  async verifyAppToken(token: string, expected: AppTokenType | AppTokenType[]): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.appKey, { issuer: APP_ISSUER, algorithms: ['HS256'] });
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(payload.typ as AppTokenType)) throw new Error('tipo de token inesperado');
    return payload;
  }

  async signAppToken(payload: JWTPayload & { typ: AppTokenType }, ttlSeconds: number): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(APP_ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(this.appKey);
  }

  private async verifySupabase(token: string): Promise<JWTPayload> {
    if (this.env.authProvider !== 'supabase') throw new Error('emissor não aceito');
    const options = { audience: 'authenticated' };
    if (this.supabaseKey) {
      return (await jwtVerify(token, this.supabaseKey, { ...options, algorithms: ['HS256'] })).payload;
    }
    this.jwks ??= createRemoteJWKSet(new URL(`${this.env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    return (await jwtVerify(token, this.jwks, options)).payload;
  }
}
