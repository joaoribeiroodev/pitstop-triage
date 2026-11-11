import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  AnswerValue,
  FollowUpQuestion,
  ORDER_STATUS_LABELS,
  OrderStatus,
  PortalHistoryEntry,
  PortalOrderResponse,
  PortalQuote,
  QuoteStatus,
  ReportedSymptom,
  TenantStatus,
  TokenPurpose
} from '@pitstop/shared-types';
import type { RequestWithAuth } from '../common/context';
import { Public } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { DatabaseService, Db } from '../database/database.service';
import { hashToken } from '../quotes/access-token.service';
import { QuotesModule } from '../quotes/quotes.module';
import { QuotesService } from '../quotes/quotes.service';

export class PortalRejectDto {
  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;
}

interface TokenRow {
  id: string;
  tenant_id: string;
  service_order_id: string;
  quote_id: string | null;
  purposes: TokenPurpose[];
  consent_at: string | null;
  shop_name: string;
  shop_phone: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Portal do cliente. Nenhuma rota aqui tem usuário autenticado: a autorização é o token opaco da URL.
 * As consultas rodam em transação privilegiada, então TODA query é ancorada no service_order_id do token
 * e as respostas são montadas campo a campo — nada de devolver entidade interna.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly quotes: QuotesService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Mesma resposta para token inexistente, expirado, revogado ou de oficina bloqueada: não revela nada. */
  private async authorize(db: Db, token: string, purpose: TokenPurpose): Promise<TokenRow> {
    const denied = new NotFoundException('Link inválido ou expirado. Peça um novo link à oficina.');
    if (!UUID.test(token)) throw denied;
    const row = await db.maybeOne<TokenRow & { tenant_status: TenantStatus; tenant_expires_at: string | null; portal_enabled: boolean }>(
      `select t.id, t.tenant_id, t.service_order_id, t.quote_id, t.purposes, t.consent_at,
              tn.name as shop_name, tn.contact_phone as shop_phone, tn.status as tenant_status, tn.expires_at as tenant_expires_at,
              coalesce((tn.feature_flags ->> 'portal')::boolean, true) as portal_enabled
         from public.customer_access_tokens t
         join public.tenants tn on tn.id = t.tenant_id
        where t.token_hash = $1 and t.revoked_at is null and t.expires_at > now()`,
      [hashToken(token)]
    );
    if (!row || !row.purposes.includes(purpose) || !row.portal_enabled) throw denied;
    const blocked =
      row.tenant_status !== 'active' || (row.tenant_expires_at !== null && new Date(row.tenant_expires_at) < new Date());
    if (blocked) throw denied;
    await db.exec('update public.customer_access_tokens set last_used_at = now() where id = $1', [row.id]);
    return row;
  }

  private assertConsent(access: TokenRow): void {
    if (!access.consent_at) {
      throw new ForbiddenException({ message: 'É necessário aceitar a política de privacidade para continuar.', code: 'CONSENT_REQUIRED' });
    }
  }

  /** Primeiro contato: só o necessário para exibir o aviso de privacidade. */
  intro(token: string) {
    return this.db.admin(async (db) => {
      const access = await this.authorize(db, token, 'view_order');
      return {
        shop_name: access.shop_name,
        consent_required: !access.consent_at,
        privacy_policy_version: this.env.privacyPolicyVersion
      };
    });
  }

  consent(token: string, request: RequestWithAuth): Promise<void> {
    return this.db.admin(async (db) => {
      const access = await this.authorize(db, token, 'view_order');
      if (access.consent_at) return;
      await db.exec('update public.customer_access_tokens set consent_at = now() where id = $1', [access.id]);
      await db.exec(
        `insert into public.customer_consent_log (tenant_id, access_token_id, service_order_id, policy_version, ip, user_agent)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          access.tenant_id, access.id, access.service_order_id, this.env.privacyPolicyVersion,
          request.ip ?? null, String(request.headers['user-agent'] ?? '').slice(0, 300) || null
        ]
      );
    });
  }

  order(token: string): Promise<PortalOrderResponse> {
    return this.db.admin(async (db) => {
      const access = await this.authorize(db, token, 'view_order');
      this.assertConsent(access);
      const orderId = access.service_order_id;

      const order = await db.one<{
        order_number: number; status: OrderStatus; opened_at: string; total_amount: number;
        reported_symptoms: ReportedSymptom[]; free_form_notes: string | null; triage_source: string | null;
        plate: string; brand: string | null; model: string | null; year: number | null;
      }>(
        `select o.order_number, o.status, o.opened_at, o.total_amount, o.reported_symptoms, o.free_form_notes,
                ts.source as triage_source, v.plate, v.brand, v.model, v.year
           from public.service_orders o
           join public.vehicles v on v.id = o.vehicle_id
           left join public.triage_sessions ts on ts.id = o.triage_session_id
          where o.id = $1`,
        [orderId]
      );
      const timeline = await db.many<{ to_status: OrderStatus; created_at: string }>(
        `select to_status, created_at from public.service_order_status_history where service_order_id = $1 order by seq`,
        [orderId]
      );
      const messages = await db.many<{ body: string; created_at: string }>(
        `select body, created_at from public.service_order_notes
          where service_order_id = $1 and visible_to_customer order by created_at`,
        [orderId]
      );

      return {
        shop: { name: access.shop_name, phone: access.shop_phone },
        order: {
          number: order.order_number,
          status: order.status,
          status_label: ORDER_STATUS_LABELS[order.status],
          opened_at: order.opened_at,
          total_amount: order.total_amount
        },
        vehicle: { plate: order.plate, brand: order.brand, model: order.model, year: order.year },
        reported_symptoms: await this.describeSymptoms(db, order.reported_symptoms),
        // Texto livre só volta ao cliente quando foi ele mesmo quem escreveu (triagem pública).
        customer_notes: order.triage_source === 'public' ? order.free_form_notes : null,
        timeline: timeline.map((entry) => ({ status: entry.to_status, label: ORDER_STATUS_LABELS[entry.to_status], at: entry.created_at })),
        shop_messages: messages.map((message) => ({ body: message.body, at: message.created_at })),
        quote: await this.currentQuote(db, access),
        consent_required: false,
        privacy_policy_version: this.env.privacyPolicyVersion
      };
    });
  }

  private async describeSymptoms(db: Db, reported: ReportedSymptom[]): Promise<PortalOrderResponse['reported_symptoms']> {
    if (!reported?.length) return [];
    const catalog = await db.many<{ code: string; name: string; follow_up_questions: FollowUpQuestion[] }>(
      'select code, name, follow_up_questions from public.symptoms where code = any($1)',
      [reported.map((symptom) => symptom.symptom_code)]
    );
    const byCode = new Map(catalog.map((row) => [row.code, row]));
    const format = (value: AnswerValue): string => (typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value));
    return reported
      .filter((symptom) => byCode.has(symptom.symptom_code))
      .map((symptom) => {
        const entry = byCode.get(symptom.symptom_code)!;
        return {
          name: entry.name,
          answers: entry.follow_up_questions
            .filter((question) => symptom.answers?.[question.id] !== undefined && symptom.answers[question.id] !== null)
            .map((question) => ({ question: question.text, answer: format(symptom.answers[question.id]) }))
        };
      });
  }

  private async currentQuote(db: Db, access: TokenRow): Promise<PortalQuote | null> {
    const quote = await db.maybeOne<{ id: string; version: number; status: QuoteStatus; total_amount: number; sent_at: string | null; expires_at: string | null }>(
      `select id, version, status, total_amount, sent_at, expires_at
         from public.quotes
        where service_order_id = $1 and status in ('sent', 'approved', 'rejected')
        order by version desc limit 1`,
      [access.service_order_id]
    );
    if (!quote) return null;
    const items = await db.many<PortalQuote['items'][number]>(
      `select type, description, quantity, unit_price, total from public.quote_items where quote_id = $1 order by sort_order, created_at`,
      [quote.id]
    );
    const open = quote.status === 'sent' && (!quote.expires_at || new Date(quote.expires_at) > new Date());
    return {
      ...quote,
      can_respond: open && access.purposes.includes('approve_quote') && access.quote_id === quote.id,
      items
    };
  }

  history(token: string): Promise<PortalHistoryEntry[]> {
    return this.db.admin(async (db) => {
      const access = await this.authorize(db, token, 'view_order');
      this.assertConsent(access);
      const rows = await db.many<{ order_number: number; status: OrderStatus; opened_at: string; delivered_at: string | null; total_amount: number; services: string[] }>(
        `select o.order_number, o.status, o.opened_at, o.delivered_at, o.total_amount,
                coalesce((select array_agg(i.description order by i.sort_order)
                            from public.service_order_items i
                           where i.service_order_id = o.id and i.type = 'service'), '{}') as services
           from public.service_orders o
           join public.service_orders cur on cur.id = $1
          where o.vehicle_id = cur.vehicle_id and o.tenant_id = cur.tenant_id and o.id <> cur.id
            and o.status in ('completed', 'delivered')
          order by o.opened_at desc limit 50`,
        [access.service_order_id]
      );
      return rows.map((row) => ({
        number: row.order_number,
        status: row.status,
        status_label: ORDER_STATUS_LABELS[row.status],
        opened_at: row.opened_at,
        delivered_at: row.delivered_at,
        total_amount: row.total_amount,
        services: row.services
      }));
    });
  }

  respond(token: string, quoteId: string, decision: 'approved' | 'rejected', reason?: string): Promise<PortalOrderResponse> {
    return this.db
      .admin(async (db) => {
        const access = await this.authorize(db, token, 'approve_quote');
        this.assertConsent(access);
        // O token só vale para o orçamento com o qual foi emitido.
        if (access.quote_id !== quoteId) throw new NotFoundException('Link inválido ou expirado. Peça um novo link à oficina.');
        await this.quotes.respondInTransaction(db, quoteId, decision, 'portal', reason, { type: 'customer', userId: null, name: 'Cliente' });
      })
      .then(() => this.order(token));
  }
}

@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('portal/:token')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  intro(@Param('token') token: string) {
    return this.portal.intro(token);
  }

  @HttpCode(204)
  @Post('consent')
  consent(@Param('token') token: string, @Req() request: RequestWithAuth) {
    return this.portal.consent(token, request);
  }

  @Get('order')
  order(@Param('token') token: string): Promise<PortalOrderResponse> {
    return this.portal.order(token);
  }

  @Get('history')
  history(@Param('token') token: string) {
    return this.portal.history(token);
  }

  @HttpCode(200)
  @Post('quotes/:quoteId/approve')
  approve(@Param('token') token: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.portal.respond(token, quoteId, 'approved');
  }

  @HttpCode(200)
  @Post('quotes/:quoteId/reject')
  reject(@Param('token') token: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body() dto: PortalRejectDto) {
    return this.portal.respond(token, quoteId, 'rejected', dto.reason);
  }
}

@Module({ imports: [QuotesModule], controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}
