import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MeResponse, SessionTokens, Tenant, TenantRole } from '@pitstop/shared-types';
import type { RequestWithAuth } from '../common/context';
import { Public, SessionOnly } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RefreshDto } from './auth.dto';
import { toTenantInfo } from './guards';
import { AUTH_PROVIDER, AuthProvider } from './providers/auth-provider';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly db: DatabaseService
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<SessionTokens> {
    return this.provider.signIn(dto.email.trim().toLowerCase(), dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<SessionTokens> {
    return this.provider.refresh(dto.refresh_token);
  }

  @SessionOnly()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() request: RequestWithAuth): Promise<void> {
    const header = String(request.headers.authorization ?? '');
    await this.provider.signOut(header.replace(/^Bearer /, ''));
  }

  /** Dados da sessão. Não exige tenant ativo: o frontend usa a resposta para explicar bloqueios. */
  @SessionOnly()
  @Get('me')
  async me(@Req() request: RequestWithAuth): Promise<MeResponse> {
    const claims = request.claims!;
    return this.db.admin(async (db) => {
      const isSuperAdmin =
        !claims.impersonatedBy && (await db.maybeOne('select 1 from public.super_admins where email = $1', [claims.email.toLowerCase()])) !== null;

      if (claims.impersonatedBy) {
        const tenant = await db.maybeOne<Tenant>('select * from public.tenants where id = $1', [claims.appMetadata.tenant_id]);
        return {
          id: claims.sub,
          email: claims.email,
          is_super_admin: false,
          impersonated_by: claims.impersonatedBy,
          membership: tenant ? { id: '', role: 'owner' as TenantRole, full_name: 'Suporte PitStop' } : null,
          tenant: tenant ? toTenantInfo(tenant) : null
        };
      }

      const row = await db.maybeOne<{ id: string; role: TenantRole; full_name: string; is_active: boolean; tenant: Tenant }>(
        `select tu.id, tu.role, tu.full_name, tu.is_active, to_jsonb(t.*) as tenant
           from public.tenant_users tu join public.tenants t on t.id = tu.tenant_id
          where tu.user_id = $1`,
        [claims.sub]
      );
      const active = row?.is_active ? row : null;
      return {
        id: claims.sub,
        email: claims.email,
        is_super_admin: isSuperAdmin,
        membership: active ? { id: active.id, role: active.role, full_name: active.full_name } : null,
        tenant: active ? toTenantInfo(active.tenant) : null
      };
    });
  }
}
