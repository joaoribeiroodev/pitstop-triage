import { Body, Controller, Get, Inject, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  NOTIFICATION_EVENTS,
  ORDER_STATUS_LABELS,
  renderNotification,
  type NotificationEvent,
  type NotificationLogEntry,
  type NotificationPreview,
  type NotificationTemplates,
  type OrderStatus
} from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, RequireFeature, Roles, STAFF_WRITE } from '../common/decorators';
import { rls } from '../common/rls';
import { ENV, Env } from '../config/env';
import { DatabaseService, Db } from '../database/database.service';
import { AccessTokenService } from '../quotes/access-token.service';

const brl = (value: number) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export class TemplatesDto {
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(700)
  quote_pending?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(700)
  status_update?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(700)
  vehicle_ready?: string;

  @IsOptional()
  @IsBoolean()
  whatsapp_auto?: boolean;
}

export class PreviewDto {
  @IsIn(NOTIFICATION_EVENTS)
  event: NotificationEvent;
}

export interface OrderFacts {
  order_number: number;
  status: OrderStatus;
  customer_name: string;
  phone: string | null;
  plate: string;
  vehicle: string;
  total_amount?: number;
}

/**
 * Avisos ao cliente (Fase 2). Dois estágios, ambos atrás do módulo "whatsapp" do tenant:
 *  - link wa.me com a mensagem pronta, que a equipe abre e envia;
 *  - envio automático pela API oficial, quando a integração está configurada e a oficina ligou a opção.
 * Regra central: notificação nunca desfaz nem atrasa uma operação de negócio. Falha vira linha no registro.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: AccessTokenService,
    @Inject(ENV) private readonly env: Env
  ) {}

  templates(ctx: TenantContext): NotificationTemplates {
    return { ...DEFAULT_NOTIFICATION_TEMPLATES, ...(ctx.tenant.settings.notification_templates ?? {}) };
  }

  /** A integração automática existe neste ambiente? */
  get apiConfigured(): boolean {
    return !!(this.env.whatsapp.token && this.env.whatsapp.phoneNumberId);
  }

  settings(ctx: TenantContext) {
    return {
      templates: this.templates(ctx),
      defaults: DEFAULT_NOTIFICATION_TEMPLATES,
      whatsapp_auto: ctx.tenant.settings.whatsapp_auto ?? false,
      api_configured: this.apiConfigured
    };
  }

  async saveSettings(ctx: TenantContext, dto: TemplatesDto) {
    const { whatsapp_auto, ...texts } = dto;
    const templates = {
      ...(ctx.tenant.settings.notification_templates ?? {}),
      ...Object.fromEntries(Object.entries(texts).filter(([, value]) => value !== undefined))
    };
    const patch: Record<string, unknown> = { notification_templates: templates };
    if (whatsapp_auto !== undefined) patch.whatsapp_auto = whatsapp_auto;
    await this.db.admin((db) => db.exec(`update public.tenants set settings = settings || $2::jsonb where id = $1`, [ctx.tenantId, JSON.stringify(patch)]));
    ctx.tenant.settings = { ...ctx.tenant.settings, ...patch };
    return this.settings(ctx);
  }

  private async facts(db: Db, orderId: string): Promise<OrderFacts> {
    const order = await db.maybeOne<OrderFacts>(
      `select o.order_number, o.status, o.total_amount, c.name as customer_name, c.phone, v.plate, trim(concat_ws(' ', v.brand, v.model)) as vehicle
         from public.service_orders o
         join public.customers c on c.id = o.customer_id
         join public.vehicles v on v.id = o.vehicle_id
        where o.id = $1`,
      [orderId]
    );
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada.');
    return order;
  }

  compose(ctx: TenantContext, event: NotificationEvent, order: OrderFacts, link: string, extra: { total?: string } = {}): string {
    return renderNotification(this.templates(ctx)[event], {
      cliente: order.customer_name.split(' ')[0],
      oficina: ctx.tenant.name,
      veiculo: order.vehicle || 'veículo',
      placa: order.plate,
      os: String(order.order_number),
      status: ORDER_STATUS_LABELS[order.status].toLowerCase(),
      total: extra.total ?? '',
      link
    });
  }

  private static phone(order: OrderFacts): string | null {
    return order.phone && /^\d{10,11}$/.test(order.phone) ? order.phone : null;
  }

  private async trackingLink(db: Db, ctx: TenantContext, orderId: string): Promise<string> {
    const issued = await this.tokens.issue(db, {
      tenantId: ctx.tenantId,
      orderId,
      quoteId: null,
      purposes: ['view_order'],
      days: ctx.tenant.settings.portal_token_days ?? 30,
      createdBy: ctx.userId
    });
    return `${this.env.portalBaseUrl}/portal/${issued.token}`;
  }

  private async record(
    db: Db,
    ctx: TenantContext,
    orderId: string,
    event: NotificationEvent,
    channel: NotificationLogEntry['channel'],
    status: NotificationLogEntry['status'],
    recipient: string | null,
    detail: string | null
  ) {
    await db.exec(
      `insert into public.notification_log (tenant_id, service_order_id, event, channel, recipient, status, detail) values ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, orderId, event, channel, recipient, status, detail?.slice(0, 500) ?? null]
    );
  }

  /** Estágio 1: mensagem pronta + link wa.me para a equipe enviar. Gera um link de acompanhamento novo. */
  preview(ctx: TenantContext, orderId: string, event: NotificationEvent): Promise<NotificationPreview> {
    return this.db.tenant(rls(ctx), async (db) => {
      const order = await this.facts(db, orderId);
      const message = this.compose(ctx, event, order, await this.trackingLink(db, ctx, orderId), { total: brl(order.total_amount ?? 0) });
      const phone = NotificationsService.phone(order);
      await this.record(
        db,
        ctx,
        orderId,
        event,
        'whatsapp_link',
        phone ? 'sent' : 'skipped',
        phone,
        phone ? 'Mensagem pronta gerada para envio pela equipe' : 'Cliente sem telefone válido'
      );
      return { event, message, whatsapp_url: phone ? `https://wa.me/55${phone}?text=${encodeURIComponent(message)}` : null };
    });
  }

  history(ctx: TenantContext, orderId: string): Promise<NotificationLogEntry[]> {
    return this.db.tenant(rls(ctx), (db) =>
      db.many<NotificationLogEntry>(
        `select id, event, channel, recipient, status, detail, created_at from public.notification_log where service_order_id = $1 order by created_at desc limit 50`,
        [orderId]
      )
    );
  }

  /**
   * Estágio 2: envio automático pela API oficial, chamado depois do commit da operação de negócio.
   * Nunca lança: qualquer problema é registrado em notification_log e no log do servidor.
   * `link` vem pronto quando o chamador já emitiu um (orçamento); senão é emitido um de acompanhamento.
   */
  async notifyAutomatically(ctx: TenantContext, orderId: string, event: NotificationEvent, link?: string): Promise<void> {
    if (!ctx.tenant.feature_flags.whatsapp || !ctx.tenant.settings.whatsapp_auto || !this.apiConfigured) return;
    try {
      await this.db.tenant(rls(ctx), async (db) => {
        const order = await this.facts(db, orderId);
        const phone = NotificationsService.phone(order);
        if (!phone) return this.record(db, ctx, orderId, event, 'whatsapp_api', 'skipped', null, 'Cliente sem telefone válido');
        const url = link ?? (await this.trackingLink(db, ctx, orderId));
        const failure = await this.sendTemplate(ctx, event, order, phone, url);
        await this.record(db, ctx, orderId, event, 'whatsapp_api', failure ? 'failed' : 'sent', phone, failure);
      });
    } catch (error) {
      this.logger.warn(`Notificação ${event} da OS ${orderId} não registrada: ${(error as Error).message}`);
    }
  }

  /** Devolve null em caso de sucesso ou o motivo da falha. */
  private async sendTemplate(ctx: TenantContext, event: NotificationEvent, order: OrderFacts, phone: string, link: string): Promise<string | null> {
    const { apiUrl, token, phoneNumberId, templates, language } = this.env.whatsapp;
    const text = (value: string) => ({ type: 'text', text: value });
    // Ordem fixa dos parâmetros do corpo do modelo aprovado na Meta: cliente, oficina, veículo, placa, status, link.
    const parameters = [
      text(order.customer_name.split(' ')[0]),
      text(ctx.tenant.name),
      text(order.vehicle || 'veículo'),
      text(order.plate),
      text(ORDER_STATUS_LABELS[order.status].toLowerCase()),
      text(link)
    ];
    try {
      const response = await fetch(`${apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: `55${phone}`,
          type: 'template',
          template: { name: templates[event], language: { code: language }, components: [{ type: 'body', parameters }] }
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) return null;
      const body = await response.text().catch(() => '');
      return `HTTP ${response.status} ${body}`.trim();
    } catch (error) {
      return (error as Error).message || 'Falha de rede';
    }
  }
}

@Controller('notifications')
@RequireFeature('whatsapp')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('settings')
  settings(@Ctx() ctx: TenantContext) {
    return this.notifications.settings(ctx);
  }

  @Patch('settings')
  @Roles(...MANAGEMENT)
  save(@Ctx() ctx: TenantContext, @Body() dto: TemplatesDto) {
    return this.notifications.saveSettings(ctx, dto);
  }

  @Post('orders/:orderId/preview')
  @Roles(...STAFF_WRITE)
  preview(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: PreviewDto) {
    return this.notifications.preview(ctx, orderId, dto.event);
  }

  @Get('orders/:orderId/history')
  history(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.notifications.history(ctx, orderId);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService, AccessTokenService], exports: [NotificationsService] })
export class NotificationsModule {}
