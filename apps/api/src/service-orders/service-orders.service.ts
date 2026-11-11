import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConfirmedCause,
  ORDER_TRANSITIONS,
  OrderItem,
  OrderNote,
  OrderStatus,
  Paginated,
  Quote,
  QUOTE_DRIVEN_STATUSES,
  ReportedSymptom,
  ServiceOrder,
  ServiceOrderSummary,
  StatusHistoryEntry
} from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { offsetOf, paginated } from '../common/pagination';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { sanitizeSymptoms } from '../common/symptoms';
import { DatabaseService, Db } from '../database/database.service';
import { DiagnosticsService } from '../diagnostics/diagnostics.module';
import { normalizeBrand } from '../diagnostics/engine';
import { ORDER_SUMMARY_SQL } from './order-sql';
import { Actor, OrderWorkflowService } from './order-workflow.service';
import { BoardQuery, ChangeStatusDto, CreateOrderDto, ItemDto, NoteDto, OrderListQuery, UpdateItemDto, UpdateOrderDto } from './service-orders.dto';

const ITEM_COLUMNS = 'id, type, description, quantity, unit_price, total, sort_order';
/** Itens só são editáveis enquanto não existe compromisso de preço com o cliente. */
const ITEMS_EDITABLE: OrderStatus[] = ['draft', 'diagnosis', 'rejected'];
const CLOSED: OrderStatus[] = ['delivered', 'cancelled'];

export function actorOf(ctx: TenantContext): Actor {
  return { type: ctx.impersonatedBy ? 'support' : 'staff', userId: ctx.userId, name: ctx.fullName };
}

export interface NewOrderInput {
  customer_id: string;
  vehicle_id: string;
  reported_symptoms: ReportedSymptom[];
  free_form_notes: string | null;
  assigned_mechanic_id: string | null;
  triage_session_id: string | null;
}

@Injectable()
export class ServiceOrdersService {
  private readonly logger = new Logger('ServiceOrders');

  constructor(
    private readonly db: DatabaseService,
    private readonly workflow: OrderWorkflowService,
    private readonly diagnostics: DiagnosticsService
  ) {}

  /** Mecânico vê apenas as próprias OS, a menos que a oficina libere a fila inteira. */
  private restricted(ctx: TenantContext): boolean {
    return ctx.role === 'mechanic' && !ctx.tenant.settings.mechanics_see_all_orders;
  }

  private visibility(ctx: TenantContext, params: unknown[]): string | null {
    if (!this.restricted(ctx)) return null;
    params.push(ctx.memberId);
    return `o.assigned_mechanic_id = $${params.length}`;
  }

  list(ctx: TenantContext, query: OrderListQuery): Promise<Paginated<ServiceOrderSummary>> {
    const params: unknown[] = [];
    const where = this.filters(ctx, query, params);
    if (query.status) where.push(`o.status = $${params.push(query.status)}`);
    if (query.customer_id) where.push(`o.customer_id = $${params.push(query.customer_id)}`);
    if (query.vehicle_id) where.push(`o.vehicle_id = $${params.push(query.vehicle_id)}`);
    const clause = where.length ? `where ${where.join(' and ')}` : '';
    return this.db.tenant(rls(ctx), async (db) => {
      const { total } = await db.one<{ total: number }>(
        `select count(*)::int as total from public.service_orders o
           join public.customers c on c.id = o.customer_id join public.vehicles v on v.id = o.vehicle_id ${clause}`,
        params
      );
      const rows = await db.many<ServiceOrderSummary>(
        `${ORDER_SUMMARY_SQL} ${clause} order by o.opened_at desc limit ${query.pageSize} offset ${offsetOf(query)}`,
        params
      );
      return paginated(rows, total, query);
    });
  }

  /** Fila kanban: tudo que está ativo + o que foi encerrado nos últimos 7 dias. */
  board(ctx: TenantContext, query: BoardQuery): Promise<ServiceOrderSummary[]> {
    const params: unknown[] = [];
    const where = this.filters(ctx, query, params);
    where.push(`(o.status not in ('delivered', 'cancelled') or o.updated_at > now() - interval '7 days')`);
    return this.db.tenant(rls(ctx), (db) =>
      db.many<ServiceOrderSummary>(`${ORDER_SUMMARY_SQL} where ${where.join(' and ')} order by o.opened_at limit 500`, params)
    );
  }

  private filters(ctx: TenantContext, query: BoardQuery, params: unknown[]): string[] {
    const where: string[] = [];
    const visible = this.visibility(ctx, params);
    if (visible) where.push(visible);
    if (query.mechanic_id) where.push(`o.assigned_mechanic_id = $${params.push(query.mechanic_id)}`);
    if (query.from) where.push(`o.opened_at >= $${params.push(query.from)}`);
    if (query.to) where.push(`o.opened_at < ($${params.push(query.to)}::date + 1)`);
    const term = query.q?.trim();
    if (term) {
      const n = params.push(`%${term}%`);
      where.push(`(c.name ilike $${n} or v.plate ilike $${n} or o.order_number::text = $${params.push(term.replace(/\D/g, '') || '-1')})`);
    }
    return where;
  }

  get(ctx: TenantContext, id: string): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), (db) => this.load(db, ctx, id));
  }

  async load(db: Db, ctx: TenantContext, id: string): Promise<ServiceOrder> {
    const params: unknown[] = [id];
    const visible = this.visibility(ctx, params);
    const order = await db.maybeOne<ServiceOrder>(
      `select s.*, o.triage_session_id, o.reported_symptoms, o.free_form_notes, o.mechanic_diagnosis, o.confirmed_causes,
              o.mechanic_suggestions_snapshot, o.suggestions_computed_at, o.approved_at, o.started_at, o.completed_at,
              o.delivered_at, cu.phone as customer_phone, ve.brand as vehicle_brand
         from (${ORDER_SUMMARY_SQL} where o.id = $1 ${visible ? `and ${visible}` : ''}) s
         join public.service_orders o on o.id = s.id
         join public.customers cu on cu.id = o.customer_id
         join public.vehicles ve on ve.id = o.vehicle_id`,
      params
    );
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    order.items = await db.many<OrderItem>(
      `select ${ITEM_COLUMNS} from public.service_order_items where service_order_id = $1 order by sort_order, created_at`,
      [id]
    );
    order.history = await db.many<StatusHistoryEntry>(
      `select id, from_status, to_status, actor_type, changed_by_name, note, created_at
         from public.service_order_status_history where service_order_id = $1 order by seq`,
      [id]
    );
    order.notes = await db.many<OrderNote>(
      `select id, author_name, body, visible_to_customer, created_at
         from public.service_order_notes where service_order_id = $1 order by created_at`,
      [id]
    );
    order.quotes = await db.many<Quote>(
      `select id, service_order_id, version, total_amount, status, sent_at, responded_at, responded_via, expires_at, response_notes, created_at
         from public.quotes where service_order_id = $1 order by version desc`,
      [id]
    );
    if (!ctx.tenant.feature_flags.diagnostics) order.mechanic_suggestions_snapshot = null;
    order.allowed_transitions = ORDER_TRANSITIONS[order.status].filter((status) => !QUOTE_DRIVEN_STATUSES.includes(status));
    return order;
  }

  async create(ctx: TenantContext, dto: CreateOrderDto): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      const symptoms = await sanitizeSymptoms(db, dto.reported_symptoms);
      const id = await this.createInTransaction(db, ctx, {
        customer_id: dto.customer_id,
        vehicle_id: dto.vehicle_id,
        reported_symptoms: symptoms,
        free_form_notes: blankToNull(dto.free_form_notes),
        assigned_mechanic_id: dto.assigned_mechanic_id ?? null,
        triage_session_id: null
      });
      return this.load(db, ctx, id);
    });
  }

  /** Criação de OS dentro de uma transação existente (usada também na conversão de triagem). */
  async createInTransaction(db: Db, ctx: TenantContext, input: NewOrderInput): Promise<string> {
    const vehicle = await db.maybeOne<{ customer_id: string }>('select customer_id from public.vehicles where id = $1', [input.vehicle_id]);
    if (!vehicle) throw new BadRequestException('Veículo não encontrado.');
    if (vehicle.customer_id !== input.customer_id) throw new BadRequestException('O veículo não pertence ao cliente informado.');
    if (input.assigned_mechanic_id) await this.assertAssignable(db, input.assigned_mechanic_id);

    // Serializa a numeração por oficina: sem isso, duas aberturas simultâneas disputariam o mesmo número.
    await db.exec('select pg_advisory_xact_lock(hashtextextended($1, 42))', [ctx.tenantId]);
    const usage = await db.one<{ next_number: number; this_month: number }>(
      `select coalesce(max(order_number), 0) + 1 as next_number,
              count(*) filter (where opened_at >= date_trunc('month', now()))::int as this_month
         from public.service_orders`
    );
    if (usage.this_month >= ctx.tenant.limits.max_orders_month) {
      throw new ForbiddenException({
        message: `O plano da oficina permite até ${ctx.tenant.limits.max_orders_month} ordens de serviço por mês.`,
        code: 'LIMIT_REACHED'
      });
    }
    const order = await db.one<{ id: string }>(
      `insert into public.service_orders
         (tenant_id, order_number, customer_id, vehicle_id, triage_session_id, assigned_mechanic_id,
          reported_symptoms, free_form_notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        ctx.tenantId, usage.next_number, input.customer_id, input.vehicle_id, input.triage_session_id,
        input.assigned_mechanic_id, JSON.stringify(input.reported_symptoms), input.free_form_notes, ctx.userId
      ]
    );
    await this.workflow.recordHistory(db, ctx.tenantId, order.id, null, 'draft', actorOf(ctx), 'OS aberta');
    return order.id;
  }

  private async assertAssignable(db: Db, memberId: string): Promise<void> {
    const member = await db.maybeOne('select 1 from public.tenant_users where id = $1 and is_active', [memberId]);
    if (!member) throw new BadRequestException('Responsável não encontrado ou inativo.');
  }

  private async lockOpen(db: Db, ctx: TenantContext, id: string): Promise<{ status: OrderStatus }> {
    const params: unknown[] = [id];
    const visible = this.visibility(ctx, params);
    const order = await db.maybeOne<{ status: OrderStatus }>(
      `select o.status from public.service_orders o where o.id = $1 ${visible ? `and ${visible}` : ''} for update`,
      params
    );
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    if (CLOSED.includes(order.status)) throw new ConflictException('Esta OS já foi encerrada e não pode mais ser alterada.');
    return order;
  }

  update(ctx: TenantContext, id: string, dto: UpdateOrderDto): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      // Assumir uma OS livre é permitido ao mecânico mesmo com a fila restrita.
      const claiming = ctx.role === 'mechanic' && dto.assigned_mechanic_id === ctx.memberId;
      if (claiming && this.restricted(ctx)) {
        const free = await db.maybeOne<{ status: OrderStatus }>(
          `select status from public.service_orders where id = $1 and (assigned_mechanic_id is null or assigned_mechanic_id = $2) for update`,
          [id, ctx.memberId]
        );
        if (!free) throw new NotFoundException('Ordem de serviço não encontrada.');
        if (CLOSED.includes(free.status)) throw new ConflictException('Esta OS já foi encerrada e não pode mais ser alterada.');
      } else {
        await this.lockOpen(db, ctx, id);
      }

      if (dto.assigned_mechanic_id !== undefined) {
        if (ctx.role === 'mechanic' && dto.assigned_mechanic_id !== ctx.memberId) {
          throw new ForbiddenException('Mecânicos só podem assumir ordens para si mesmos.');
        }
        if (dto.assigned_mechanic_id) await this.assertAssignable(db, dto.assigned_mechanic_id);
      }
      let causes: ConfirmedCause[] | undefined;
      if (dto.confirmed_causes) causes = await this.sanitizeCauses(db, dto.confirmed_causes);

      const { sets, values } = buildUpdate(
        {
          assigned_mechanic_id: dto.assigned_mechanic_id,
          mechanic_diagnosis: dto.mechanic_diagnosis === undefined ? undefined : blankToNull(dto.mechanic_diagnosis),
          confirmed_causes: causes === undefined ? undefined : JSON.stringify(causes)
        },
        2
      );
      if (sets.length) await db.exec(`update public.service_orders set ${sets.join(', ')} where id = $1`, [id, ...values]);
      return this.load(db, ctx, id);
    });
  }

  private async sanitizeCauses(db: Db, input: ConfirmedCause[]): Promise<ConfirmedCause[]> {
    const codes = [...new Set(input.map((cause) => cause.symptom_code))];
    const known = await db.many<{ code: string }>('select code from public.symptoms where code = any($1)', [codes]);
    const valid = new Set(known.map((row) => row.code));
    const missing = codes.filter((code) => !valid.has(code));
    if (missing.length) throw new BadRequestException(`Sintoma(s) inexistente(s) no catálogo: ${missing.join(', ')}`);
    const seen = new Set<string>();
    const causes: ConfirmedCause[] = [];
    for (const cause of input) {
      const description = cause.cause_description.trim().replace(/\s+/g, ' ');
      const key = `${cause.symptom_code}|${description.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      causes.push({ symptom_code: cause.symptom_code, cause_description: description });
    }
    return causes;
  }

  // ───────────── itens ─────────────
  private async lockForItems(db: Db, ctx: TenantContext, id: string): Promise<void> {
    const order = await this.lockOpen(db, ctx, id);
    if (!ITEMS_EDITABLE.includes(order.status)) {
      throw new ConflictException('Os itens não podem ser alterados depois que o orçamento foi enviado ou aprovado.');
    }
  }

  addItem(ctx: TenantContext, orderId: string, dto: ItemDto): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.lockForItems(db, ctx, orderId);
      await db.exec(
        `insert into public.service_order_items (tenant_id, service_order_id, type, description, quantity, unit_price, sort_order)
         values ($1, $2, $3, $4, $5, $6,
                 coalesce($7, (select coalesce(max(sort_order), 0) + 1 from public.service_order_items where service_order_id = $2)))`,
        [ctx.tenantId, orderId, dto.type, dto.description.trim(), dto.quantity, dto.unit_price, dto.sort_order ?? null]
      );
      await this.workflow.recalculateTotal(db, orderId);
      return this.load(db, ctx, orderId);
    });
  }

  updateItem(ctx: TenantContext, orderId: string, itemId: string, dto: UpdateItemDto): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.lockForItems(db, ctx, orderId);
      const { sets, values } = buildUpdate(
        { type: dto.type, description: dto.description?.trim(), quantity: dto.quantity, unit_price: dto.unit_price, sort_order: dto.sort_order },
        3
      );
      if (sets.length) {
        const updated = await db.exec(
          `update public.service_order_items set ${sets.join(', ')} where id = $1 and service_order_id = $2`,
          [itemId, orderId, ...values]
        );
        if (!updated) throw new NotFoundException('Item não encontrado.');
      }
      await this.workflow.recalculateTotal(db, orderId);
      return this.load(db, ctx, orderId);
    });
  }

  removeItem(ctx: TenantContext, orderId: string, itemId: string): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.lockForItems(db, ctx, orderId);
      const deleted = await db.exec('delete from public.service_order_items where id = $1 and service_order_id = $2', [itemId, orderId]);
      if (!deleted) throw new NotFoundException('Item não encontrado.');
      await this.workflow.recalculateTotal(db, orderId);
      return this.load(db, ctx, orderId);
    });
  }

  // ───────────── notas ─────────────
  addNote(ctx: TenantContext, orderId: string, dto: NoteDto): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.load(db, ctx, orderId);
      await db.exec(
        `insert into public.service_order_notes (tenant_id, service_order_id, author_id, author_name, body, visible_to_customer)
         values ($1, $2, $3, $4, $5, $6)`,
        [ctx.tenantId, orderId, ctx.userId, ctx.fullName, dto.body.trim(), dto.visible_to_customer ?? false]
      );
      return this.load(db, ctx, orderId);
    });
  }

  // ───────────── status ─────────────
  async changeStatus(ctx: TenantContext, id: string, dto: ChangeStatusDto): Promise<ServiceOrder> {
    if (QUOTE_DRIVEN_STATUSES.includes(dto.status)) {
      throw new BadRequestException('Este status é definido pelo fluxo de orçamento (enviar, aprovar ou recusar), não diretamente.');
    }
    const order = await this.db.tenant(rls(ctx), async (db) => {
      await this.load(db, ctx, id);
      await this.workflow.transition(db, id, dto.status, actorOf(ctx), dto.note);
      if (dto.status === 'cancelled') {
        await db.exec(`update public.quotes set status = 'expired' where service_order_id = $1 and status in ('draft', 'sent')`, [id]);
        await db.exec(`update public.customer_access_tokens set purposes = array['view_order'] where service_order_id = $1`, [id]);
      }
      return this.load(db, ctx, id);
    });
    // Efeito pós-commit: a base de conhecimento da oficina é alimentada depois que a conclusão já está confirmada.
    // Uma falha aqui é registrada, mas nunca desfaz nem bloqueia a conclusão da OS.
    if (dto.status === 'completed') await this.learnFromCompletedOrder(ctx, id);
    return order;
  }

  async recomputeSuggestions(ctx: TenantContext, id: string): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.lockOpen(db, ctx, id);
      const order = await db.one<{ reported_symptoms: ReportedSymptom[]; brand: string | null }>(
        `select o.reported_symptoms, v.brand from public.service_orders o join public.vehicles v on v.id = o.vehicle_id where o.id = $1`,
        [id]
      );
      const snapshot = await this.diagnostics.compute(db, order.reported_symptoms, order.brand);
      await db.exec(
        `update public.service_orders set mechanic_suggestions_snapshot = $2, suggestions_computed_at = now() where id = $1`,
        [id, JSON.stringify(snapshot)]
      );
      return this.load(db, ctx, id);
    });
  }

  private async learnFromCompletedOrder(ctx: TenantContext, orderId: string): Promise<void> {
    try {
      await this.db.tenant(rls(ctx), async (db) => {
        const order = await db.one<{ confirmed_causes: ConfirmedCause[]; total_amount: number; minutes: number | null; brand: string | null }>(
          `select o.confirmed_causes, o.total_amount, v.brand,
                  round(extract(epoch from (o.completed_at - o.started_at)) / 60.0, 2) as minutes
             from public.service_orders o join public.vehicles v on v.id = o.vehicle_id where o.id = $1`,
          [orderId]
        );
        const causes = order.confirmed_causes ?? [];
        if (!causes.length) return;
        const price = Math.round((order.total_amount / causes.length) * 100) / 100;
        const minutes = order.minutes === null ? null : Math.round((order.minutes / causes.length) * 100) / 100;
        for (const cause of causes) {
          await db.exec(
            `insert into public.shop_symptom_stats as s
               (tenant_id, symptom_code, vehicle_brand, cause_description, occurrences, avg_price, avg_duration_minutes)
             values ($1, $2, $3, $4, 1, $5, $6)
             on conflict (tenant_id, symptom_code, vehicle_brand, cause_description) do update set
               occurrences = s.occurrences + 1,
               avg_price = case
                 when excluded.avg_price is null then s.avg_price
                 when s.avg_price is null then excluded.avg_price
                 else round((s.avg_price * s.occurrences + excluded.avg_price) / (s.occurrences + 1), 2) end,
               avg_duration_minutes = case
                 when excluded.avg_duration_minutes is null then s.avg_duration_minutes
                 when s.avg_duration_minutes is null then excluded.avg_duration_minutes
                 else round((s.avg_duration_minutes * s.occurrences + excluded.avg_duration_minutes) / (s.occurrences + 1), 2) end`,
            [ctx.tenantId, cause.symptom_code, normalizeBrand(order.brand), cause.cause_description, price, minutes]
          );
        }
      });
    } catch (error) {
      this.logger.error(`Falha ao atualizar estatísticas da OS ${orderId}: ${(error as Error).message}`);
    }
  }
}
