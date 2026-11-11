import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import type { ReportsOverview } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, Roles } from '../common/decorators';
import { rls } from '../common/rls';
import { DatabaseService } from '../database/database.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportsQuery {
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @Matches(DAY)
  to?: string;
}

/**
 * Indicadores da oficina (Fase 3). Tudo é calculado sobre OS concluídas no período (data de conclusão),
 * e os orçamentos pelo envio. Somente leitura, sempre dentro da RLS do tenant.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  overview(ctx: TenantContext, query: ReportsQuery): Promise<ReportsOverview> {
    // Intervalo fechado em dias, no fuso da oficina: [from 00:00, to + 1 dia).
    const period = `o.completed_at >= $1::date and o.completed_at < ($2::date + 1)`;

    return this.db.tenant(rls(ctx), async (db) => {
      // "Hoje" é o dia corrente da oficina, não o do servidor: quem decide é o fuso da transação.
      const { from, to, days } = await db.one<{ from: string; to: string; days: number }>(
        `select f::text as "from", t::text as "to", t - f as days
           from (select coalesce($1::date, coalesce($2::date, current_date) - 89) as f, coalesce($2::date, current_date) as t) p`,
        [query.from ?? null, query.to ?? null]
      );
      if (days < 0) throw new BadRequestException('O início do período precisa ser antes do fim.');
      if (days > 731) throw new BadRequestException('O período máximo é de dois anos.');
      const params = [from, to];
      const totals = await db.one<{ orders_completed: number; revenue: number; average_ticket: number; average_execution_minutes: number | null }>(
        `select count(*)::int as orders_completed,
                coalesce(sum(o.total_amount), 0) as revenue,
                coalesce(round(avg(o.total_amount), 2), 0) as average_ticket,
                round(avg(extract(epoch from (o.completed_at - o.started_at)) / 60.0) filter (where o.started_at is not null), 0) as average_execution_minutes
           from public.service_orders o where ${period}`,
        params
      );
      const quotes = await db.one<{ sent: number; approved: number; rejected: number }>(
        `select count(*)::int as sent,
                count(*) filter (where q.status = 'approved')::int as approved,
                count(*) filter (where q.status = 'rejected')::int as rejected
           from public.quotes q where q.sent_at >= $1::date and q.sent_at < ($2::date + 1)`,
        params
      );
      const decided = quotes.approved + quotes.rejected;
      const top_services = await db.many<ReportsOverview['top_services'][number]>(
        `select min(i.description) as description, i.type, count(*)::int as times, sum(i.total) as revenue
           from public.service_order_items i join public.service_orders o on o.id = i.service_order_id
          where ${period}
          group by lower(trim(i.description)), i.type
          order by revenue desc, times desc limit 10`,
        params
      );
      const by_mechanic = await db.many<ReportsOverview['by_mechanic'][number]>(
        `select coalesce(m.full_name, 'Sem responsável') as mechanic_name, count(*)::int as orders, coalesce(sum(o.total_amount), 0) as revenue
           from public.service_orders o left join public.tenant_users m on m.id = o.assigned_mechanic_id
          where ${period}
          group by 1 order by revenue desc, orders desc`,
        params
      );
      const by_month = await db.many<ReportsOverview['by_month'][number]>(
        `select to_char(date_trunc('month', o.completed_at), 'YYYY-MM') as month, count(*)::int as orders, coalesce(sum(o.total_amount), 0) as revenue
           from public.service_orders o where ${period} group by 1 order by 1`,
        params
      );
      return {
        from,
        to,
        ...totals,
        average_execution_minutes: totals.average_execution_minutes === null ? null : Number(totals.average_execution_minutes),
        quotes: { ...quotes, conversion_pct: decided ? Math.round((quotes.approved / decided) * 1000) / 10 : null },
        top_services,
        by_mechanic,
        by_month
      };
    });
  }
}

@Controller('reports')
@Roles(...MANAGEMENT)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  overview(@Ctx() ctx: TenantContext, @Query() query: ReportsQuery) {
    return this.reports.overview(ctx, query);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
