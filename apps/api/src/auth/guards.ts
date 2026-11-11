import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FeatureFlag,
  resolveFeatureFlags,
  resolveLimits,
  Tenant,
  TenantRole
} from '@pitstop/shared-types';
import type { RequestWithAuth, TenantContext, TenantInfo } from '../common/context';
import { FEATURE, IS_PUBLIC, IS_SESSION_ROUTE, IS_SUPER_ADMIN_ROUTE, ROLES } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { TokenService } from './token.service';

function flag(reflector: Reflector, key: string, context: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) === true;
}

/** Valida o Bearer token em toda rota não pública. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC, context)) return true;
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Autenticação necessária.');
    request.claims = await this.tokens.verifyAccessToken(token);
    return true;
  }
}

export function toTenantInfo(tenant: Tenant): TenantInfo {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    status: tenant.status,
    expires_at: tenant.expires_at,
    contact_phone: tenant.contact_phone,
    feature_flags: resolveFeatureFlags(tenant.plan, tenant.feature_flags),
    limits: resolveLimits(tenant.plan, tenant.limits),
    settings: tenant.settings ?? {}
  };
}

export function assertTenantUsable(tenant: Pick<Tenant, 'status' | 'expires_at'>): void {
  if (tenant.status === 'suspended') {
    throw new ForbiddenException({ message: 'O acesso desta oficina está suspenso. Fale com o suporte PitStop.', code: 'TENANT_SUSPENDED' });
  }
  const expired = tenant.status === 'expired' || (tenant.expires_at !== null && new Date(tenant.expires_at) < new Date());
  if (expired) {
    throw new ForbiddenException({ message: 'A licença desta oficina expirou. Fale com o suporte PitStop.', code: 'TENANT_EXPIRED' });
  }
}

/**
 * Resolve o tenant e o papel do usuário a cada requisição, direto do banco.
 * O JWT só identifica o usuário: status do tenant, papel e vínculo ativo são lidos
 * na hora — por isso suspender uma oficina ou desativar um usuário vale imediatamente.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      flag(this.reflector, IS_PUBLIC, context) ||
      flag(this.reflector, IS_SUPER_ADMIN_ROUTE, context) ||
      flag(this.reflector, IS_SESSION_ROUTE, context)
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    request.ctx = await this.resolve(request);
    return true;
  }

  async resolve(request: RequestWithAuth): Promise<TenantContext> {
    const claims = request.claims;
    if (!claims) throw new UnauthorizedException('Autenticação necessária.');

    if (claims.impersonatedBy) {
      const tenant = await this.db.admin((db) =>
        db.maybeOne<Tenant>('select * from public.tenants where id = $1', [claims.appMetadata.tenant_id])
      );
      if (!tenant) throw new ForbiddenException('Oficina não encontrada.');
      return {
        userId: claims.sub,
        email: claims.email,
        tenantId: tenant.id,
        role: 'owner',
        memberId: null,
        fullName: 'Suporte PitStop',
        impersonatedBy: claims.impersonatedBy,
        tenant: toTenantInfo(tenant)
      };
    }

    const row = await this.db.admin((db) =>
      db.maybeOne<{ member_id: string; role: TenantRole; full_name: string; is_active: boolean; tenant: Tenant }>(
        `select tu.id as member_id, tu.role, tu.full_name, tu.is_active, to_jsonb(t.*) as tenant
           from public.tenant_users tu
           join public.tenants t on t.id = tu.tenant_id
          where tu.user_id = $1`,
        [claims.sub]
      )
    );
    if (!row) throw new ForbiddenException({ message: 'Usuário sem oficina vinculada.', code: 'NO_TENANT' });
    if (!row.is_active) throw new ForbiddenException({ message: 'Seu acesso foi desativado pelo responsável da oficina.', code: 'USER_DISABLED' });
    assertTenantUsable(row.tenant);

    return {
      userId: claims.sub,
      email: claims.email,
      tenantId: row.tenant.id,
      role: row.role,
      memberId: row.member_id,
      fullName: row.full_name,
      tenant: toTenantInfo(row.tenant)
    };
  }
}

/** Valida @Roles(...) e @RequireFeature(...) contra o contexto já resolvido. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const ctx = request.ctx;
    if (!ctx) return true;

    const targets = [context.getHandler(), context.getClass()];
    const feature = this.reflector.getAllAndOverride<FeatureFlag | undefined>(FEATURE, targets);
    if (feature && !ctx.tenant.feature_flags[feature]) {
      throw new ForbiddenException({ message: 'Este módulo não está ativo no plano da oficina.', code: 'FEATURE_DISABLED' });
    }
    const roles = this.reflector.getAllAndOverride<TenantRole[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(ctx.role)) {
      throw new ForbiddenException('Seu perfil não tem permissão para esta ação.');
    }
    return true;
  }
}

/** Protege o painel central: o e-mail precisa estar em super_admins no momento da requisição. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!flag(this.reflector, IS_SUPER_ADMIN_ROUTE, context)) return true;
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const claims = request.claims;
    if (!claims || claims.impersonatedBy) throw new ForbiddenException('Acesso restrito ao painel administrativo.');
    const email = claims.email.toLowerCase();
    const found = await this.db.admin((db) => db.maybeOne('select 1 from public.super_admins where email = $1', [email]));
    if (!found) throw new ForbiddenException('Acesso restrito ao painel administrativo.');
    request.admin = { userId: claims.sub, email };
    return true;
  }
}
