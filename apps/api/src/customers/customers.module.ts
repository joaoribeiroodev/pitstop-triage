import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { Equals, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Customer, Paginated, ServiceOrderSummary, Vehicle } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, Roles, STAFF_WRITE } from '../common/decorators';
import { offsetOf, paginated, PaginationQuery } from '../common/pagination';
import { blankToNull, buildUpdate, onlyDigits, rls } from '../common/rls';
import { DatabaseService } from '../database/database.service';
import { ORDER_SUMMARY_SQL } from '../service-orders/order-sql';

export class CustomerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CustomerListQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AnonymizeDto {
  @Equals(true, { message: 'Confirme a anonimização enviando confirm: true.' })
  confirm: boolean;
}

const COLUMNS = 'c.id, c.name, c.phone, c.email, c.document, c.notes, c.anonymized_at, c.created_at, c.updated_at';

@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService) {}

  list(ctx: TenantContext, query: CustomerListQuery): Promise<Paginated<Customer>> {
    const term = query.q?.trim() ?? '';
    const digits = onlyDigits(term);
    // Busca por telefone quando o termo é essencialmente numérico; senão, por nome.
    const byPhone = digits !== null && digits.length >= 3 && digits.length >= term.replace(/[\s()+-]/g, '').length;
    const where = !term ? 'true' : byPhone ? 'c.phone like $1' : 'c.name ilike $1';
    const params = !term ? [] : [byPhone ? `%${digits}%` : `%${term}%`];
    return this.db.tenant(rls(ctx), async (db) => {
      const { total } = await db.one<{ total: number }>(`select count(*)::int as total from public.customers c where ${where}`, params);
      const rows = await db.many<Customer>(
        `select ${COLUMNS}, (select count(*)::int from public.vehicles v where v.customer_id = c.id) as vehicles_count
           from public.customers c where ${where}
          order by c.name limit ${query.pageSize} offset ${offsetOf(query)}`,
        params
      );
      return paginated(rows, total, query);
    });
  }

  count(ctx: TenantContext): Promise<{ total: number }> {
    return this.db.tenant(rls(ctx), (db) => db.one('select count(*)::int as total from public.customers'));
  }

  get(ctx: TenantContext, id: string): Promise<Customer & { vehicles: Vehicle[]; orders: ServiceOrderSummary[] }> {
    return this.db.tenant(rls(ctx), async (db) => {
      const customer = await db.maybeOne<Customer>(`select ${COLUMNS} from public.customers c where c.id = $1`, [id]);
      if (!customer) throw new NotFoundException('Cliente não encontrado.');
      const vehicles = await db.many<Vehicle>('select * from public.vehicles where customer_id = $1 order by created_at desc', [id]);
      const orders = await db.many<ServiceOrderSummary>(`${ORDER_SUMMARY_SQL} where o.customer_id = $1 order by o.opened_at desc limit 50`, [id]);
      return { ...customer, vehicles, orders };
    });
  }

  create(ctx: TenantContext, dto: CustomerDto): Promise<Customer> {
    return this.db.tenant(rls(ctx), (db) =>
      db.one<Customer>(
        `insert into public.customers as c (tenant_id, name, phone, email, document, notes)
         values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`,
        [ctx.tenantId, dto.name.trim(), onlyDigits(dto.phone), blankToNull(dto.email)?.toLowerCase() ?? null, onlyDigits(dto.document), blankToNull(dto.notes)]
      )
    );
  }

  update(ctx: TenantContext, id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const { sets, values } = buildUpdate(
      {
        name: dto.name?.trim(),
        phone: dto.phone === undefined ? undefined : onlyDigits(dto.phone),
        email: dto.email === undefined ? undefined : (blankToNull(dto.email)?.toLowerCase() ?? null),
        document: dto.document === undefined ? undefined : onlyDigits(dto.document),
        notes: dto.notes === undefined ? undefined : blankToNull(dto.notes)
      },
      2
    );
    return this.db.tenant(rls(ctx), async (db) => {
      const sql = sets.length
        ? `update public.customers as c set ${sets.join(', ')} where c.id = $1 returning ${COLUMNS}`
        : `select ${COLUMNS} from public.customers c where c.id = $1`;
      const row = await db.maybeOne<Customer>(sql, [id, ...values]);
      if (!row) throw new NotFoundException('Cliente não encontrado.');
      return row;
    });
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await this.db.tenant(rls(ctx), (db) => db.exec('delete from public.customers where id = $1', [id]));
    if (!deleted) throw new NotFoundException('Cliente não encontrado.');
  }

  /** LGPD — portabilidade: tudo o que a oficina guarda sobre o titular. */
  export(ctx: TenantContext, id: string): Promise<Record<string, unknown>> {
    return this.db.tenant(rls(ctx), async (db) => {
      const customer = await db.maybeOne('select * from public.customers where id = $1', [id]);
      if (!customer) throw new NotFoundException('Cliente não encontrado.');
      const vehicles = await db.many('select * from public.vehicles where customer_id = $1', [id]);
      const orders = await db.many(
        `select o.id, o.order_number, o.status, o.reported_symptoms, o.total_amount, o.opened_at, o.delivered_at,
                (select coalesce(jsonb_agg(jsonb_build_object('type', i.type, 'description', i.description,
                        'quantity', i.quantity, 'unit_price', i.unit_price, 'total', i.total)), '[]'::jsonb)
                   from public.service_order_items i where i.service_order_id = o.id) as items
           from public.service_orders o where o.customer_id = $1 order by o.opened_at`,
        [id]
      );
      return { exported_at: new Date().toISOString(), customer, vehicles, service_orders: orders };
    });
  }

  /**
   * LGPD — eliminação: remove os dados pessoais e mantém o histórico de serviço
   * desidentificado (as estatísticas agregadas em shop_symptom_stats não têm vínculo com o titular).
   */
  anonymize(ctx: TenantContext, id: string): Promise<Customer> {
    return this.db.tenant(rls(ctx), async (db) => {
      const open = await db.maybeOne(
        `select 1 from public.service_orders where customer_id = $1 and status not in ('delivered', 'cancelled') limit 1`,
        [id]
      );
      if (open) throw new BadRequestException('Há ordens de serviço em andamento para este cliente. Conclua ou cancele antes de anonimizar.');
      const customer = await db.maybeOne<Customer>(
        `update public.customers as c
            set name = 'Cliente anonimizado', phone = null, email = null, document = null, notes = null, anonymized_at = now()
          where c.id = $1 returning ${COLUMNS}`,
        [id]
      );
      if (!customer) throw new NotFoundException('Cliente não encontrado.');
      await db.exec(
        `update public.vehicles set plate = 'ANON' || upper(substr(replace(id::text, '-', ''), 1, 8)), vin = null, notes = null
          where customer_id = $1`,
        [id]
      );
      await db.exec(
        `update public.customer_access_tokens set revoked_at = coalesce(revoked_at, now())
          where service_order_id in (select id from public.service_orders where customer_id = $1)`,
        [id]
      );
      await db.exec(`update public.triage_sessions set contact = null, free_form_notes = null where customer_id = $1`, [id]);
      await db.exec(`update public.service_orders set free_form_notes = null where customer_id = $1`, [id]);
      return customer;
    });
  }
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Ctx() ctx: TenantContext, @Query() query: CustomerListQuery) {
    return this.customers.list(ctx, query);
  }

  @Get('count')
  count(@Ctx() ctx: TenantContext) {
    return this.customers.count(ctx);
  }

  @Get(':id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @Post()
  create(@Ctx() ctx: TenantContext, @Body() dto: CustomerDto) {
    return this.customers.create(ctx, dto);
  }

  @Roles(...STAFF_WRITE)
  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(ctx, id, dto);
  }

  @Roles(...MANAGEMENT)
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(ctx, id);
  }

  @Roles('owner')
  @Get(':id/export')
  export(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.export(ctx, id);
  }

  @Roles('owner')
  @HttpCode(200)
  @Post(':id/anonymize')
  anonymize(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() _dto: AnonymizeDto) {
    return this.customers.anonymize(ctx, id);
  }
}

@Module({ controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
