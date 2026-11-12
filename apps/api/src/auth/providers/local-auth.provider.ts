import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SessionTokens } from '@pitstop/shared-types';
import { DatabaseService } from '../../database/database.service';
import { TokenService } from '../token.service';
import type { AppMetadata, AuthProvider, CreateUserInput } from './auth-provider';

const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

interface LocalUser {
  id: string;
  email: string;
  encrypted_password: string | null;
  raw_app_meta_data: AppMetadata;
}

/**
 * Provedor de identidade local — SOMENTE desenvolvimento e testes (o loadEnv
 * recusa AUTH_PROVIDER=local em produção). Guarda usuários na tabela auth.users
 * do shim local e emite JWTs assinados pelo próprio backend.
 */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  constructor(
    private readonly db: DatabaseService,
    @Inject(TokenService) private readonly tokens: TokenService
  ) {}

  async signIn(email: string, password: string): Promise<SessionTokens> {
    const user = await this.db.admin((db) => db.maybeOne<LocalUser>('select * from auth.users where email = $1', [email.toLowerCase()]));
    if (!user?.encrypted_password || !verifyPassword(password, user.encrypted_password)) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    return this.issue(user);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const payload = await this.tokens.verifyAppToken(refreshToken, 'refresh').catch(() => null);
    if (!payload?.sub) throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    const user = await this.db.admin((db) => db.maybeOne<LocalUser>('select * from auth.users where id = $1', [payload.sub]));
    if (!user) throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    return this.issue(user);
  }

  async signOut(): Promise<void> {
    // Tokens locais são stateless; o logout é responsabilidade do cliente.
  }

  async createUser(input: CreateUserInput): Promise<{ id: string; invited: boolean }> {
    const email = input.email.toLowerCase();
    const row = await this.db.admin((db) =>
      db.one<{ id: string }>(
        `insert into auth.users (email, encrypted_password, raw_app_meta_data)
         values ($1, $2, $3)
         on conflict (email) do update set raw_app_meta_data = excluded.raw_app_meta_data, updated_at = now()
         returning id`,
        [email, input.password ? hashPassword(input.password) : null, JSON.stringify(input.appMetadata)]
      )
    );
    return { id: row.id, invited: !input.password };
  }

  async updateAppMetadata(userId: string, appMetadata: AppMetadata): Promise<void> {
    await this.db.admin((db) =>
      db.exec('update auth.users set raw_app_meta_data = $2, updated_at = now() where id = $1', [userId, JSON.stringify(appMetadata)])
    );
  }

  async findUserId(email: string): Promise<string | null> {
    const user = await this.db.admin((db) => db.maybeOne<{ id: string }>('select id from auth.users where email = $1', [email.toLowerCase()]));
    return user?.id ?? null;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const updated = await this.db.admin((db) =>
      db.exec('update auth.users set encrypted_password = $2, updated_at = now() where id = $1', [userId, hashPassword(password)])
    );
    if (!updated) throw new ConflictException('Usuário não encontrado no provedor local.');
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.admin((db) => db.exec('delete from auth.users where id = $1', [userId]));
  }

  private async issue(user: LocalUser): Promise<SessionTokens> {
    const access = await this.tokens.signAppToken(
      { sub: user.id, email: user.email, app_metadata: user.raw_app_meta_data ?? {}, typ: 'access' },
      ACCESS_TTL_SECONDS
    );
    const refresh = await this.tokens.signAppToken({ sub: user.id, typ: 'refresh' }, REFRESH_TTL_SECONDS);
    return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_SECONDS };
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}
