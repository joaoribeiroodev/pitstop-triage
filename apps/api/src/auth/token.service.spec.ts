import { UnauthorizedException } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';
import { Env, loadEnv } from '../config/env';
import { TokenService } from './token.service';

const APP_SECRET = 'segredo-do-backend-com-32-caracteres!';
const SUPABASE_SECRET = 'segredo-jwt-legado-do-projeto-supabase';

function env(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    AUTH_PROVIDER: 'supabase',
    APP_JWT_SECRET: APP_SECRET,
    DATABASE_URL: 'postgres://localhost/pitstop',
    SUPABASE_URL: 'https://projeto.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_JWT_SECRET: SUPABASE_SECRET,
    ...overrides
  });
}

/** Token no formato que o Supabase Auth emite depois do Custom Access Token Hook. */
function supabaseToken(claims: Record<string, unknown> = {}, secret = SUPABASE_SECRET, expiresIn = 3600): Promise<string> {
  return new SignJWT({
    email: 'dono@oficina.com',
    role: 'authenticated',
    app_metadata: { tenant_id: 't-1', role: 'owner' },
    ...claims
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('https://projeto.supabase.co/auth/v1')
    .setSubject('user-1')
    .setAudience(String(claims.aud ?? 'authenticated'))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe('TokenService', () => {
  it('aceita JWT do Supabase e normaliza tenant_id e role vindos do app_metadata', async () => {
    const claims = await new TokenService(env()).verifyAccessToken(await supabaseToken());
    expect(claims).toEqual({ sub: 'user-1', email: 'dono@oficina.com', appMetadata: { tenant_id: 't-1', role: 'owner' }, impersonatedBy: undefined });
  });

  it('recusa JWT do Supabase com assinatura errada, expirado ou de outra audiência', async () => {
    const service = new TokenService(env());
    await expect(service.verifyAccessToken(await supabaseToken({}, 'outro-segredo-qualquer-de-outro-projeto'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAccessToken(await supabaseToken({}, SUPABASE_SECRET, -60))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAccessToken(await supabaseToken({ aud: 'anon' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAccessToken('isto-nao-e-um-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem segredo legado, valida a assinatura assimétrica pelo JWKS público do projeto', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'chave-1', alg: 'ES256', use: 'sig' };
    // Um servidor local faz o papel do endpoint público de chaves do projeto Supabase.
    const requested: string[] = [];
    const server = createServer((request, response) => {
      requested.push(String(request.url));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const projectUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const sign = (key: KeyLike, alg: string) =>
        new SignJWT({ email: 'dono@oficina.com', app_metadata: { tenant_id: 't-1', role: 'owner' } })
          .setProtectedHeader({ alg, kid: 'chave-1' })
          .setIssuer(`${projectUrl}/auth/v1`)
          .setSubject('user-1')
          .setAudience('authenticated')
          .setExpirationTime('1h')
          .sign(key);
      const service = new TokenService(env({ SUPABASE_JWT_SECRET: '', SUPABASE_URL: projectUrl }));
      await expect(service.verifyAccessToken(await sign(privateKey, 'ES256'))).resolves.toMatchObject({ sub: 'user-1', appMetadata: { tenant_id: 't-1' } });
      expect(requested).toEqual(['/auth/v1/.well-known/jwks.json']);

      const intruder = await generateKeyPair('ES256');
      await expect(service.verifyAccessToken(await sign(intruder.privateKey, 'ES256'))).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('com o provedor local, tokens de emissor externo nunca são aceitos', async () => {
    const local = new TokenService(env({ AUTH_PROVIDER: 'local' }));
    await expect(local.verifyAccessToken(await supabaseToken())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de suporte carrega quem está impersonando; refresh token não vale como acesso', async () => {
    const service = new TokenService(env());
    const support = await service.signAppToken(
      {
        sub: 'admin-1',
        email: 'admin@pitstop.app',
        app_metadata: { tenant_id: 't-1', role: 'owner' },
        impersonated_by: 'admin@pitstop.app',
        typ: 'impersonation'
      },
      900
    );
    await expect(service.verifyAccessToken(support)).resolves.toMatchObject({ sub: 'admin-1', impersonatedBy: 'admin@pitstop.app' });

    const refresh = await service.signAppToken({ sub: 'user-1', typ: 'refresh' }, 900);
    await expect(service.verifyAccessToken(refresh)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAppToken(refresh, 'refresh')).resolves.toMatchObject({ sub: 'user-1' });

    const semSub = await service.signAppToken({ typ: 'access' }, 900);
    await expect(service.verifyAccessToken(semSub)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token assinado por outro backend não passa', async () => {
    const outro = new TokenService(env({ APP_JWT_SECRET: 'um-segredo-completamente-diferente-123' }));
    const token = await outro.signAppToken({ sub: 'user-1', typ: 'access' }, 900);
    await expect(new TokenService(env()).verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
