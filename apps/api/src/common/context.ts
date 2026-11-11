import type { FeatureFlags, TenantLimits, TenantPlan, TenantRole, TenantSettings, TenantStatus } from '@pitstop/shared-types';

/** Claims já validadas do JWT (Supabase ou emitido pelo backend). */
export interface AuthClaims {
  sub: string;
  email: string;
  appMetadata: { tenant_id?: string; role?: string; is_super_admin?: boolean };
  impersonatedBy?: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  expires_at: string | null;
  contact_phone: string | null;
  feature_flags: FeatureFlags;
  limits: TenantLimits;
  settings: TenantSettings;
}

/** Contexto injetado em toda rota de tenant depois do TenantGuard. */
export interface TenantContext {
  userId: string;
  email: string;
  tenantId: string;
  role: TenantRole;
  /** id em tenant_users; null durante impersonation de suporte. */
  memberId: string | null;
  fullName: string;
  impersonatedBy?: string;
  tenant: TenantInfo;
}

export interface SuperAdminContext {
  userId: string;
  email: string;
}

export interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  params: Record<string, string>;
  claims?: AuthClaims;
  ctx?: TenantContext;
  admin?: SuperAdminContext;
}
