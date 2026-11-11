import type { RlsIdentity } from '../database/database.service';
import type { TenantContext } from './context';

export function rls(ctx: TenantContext): RlsIdentity {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, timezone: ctx.tenant.settings.timezone };
}

export function onlyDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length ? digits : null;
}

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Monta "set col = $n" apenas para os campos presentes no DTO (PATCH parcial). */
export function buildUpdate(fields: Record<string, unknown>, startAt = 1): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${startAt + values.length - 1}`);
  }
  return { sets, values };
}
