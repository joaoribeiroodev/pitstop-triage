import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Paginated, resolveFeatureFlags, ServiceOrder, SymptomCategory, Tenant, TRIAGE_STATUSES, TriageSession, TriageStatus } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, Public, RequireFeature, Roles, STAFF_WRITE } from '../common/decorators';
import { offsetOf, paginated, PaginationQuery } from '../common/pagination';
import { blankToNull, buildUpdate, onlyDigits, rls } from '../common/rls';
import { ReportedSymptomDto, sanitizeSymptoms } from '../common/symptoms';
import { DatabaseService, Db } from '../database/database.service';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrdersService } from '../service-orders/service-orders.service';
import { normalizePlate } from '../vehicles/vehicles.module';

export class TriageDto {
  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @IsUUID()
  vehicle_id?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um sintoma.' })
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReportedSymptomDto)
  reported_symptoms: ReportedSymptomDto[];

  @IsOptional() @IsString() @MaxLength(4000)
  free_form_notes?: string;
}

export class UpdateTriageDto {
  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @IsUUID()
  vehicle_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReportedSymptomDto)
  reported_symptoms?: ReportedSymptomDto[];

  @IsOptional() @IsString() @MaxLength(4000)
  free_form_notes?: string;
}

export class PublicContactDto {
  @IsString() @MinLength(2) @MaxLength(160)
  name: string;

  @Transform(({ value }) => onlyDigits(String(value ?? '')) ?? '')
  @Matches(/^\d{10,13}$/, { message: 'Informe um telefone com DDD.' })
  phone: string;

  @IsOptional()
  @Transform(({ value }) => (value ? normalizePlate(value) : undefined))
  @IsString() @MaxLength(8)
  plate?: string;

  @IsOptional() @IsString() @MaxLength(120)
  vehicle?: string;
}

export class PublicTriageDto {
  @ValidateNested()
  @Type(() => PublicContactDto)
  contact: PublicContactDto;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um sintoma.' })
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => ReportedSymptomDto)
  reported_symptoms: ReportedSymptomDto[];

  @IsOptional() @IsString() @MaxLength(2000)
  free_form_notes?: string;
}

export class TriageListQuery extends PaginationQuery {
  @IsOptional() @IsIn(TRIAGE_STATUSES)
  status?: TriageStatus;
}

const SELECT = `
  select t.id, t.customer_id, t.vehicle_id, t.reported_symptoms, t.free_form_notes, t.status, t.source, t.contact,
         t.service_order_id, t.created_at, c.name as customer_name, v.plate as vehicle_plate,
         nullif(trim(concat_ws(' ', v.brand, v.model, v.year::text)), '') as vehicle_label
    from public.triage_sessions t
    left join public.customers c on c.id = t.customer_id
    left join public.vehicles v on v.id = t.vehicle_id`;

@Injectable()
export class TriageService {
  /** O catálogo global muda raramente: fica em memória até uma invalidação manual. */
  private catalogCache: SymptomCategory[] | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: ServiceOrdersService
  ) {}

  invalidateCatalog(): void {
    this.catalogCache = null;
  }

  async catalog(): Promise<SymptomCategory[]> {
    if (this.catalogCache) return this.catalogCache;
    this.catalogCache = await this.db.admin((db) =>
      db.many<SymptomCategory>(
        `select c.id, c.code, c.name, c.icon, c.description,
                coalesce((select jsonb_agg(jsonb_build_object(
                            'id', s.id, 'code', s.code, 'name', s.name, 'description', s.description,
                            'follow_up_questions', s.follow_up_questions) order by s.sort_order)
                            from public.symptoms s where s.category_id = c.id and s.is_active), '[]'::jsonb) as symptoms
           from public.symptom_categories c order by c.sort_order`
      )
    );
    return this.catalogCache;
  }

  list(ctx: TenantContext, query: TriageListQuery): Promise<Paginated<TriageSession>> {
    const where = query.status ? 'where t.status = $1' : '';
    const params = query.status ? [query.status] : [];
    return this.db.tenant(rls(ctx), async (db) => {
      const { total } = await db.one<{ total: number }>(`select count(*)::int as total from public.triage_sessions t ${where}`, params);
      const rows = await db.many<TriageSession>(
        `${SELECT} ${where} order by t.created_at desc limit ${query.pageSize} offset ${offsetOf(query)}`,
        params
      );
      return paginated(rows, total, query);
    });
  }

  get(ctx: TenantContext, id: string): Promise<TriageSession> {
    return this.db.tenant(rls(ctx), (db) => this.load(db, id));
  }

  private async load(db: Db, id: string): Promise<TriageSession> {
    const row = await db.maybeOne<TriageSession>(`${SELECT} where t.id = $1`, [id]);
    if (!row) throw new NotFoundException('Triagem não encontrada.');
    return row;
  }

  private async assertPair(db: Db, customerId: string | null | undefined, vehicleId: string | null | undefined): Promise<void> {
    if (customerId) {
      const customer = await db.maybeOne('select 1 from public.customers where id = $1', [customerId]);
      if (!customer) throw new BadRequestException('Cliente não encontrado.');
    }
    if (vehicleId) {
      const vehicle = await db.maybeOne<{ customer_id: string }>('select customer_id from public.vehicles where id = $1', [vehicleId]);
      if (!vehicle) throw new BadRequestException('Veículo não encontrado.');
      if (customerId && vehicle.customer_id !== customerId) throw new BadRequestException('O veículo não pertence ao cliente informado.');
    }
  }

  create(ctx: TenantContext, dto: TriageDto): Promise<TriageSession> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.assertPair(db, dto.customer_id, dto.vehicle_id);
      const symptoms = await sanitizeSymptoms(db, dto.reported_symptoms);
      const row = await db.one<{ id: string }>(
        `insert into public.triage_sessions (tenant_id, customer_id, vehicle_id, reported_symptoms, free_form_notes, source, created_by)
         values ($1, $2, $3, $4, $5, 'staff', $6) returning id`,
        [ctx.tenantId, dto.customer_id ?? null, dto.vehicle_id ?? null, JSON.stringify(symptoms), blankToNull(dto.free_form_notes), ctx.userId]
      );
      return this.load(db, row.id);
    });
  }

  update(ctx: TenantContext, id: string, dto: UpdateTriageDto): Promise<TriageSession> {
    return this.db.tenant(rls(ctx), async (db) => {
      const current = await db.maybeOne<{ status: TriageStatus; customer_id: string | null; vehicle_id: string | null }>(
        'select status, customer_id, vehicle_id from public.triage_sessions where id = $1 for update',
        [id]
      );
      if (!current) throw new NotFoundException('Triagem não encontrada.');
      if (current.status !== 'pending') throw new ConflictException('Somente triagens pendentes podem ser editadas.');
      await this.assertPair(db, dto.customer_id ?? current.customer_id, dto.vehicle_id ?? current.vehicle_id);
      const symptoms = dto.reported_symptoms ? JSON.stringify(await sanitizeSymptoms(db, dto.reported_symptoms)) : undefined;
      const { sets, values } = buildUpdate(
        {
          customer_id: dto.customer_id,
          vehicle_id: dto.vehicle_id,
          reported_symptoms: symptoms,
          free_form_notes: dto.free_form_notes === undefined ? undefined : blankToNull(dto.free_form_notes)
        },
        2
      );
      if (sets.length) await db.exec(`update public.triage_sessions set ${sets.join(', ')} where id = $1`, [id, ...values]);
      return this.load(db, id);
    });
  }

  archive(ctx: TenantContext, id: string): Promise<TriageSession> {
    return this.db.tenant(rls(ctx), async (db) => {
      const updated = await db.exec(`update public.triage_sessions set status = 'archived' where id = $1 and status = 'pending'`, [id]);
      if (!updated) throw new ConflictException('Somente triagens pendentes podem ser arquivadas.');
      return this.load(db, id);
    });
  }

  /** Conversão atômica: cria a OS em rascunho com o relato, marca a triagem como convertida — tudo na mesma transação. */
  convert(ctx: TenantContext, id: string): Promise<ServiceOrder> {
    return this.db.tenant(rls(ctx), async (db) => {
      const triage = await db.maybeOne<TriageSession>('select * from public.triage_sessions where id = $1 for update', [id]);
      if (!triage) throw new NotFoundException('Triagem não encontrada.');
      if (triage.status !== 'pending') throw new ConflictException('Esta triagem já foi convertida ou arquivada.');
      if (!triage.customer_id || !triage.vehicle_id) {
        throw new BadRequestException('Vincule a triagem a um cliente e a um veículo antes de abrir a OS.');
      }
      const orderId = await this.orders.createInTransaction(db, ctx, {
        customer_id: triage.customer_id,
        vehicle_id: triage.vehicle_id,
        reported_symptoms: triage.reported_symptoms,
        free_form_notes: triage.free_form_notes,
        assigned_mechanic_id: null,
        triage_session_id: id
      });
      await db.exec(`update public.triage_sessions set status = 'converted', service_order_id = $2 where id = $1`, [id, orderId]);
      return this.orders.load(db, ctx, orderId);
    });
  }

  // ───────────── triagem pública (link enviado ao cliente) ─────────────
  private async publicTenant(db: Db, slug: string): Promise<Tenant> {
    const tenant = await db.maybeOne<Tenant>('select * from public.tenants where slug = $1', [slug.toLowerCase()]);
    const usable =
      tenant && tenant.status === 'active' && (tenant.expires_at === null || new Date(tenant.expires_at) > new Date());
    if (!tenant || !usable) throw new NotFoundException('Oficina não encontrada.');
    const flags = resolveFeatureFlags(tenant.plan, tenant.feature_flags);
    if (!flags.triage || !flags.public_triage) throw new ForbiddenException('Esta oficina não recebe triagens online.');
    return tenant;
  }

  async publicIntro(slug: string): Promise<{ shop_name: string; catalog: SymptomCategory[] }> {
    const tenant = await this.db.admin((db) => this.publicTenant(db, slug));
    return { shop_name: tenant.name, catalog: await this.catalog() };
  }

  /** Entra na fila de pendentes sem cliente/veículo: o staff vincula depois. */
  publicCreate(slug: string, dto: PublicTriageDto): Promise<{ received: true }> {
    return this.db.admin(async (db) => {
      const tenant = await this.publicTenant(db, slug);
      const symptoms = await sanitizeSymptoms(db, dto.reported_symptoms);
      const contact = {
        name: dto.contact.name.trim(),
        phone: dto.contact.phone,
        plate: dto.contact.plate || undefined,
        vehicle: blankToNull(dto.contact.vehicle) ?? undefined
      };
      await db.exec(
        `insert into public.triage_sessions (tenant_id, reported_symptoms, free_form_notes, source, contact)
         values ($1, $2, $3, 'public', $4)`,
        [tenant.id, JSON.stringify(symptoms), blankToNull(dto.free_form_notes), JSON.stringify(contact)]
      );
      return { received: true as const };
    });
  }
}

@RequireFeature('triage')
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @Get('catalog')
  catalog() {
    return this.triage.catalog();
  }

  @Get('sessions')
  list(@Ctx() ctx: TenantContext, @Query() query: TriageListQuery) {
    return this.triage.list(ctx, query);
  }

  @Get('sessions/:id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.triage.get(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @Post('sessions')
  create(@Ctx() ctx: TenantContext, @Body() dto: TriageDto) {
    return this.triage.create(ctx, dto);
  }

  @Roles(...STAFF_WRITE)
  @Patch('sessions/:id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTriageDto) {
    return this.triage.update(ctx, id, dto);
  }

  @Roles(...STAFF_WRITE)
  @HttpCode(200)
  @Post('sessions/:id/archive')
  archive(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.triage.archive(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @Post('sessions/:id/convert')
  convert(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.triage.convert(ctx, id);
  }
}

@Public()
@Controller('triage/public/:tenantSlug')
export class PublicTriageController {
  constructor(private readonly triage: TriageService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  intro(@Param('tenantSlug') slug: string) {
    return this.triage.publicIntro(slug);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sessions')
  create(@Param('tenantSlug') slug: string, @Body() dto: PublicTriageDto) {
    return this.triage.publicCreate(slug, dto);
  }
}

@Module({
  imports: [ServiceOrdersModule],
  controllers: [PublicTriageController, TriageController],
  providers: [TriageService],
  exports: [TriageService]
})
export class TriageModule {}
