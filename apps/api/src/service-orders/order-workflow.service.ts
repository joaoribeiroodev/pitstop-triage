import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransition, ORDER_STATUS_LABELS, OrderStatus, ReportedSymptom } from '@pitstop/shared-types';
import type { Db } from '../database/database.service';
import { DiagnosticsService } from '../diagnostics/diagnostics.module';

export interface Actor {
  type: 'staff' | 'customer' | 'system' | 'support';
  userId: string | null;
  name: string | null;
}

interface LockedOrder {
  id: string;
  tenant_id: string;
  status: OrderStatus;
  reported_symptoms: ReportedSymptom[];
  mechanic_suggestions_snapshot: unknown | null;
  brand: string | null;
}

const TIMESTAMP_COLUMN: Partial<Record<OrderStatus, string>> = {
  diagnosis: 'diagnosis_started_at',
  approved: 'approved_at',
  in_progress: 'started_at',
  completed: 'completed_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at'
};

/**
 * Único ponto do sistema que altera o status de uma OS.
 * Sempre roda dentro da transação de quem chama: validação, atualização, efeitos colaterais
 * e histórico são confirmados juntos ou desfeitos juntos.
 */
@Injectable()
export class OrderWorkflowService {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  async transition(db: Db, orderId: string, to: OrderStatus, actor: Actor, note?: string | null): Promise<{ from: OrderStatus; to: OrderStatus }> {
    const order = await db.maybeOne<LockedOrder>(
      `select o.id, o.tenant_id, o.status, o.reported_symptoms, o.mechanic_suggestions_snapshot, v.brand
         from public.service_orders o join public.vehicles v on v.id = o.vehicle_id
        where o.id = $1 for update of o`,
      [orderId]
    );
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');

    const from = order.status;
    if (!canTransition(from, to)) {
      throw new ConflictException(`Transição não permitida: "${ORDER_STATUS_LABELS[from]}" → "${ORDER_STATUS_LABELS[to]}".`);
    }
    await this.assertInvariants(db, order, to);

    const sets = ['status = $2'];
    const params: unknown[] = [orderId, to];
    const stamp = TIMESTAMP_COLUMN[to];
    if (stamp) sets.push(`${stamp} = coalesce(${stamp}, now())`);

    // Snapshot das sugestões: tirado uma única vez, na primeira entrada em diagnóstico. Depois disso só muda por recálculo explícito.
    if (to === 'diagnosis' && order.mechanic_suggestions_snapshot === null) {
      const snapshot = await this.diagnostics.compute(db, order.reported_symptoms, order.brand);
      params.push(JSON.stringify(snapshot));
      sets.push(`mechanic_suggestions_snapshot = $${params.length}`, 'suggestions_computed_at = now()');
    }

    await db.exec(`update public.service_orders set ${sets.join(', ')} where id = $1`, params);
    await this.recalculateTotal(db, orderId);
    await this.recordHistory(db, order.tenant_id, orderId, from, to, actor, note);
    return { from, to };
  }

  private async assertInvariants(db: Db, order: LockedOrder, to: OrderStatus): Promise<void> {
    if (to === 'awaiting_approval') {
      const sent = await db.maybeOne(`select 1 from public.quotes where service_order_id = $1 and status = 'sent'`, [order.id]);
      if (!sent) throw new BadRequestException('A OS só aguarda aprovação depois que um orçamento é enviado ao cliente.');
    }
    if (to === 'approved') {
      const approved = await db.maybeOne(`select 1 from public.quotes where service_order_id = $1 and status = 'approved'`, [order.id]);
      if (!approved) throw new BadRequestException('A OS só pode ser aprovada com um orçamento aprovado.');
    }
    if (to === 'rejected') {
      const rejected = await db.maybeOne(`select 1 from public.quotes where service_order_id = $1 and status = 'rejected'`, [order.id]);
      if (!rejected) throw new BadRequestException('A OS só é marcada como recusada quando o cliente recusa um orçamento.');
    }
  }

  async recalculateTotal(db: Db, orderId: string): Promise<number> {
    const row = await db.one<{ total_amount: number }>(
      `update public.service_orders o
          set total_amount = coalesce((select sum(i.total) from public.service_order_items i where i.service_order_id = o.id), 0)
        where o.id = $1 returning total_amount`,
      [orderId]
    );
    return row.total_amount;
  }

  async recordHistory(db: Db, tenantId: string, orderId: string, from: OrderStatus | null, to: OrderStatus, actor: Actor, note?: string | null): Promise<void> {
    await db.exec(
      `insert into public.service_order_status_history
         (tenant_id, service_order_id, from_status, to_status, actor_type, changed_by, changed_by_name, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, orderId, from, to, actor.type, actor.userId, actor.name, note?.trim() || null]
    );
  }
}
