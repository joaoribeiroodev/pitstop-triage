import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPurpose } from '@pitstop/shared-types';
import type { Db } from '../database/database.service';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssueTokenInput {
  tenantId: string;
  orderId: string;
  quoteId: string | null;
  purposes: TokenPurpose[];
  days: number;
  createdBy: string | null;
}

/**
 * Tokens de acesso do cliente: UUID v4 entregue em claro uma única vez (na URL),
 * e apenas o hash SHA-256 persistido. Um vazamento do banco não expõe links válidos.
 */
@Injectable()
export class AccessTokenService {
  async issue(db: Db, input: IssueTokenInput): Promise<{ id: string; token: string; expires_at: string }> {
    const token = randomUUID();
    const row = await db.one<{ id: string; expires_at: string }>(
      `insert into public.customer_access_tokens
         (tenant_id, token_hash, service_order_id, quote_id, purposes, expires_at, created_by)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)
       returning id, expires_at`,
      [input.tenantId, hashToken(token), input.orderId, input.quoteId, input.purposes, input.days, input.createdBy]
    );
    return { id: row.id, token, expires_at: row.expires_at };
  }
}
