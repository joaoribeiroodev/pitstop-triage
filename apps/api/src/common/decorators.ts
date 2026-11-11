import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FeatureFlag, TenantRole } from '@pitstop/shared-types';
import type { RequestWithAuth, SuperAdminContext, TenantContext } from './context';

export const IS_PUBLIC = 'pitstop:public';
export const IS_SUPER_ADMIN_ROUTE = 'pitstop:super-admin';
export const IS_SESSION_ROUTE = 'pitstop:session';
export const ROLES = 'pitstop:roles';
export const FEATURE = 'pitstop:feature';

/** Rota sem autenticação (login, portal por token, triagem pública). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Rota do painel central: exige super admin e não tem contexto de tenant. */
export const SuperAdminOnly = () => SetMetadata(IS_SUPER_ADMIN_ROUTE, true);
/** Rota que exige apenas JWT válido (ex.: /auth/me), sem exigir tenant ativo. */
export const SessionOnly = () => SetMetadata(IS_SESSION_ROUTE, true);
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES, roles);
export const RequireFeature = (flag: FeatureFlag) => SetMetadata(FEATURE, flag);

export const STAFF_WRITE: TenantRole[] = ['owner', 'manager', 'receptionist'];
export const MANAGEMENT: TenantRole[] = ['owner', 'manager'];

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): TenantContext => {
  const request = host.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.ctx) throw new Error('TenantContext ausente: a rota não passou pelo TenantGuard');
  return request.ctx;
});

export const Admin = createParamDecorator((_: unknown, host: ExecutionContext): SuperAdminContext => {
  const request = host.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.admin) throw new Error('SuperAdminContext ausente: a rota não passou pelo SuperAdminGuard');
  return request.admin;
});
