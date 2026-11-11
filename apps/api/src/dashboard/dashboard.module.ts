import { Controller, Get, Module } from '@nestjs/common';
import type { DashboardSummary, ServiceOrderSummary } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx } from '../common/decorators';
import { rls } from '../common/rls';
import { DatabaseService } from '../database/database.service';
import { ORDER_SUMMARY_SQL } from '../service-orders/order-sql';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: DatabaseService) {}

  @Get('summary')
  summary(@Ctx() ctx: TenantContext): Promise<DashboardSummary> {
    const restricted = ctx.role === 'mechanic' && !ctx.tenant.settings.mechanics_see_all_orders;
    const scope = restricted ? 'and o.assigned_mechanic_id = $1' : '';
    const params = restricted ? [ctx.memberId] : [];
    // O que pede ação depende do papel: mecânico age sobre diagnóstico/execução; recepção, sobre aprovação e entrega.
    const actionable =
      ctx.role === 'mechanic'
        ? `o.status in ('draft', 'diagnosis', 'approved', 'in_progress', 'rejected') and (o.assigned_mechanic_id = $${params.length + 1} or o.assigned_mechanic_id is null)`
        : `o.status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'completed')`;
    const actionParams = ctx.role === 'mechanic' ? [...params, ctx.memberId] : params;

    return this.db.tenant(rls(ctx), async (db) => {
      const kpis = await db.one<Omit<DashboardSummary, 'needs_action' | 'pending_triage' | 'onboarding'>>(
        `select count(*) filter (where o.opened_at >= date_trunc('day', now()))::int as opened_today,
                count(*) filter (where o.status = 'awaiting_approval')::int as awaiting_approval,
                count(*) filter (where o.status = 'in_progress')::int as in_progress,
                count(*) filter (where o.completed_at >= date_trunc('week', now()))::int as completed_this_week
           from public.service_orders o where true ${scope}`,
        params
      );
      const triage = await db.one<{ pending_triage: number }>(`select count(*)::int as pending_triage from public.triage_sessions where status = 'pending'`);
      const needsAction = await db.many<ServiceOrderSummary>(`${ORDER_SUMMARY_SQL} where ${actionable} ${scope} order by o.updated_at limit 20`, actionParams);
      const onboarding = await db.one<DashboardSummary['onboarding']>(
        `select (select count(*) from public.tenant_users where is_active) > 1 as team,
                exists (select 1 from public.shop_services_catalog) or exists (select 1 from public.shop_parts_catalog) as catalog,
                exists (select 1 from public.service_orders) as first_order`
      );
      return { ...kpis, ...triage, needs_action: needsAction, onboarding };
    });
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
