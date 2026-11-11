import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderItem, OrderStatus, Quote, SendQuoteResponse } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { rls } from '../common/rls';
import { ENV, Env } from '../config/env';
import { DatabaseService, Db } from '../database/database.service';
import { Actor, OrderWorkflowService } from '../service-orders/order-workflow.service';
import { ItemDto } from '../service-orders/service-orders.dto';
import { actorOf } from '../service-orders/service-orders.service';
import { AccessTokenService } from './access-token.service';

const QUOTE_COLUMNS =
  'id, service_order_id, version, total_amount, status, sent_at, responded_at, responded_via, expires_at, response_notes, created_at';
const ITEM_COLUMNS = 'id, type, description, quantity, unit_price, total, sort_order';

export type QuoteDecision = 'approved' | 'rejected';

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workflow: OrderWorkflowService,
    private readonly tokens: AccessTokenService,
    @Inject(ENV) private readonly env: Env
  ) {}

  private async loadQuote(db: Db, id: string, lock = false): Promise<Quote & { tenant_id: string }> {
    const quote = await db.maybeOne<Quote & { tenant_id: string }>(
      `select ${QUOTE_COLUMNS}, tenant_id from public.quotes where id = $1 ${lock ? 'for update' : ''}`,
      [id]
    );
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');
    return quote;
  }

  private async withItems(db: Db, id: string): Promise<Quote> {
    const { tenant_id: _tenant, ...quote } = await this.loadQuote(db, id);
    const items = await db.many<OrderItem>(
      `select ${ITEM_COLUMNS} from public.quote_items where quote_id = $1 order by sort_order, created_at`,
      [id]
    );
    return { ...quote, items };
  }

  private async recalculate(db: Db, quoteId: string): Promise<number> {
    const row = await db.one<{ total_amount: number }>(
      `update public.quotes q
          set total_amount = coalesce((select sum(i.total) from public.quote_items i where i.quote_id = q.id), 0)
        where q.id = $1 returning total_amount`,
      [quoteId]
    );
    return row.total_amount;
  }

  get(ctx: TenantContext, id: string): Promise<Quote> {
    return this.db.tenant(rls(ctx), (db) => this.withItems(db, id));
  }

  listForOrder(ctx: TenantContext, orderId: string): Promise<Quote[]> {
    return this.db.tenant(rls(ctx), (db) =>
      db.many<Quote>(`select ${QUOTE_COLUMNS} from public.quotes where service_order_id = $1 order by version desc`, [orderId])
    );
  }

  /** Novo orçamento (rascunho) com cópia dos itens atuais da OS. Rascunhos anteriores são descartados. */
  createFromOrder(ctx: TenantContext, orderId: string): Promise<Quote> {
    return this.db.tenant(rls(ctx), async (db) => {
      const order = await db.maybeOne<{ status: OrderStatus }>('select status from public.service_orders where id = $1 for update', [orderId]);
      if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
      if (!['diagnosis', 'rejected'].includes(order.status)) {
        throw new ConflictException('O orçamento é montado enquanto a OS está em diagnóstico (ou após uma recusa).');
      }
      await db.exec(`update public.quotes set status = 'expired' where service_order_id = $1 and status = 'draft'`, [orderId]);
      const quote = await db.one<{ id: string }>(
        `insert into public.quotes (tenant_id, service_order_id, version, created_by)
         values ($1, $2, (select coalesce(max(version), 0) + 1 from public.quotes where service_order_id = $2), $3)
         returning id`,
        [ctx.tenantId, orderId, ctx.userId]
      );
      await db.exec(
        `insert into public.quote_items (tenant_id, quote_id, type, description, quantity, unit_price, sort_order)
         select tenant_id, $2, type, description, quantity, unit_price, sort_order
           from public.service_order_items where service_order_id = $1`,
        [orderId, quote.id]
      );
      await this.recalculate(db, quote.id);
      return this.withItems(db, quote.id);
    });
  }

  /** Substitui todos os itens de um orçamento em rascunho. */
  replaceItems(ctx: TenantContext, id: string, items: ItemDto[]): Promise<Quote> {
    return this.db.tenant(rls(ctx), async (db) => {
      const quote = await this.loadQuote(db, id, true);
      if (quote.status !== 'draft') throw new ConflictException('Somente orçamentos em rascunho podem ser editados.');
      await db.exec('delete from public.quote_items where quote_id = $1', [id]);
      for (const [index, item] of items.entries()) {
        await db.exec(
          `insert into public.quote_items (tenant_id, quote_id, type, description, quantity, unit_price, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [ctx.tenantId, id, item.type, item.description.trim(), item.quantity, item.unit_price, item.sort_order ?? index + 1]
        );
      }
      await this.recalculate(db, id);
      return this.withItems(db, id);
    });
  }

  /** Envia ao cliente: congela o orçamento, gera o link tokenizado e coloca a OS em "aguardando aprovação". */
  send(ctx: TenantContext, id: string): Promise<SendQuoteResponse> {
    const days = ctx.tenant.settings.portal_token_days ?? 30;
    return this.db.tenant(rls(ctx), async (db) => {
      const quote = await this.loadQuote(db, id, true);
      if (quote.status !== 'draft') throw new ConflictException('Este orçamento já foi enviado ou encerrado.');
      const total = await this.recalculate(db, id);
      const { count } = await db.one<{ count: number }>('select count(*)::int as count from public.quote_items where quote_id = $1', [id]);
      if (count === 0) throw new BadRequestException('Adicione ao menos um item antes de enviar o orçamento.');

      const order = await db.one<{ status: OrderStatus; order_number: number; customer_name: string; phone: string | null; plate: string; vehicle: string }>(
        `select o.status, o.order_number, c.name as customer_name, c.phone, v.plate,
                trim(concat_ws(' ', v.brand, v.model)) as vehicle
           from public.service_orders o
           join public.customers c on c.id = o.customer_id
           join public.vehicles v on v.id = o.vehicle_id
          where o.id = $1 for update of o`,
        [quote.service_order_id]
      );
      const actor = actorOf(ctx);
      if (order.status === 'rejected') await this.workflow.transition(db, quote.service_order_id, 'diagnosis', actor, 'Orçamento revisado');

      // Um link por vez: orçamentos enviados antes deixam de valer e seus tokens perdem o poder de aprovar.
      await db.exec(`update public.quotes set status = 'expired' where service_order_id = $1 and status = 'sent'`, [quote.service_order_id]);
      await db.exec(
        `update public.customer_access_tokens set revoked_at = now()
          where service_order_id = $1 and revoked_at is null and 'approve_quote' = any(purposes)`,
        [quote.service_order_id]
      );
      await db.exec(
        `update public.quotes set status = 'sent', sent_at = now(), expires_at = now() + make_interval(days => $2) where id = $1`,
        [id, days]
      );
      await this.workflow.transition(db, quote.service_order_id, 'awaiting_approval', actor, `Orçamento v${quote.version} enviado`);

      const issued = await this.tokens.issue(db, {
        tenantId: ctx.tenantId,
        orderId: quote.service_order_id,
        quoteId: id,
        purposes: ['view_order', 'approve_quote'],
        days,
        createdBy: ctx.userId
      });
      const portalUrl = `${this.env.portalBaseUrl}/portal/${issued.token}`;
      const firstName = order.customer_name.split(' ')[0];
      const message =
        `Olá, ${firstName}! O orçamento do seu ${order.vehicle || 'veículo'} (placa ${order.plate}) na ${ctx.tenant.name} está pronto. ` +
        `Total: ${formatBRL(total)}. Veja os detalhes e aprove ou recuse pelo link: ${portalUrl}`;
      const phone = order.phone && /^\d{10,11}$/.test(order.phone) ? order.phone : null;
      return {
        quote: await this.withItems(db, id),
        portal_url: portalUrl,
        message,
        whatsapp_url: phone ? `https://wa.me/55${phone}?text=${encodeURIComponent(message)}` : null,
        expires_at: issued.expires_at
      };
    });
  }

  /** Registro manual pela oficina (cliente respondeu no balcão ou por telefone). */
  respondAsStaff(ctx: TenantContext, id: string, decision: QuoteDecision, notes?: string): Promise<Quote> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.respondInTransaction(db, id, decision, 'staff', notes, actorOf(ctx));
      return this.withItems(db, id);
    });
  }

  /**
   * Aprovação/recusa — usada pela oficina e pelo portal (lá, em transação privilegiada já autorizada pelo token).
   * Ao aprovar, os itens do orçamento passam a ser os itens da OS e ela avança para "aprovada".
   */
  async respondInTransaction(db: Db, quoteId: string, decision: QuoteDecision, via: 'portal' | 'staff', notes: string | undefined, actor: Actor): Promise<void> {
    const quote = await this.loadQuote(db, quoteId, true);
    if (quote.status !== 'sent') throw new ConflictException('Este orçamento não está mais aguardando resposta.');
    if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
      throw new ConflictException('Este orçamento expirou. Peça à oficina um novo envio.');
    }
    await db.exec(
      `update public.quotes set status = $2, responded_at = now(), responded_via = $3, response_notes = $4 where id = $1`,
      [quoteId, decision, via, notes?.trim() || null]
    );
    if (decision === 'approved') {
      await db.exec('delete from public.service_order_items where service_order_id = $1', [quote.service_order_id]);
      await db.exec(
        `insert into public.service_order_items (tenant_id, service_order_id, type, description, quantity, unit_price, sort_order)
         select tenant_id, $2, type, description, quantity, unit_price, sort_order from public.quote_items where quote_id = $1`,
        [quoteId, quote.service_order_id]
      );
    }
    const label = via === 'portal' ? 'pelo cliente no portal' : 'registrada pela oficina';
    await this.workflow.transition(
      db,
      quote.service_order_id,
      decision,
      actor,
      decision === 'approved' ? `Orçamento v${quote.version} aprovado (${label})` : `Orçamento v${quote.version} recusado (${label})`
    );
  }

  // ───────────── links de acompanhamento ─────────────
  /** Link somente de acompanhamento (sem poder de aprovar), para OS sem orçamento pendente. */
  issueTrackingLink(ctx: TenantContext, orderId: string): Promise<{ portal_url: string; expires_at: string }> {
    const days = ctx.tenant.settings.portal_token_days ?? 30;
    return this.db.tenant(rls(ctx), async (db) => {
      const order = await db.maybeOne('select 1 from public.service_orders where id = $1', [orderId]);
      if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
      const issued = await this.tokens.issue(db, {
        tenantId: ctx.tenantId, orderId, quoteId: null, purposes: ['view_order'], days, createdBy: ctx.userId
      });
      return { portal_url: `${this.env.portalBaseUrl}/portal/${issued.token}`, expires_at: issued.expires_at };
    });
  }

  listLinks(ctx: TenantContext, orderId: string) {
    return this.db.tenant(rls(ctx), (db) =>
      db.many(
        `select id, quote_id, purposes, expires_at, revoked_at, last_used_at, consent_at, created_at
           from public.customer_access_tokens where service_order_id = $1 order by created_at desc`,
        [orderId]
      )
    );
  }

  async revokeLink(ctx: TenantContext, tokenId: string): Promise<void> {
    const revoked = await this.db.tenant(rls(ctx), (db) =>
      db.exec('update public.customer_access_tokens set revoked_at = coalesce(revoked_at, now()) where id = $1', [tokenId])
    );
    if (!revoked) throw new NotFoundException('Link não encontrado.');
  }
}
