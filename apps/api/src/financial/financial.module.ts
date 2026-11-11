import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FINANCIAL_TYPES, type FinancialEntry, type FinancialSummary, type FinancialType } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, RequireFeature, Roles } from '../common/decorators';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { DatabaseService, Db } from '../database/database.service';

export class FinancialEntryDto {
  @IsIn(FINANCIAL_TYPES)
  type: FinancialType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  counterparty?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateFinancialEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  counterparty?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** true marca como pago/recebido agora; false reabre o lançamento. */
  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

const ENTRY_SQL = `select f.id, f.type, f.description, f.counterparty, f.amount, to_char(f.due_date, 'YYYY-MM-DD') as due_date, f.paid_at, f.notes,
                          f.service_order_id, o.order_number, (f.paid_at is null and f.due_date < current_date) as overdue, f.created_at
                     from public.financial_entries f left join public.service_orders o on o.id = f.service_order_id`;

@Injectable()
export class FinancialService {
  constructor(private readonly db: DatabaseService) {}

  list(ctx: TenantContext, filters: { type?: string; status?: string; from?: string; to?: string }): Promise<FinancialEntry[]> {
    return this.db.tenant(rls(ctx), (db) =>
      db.many<FinancialEntry>(
        `${ENTRY_SQL}
          where ($1::text is null or f.type = $1)
            and ($2::text is null
                 or ($2 = 'open' and f.paid_at is null)
                 or ($2 = 'paid' and f.paid_at is not null)
                 or ($2 = 'overdue' and f.paid_at is null and f.due_date < current_date))
            and ($3::date is null or coalesce(f.due_date, f.created_at::date) >= $3::date)
            and ($4::date is null or coalesce(f.due_date, f.created_at::date) <= $4::date)
          order by (f.paid_at is not null), f.due_date nulls last, f.created_at desc
          limit 500`,
        [filters.type || null, filters.status || null, filters.from || null, filters.to || null]
      )
    );
  }

  summary(ctx: TenantContext): Promise<FinancialSummary> {
    return this.db.tenant(rls(ctx), (db) =>
      db.one<FinancialSummary>(
        `select coalesce(sum(amount) filter (where type = 'receivable' and paid_at is null), 0) as receivable_open,
                coalesce(sum(amount) filter (where type = 'receivable' and paid_at is null and due_date < current_date), 0) as receivable_overdue,
                coalesce(sum(amount) filter (where type = 'payable' and paid_at is null), 0) as payable_open,
                coalesce(sum(amount) filter (where type = 'payable' and paid_at is null and due_date < current_date), 0) as payable_overdue,
                coalesce(sum(amount) filter (where type = 'receivable' and paid_at >= date_trunc('month', now())), 0) as received_this_month,
                coalesce(sum(amount) filter (where type = 'payable' and paid_at >= date_trunc('month', now())), 0) as paid_this_month
           from public.financial_entries`
      )
    );
  }

  private async find(db: Db, id: string): Promise<FinancialEntry> {
    const entry = await db.maybeOne<FinancialEntry>(`${ENTRY_SQL} where f.id = $1`, [id]);
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    return entry;
  }

  create(ctx: TenantContext, dto: FinancialEntryDto): Promise<FinancialEntry> {
    return this.db.tenant(rls(ctx), async (db) => {
      const created = await db.one<{ id: string }>(
        `insert into public.financial_entries (tenant_id, type, description, amount, counterparty, due_date, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [ctx.tenantId, dto.type, dto.description.trim(), dto.amount, blankToNull(dto.counterparty), dto.due_date ?? null, blankToNull(dto.notes), ctx.userId]
      );
      return this.find(db, created.id);
    });
  }

  update(ctx: TenantContext, id: string, dto: UpdateFinancialEntryDto): Promise<FinancialEntry> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.find(db, id);
      const { sets, values } = buildUpdate(
        {
          description: dto.description?.trim(),
          amount: dto.amount,
          counterparty: dto.counterparty === undefined ? undefined : blankToNull(dto.counterparty),
          due_date: dto.due_date,
          notes: dto.notes === undefined ? undefined : blankToNull(dto.notes)
        },
        2
      );
      if (dto.paid !== undefined) sets.push(dto.paid ? 'paid_at = coalesce(paid_at, now())' : 'paid_at = null');
      if (sets.length) await db.exec(`update public.financial_entries set ${sets.join(', ')} where id = $1`, [id, ...values]);
      return this.find(db, id);
    });
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    await this.db.tenant(rls(ctx), async (db) => {
      await this.find(db, id);
      await db.exec('delete from public.financial_entries where id = $1', [id]);
    });
  }

  /**
   * Conta a receber da OS concluída. Uma por OS (índice único): concluir de novo não duplica,
   * e o valor acompanha o total da OS enquanto o lançamento não tiver sido recebido.
   */
  async receivableForOrder(db: Db, ctx: TenantContext, orderId: string): Promise<void> {
    await db.exec(
      `insert into public.financial_entries (tenant_id, type, description, counterparty, amount, due_date, service_order_id, created_by)
       select o.tenant_id, 'receivable', 'OS ' || o.order_number || ' — ' || v.plate, c.name, o.total_amount, current_date, o.id, $2
         from public.service_orders o
         join public.customers c on c.id = o.customer_id
         join public.vehicles v on v.id = o.vehicle_id
        where o.id = $1 and o.total_amount > 0
       on conflict (service_order_id) where type = 'receivable' and service_order_id is not null
       do update set amount = excluded.amount where public.financial_entries.paid_at is null`,
      [orderId, ctx.userId]
    );
  }
}

@Controller('financial')
@RequireFeature('financial')
@Roles(...MANAGEMENT)
export class FinancialController {
  constructor(private readonly financial: FinancialService) {}

  @Get('entries')
  list(@Ctx() ctx: TenantContext, @Query('type') type?: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.financial.list(ctx, { type, status, from, to });
  }

  @Get('summary')
  summary(@Ctx() ctx: TenantContext) {
    return this.financial.summary(ctx);
  }

  @Post('entries')
  create(@Ctx() ctx: TenantContext, @Body() dto: FinancialEntryDto) {
    return this.financial.create(ctx, dto);
  }

  @Patch('entries/:id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFinancialEntryDto) {
    return this.financial.update(ctx, id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.financial.remove(ctx, id);
  }
}

@Module({ controllers: [FinancialController], providers: [FinancialService], exports: [FinancialService] })
export class FinancialModule {}
