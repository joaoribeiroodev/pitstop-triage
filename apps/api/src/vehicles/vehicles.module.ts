import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ServiceUnavailableException
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Paginated, ServiceOrderSummary, Vehicle } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, Roles, STAFF_WRITE } from '../common/decorators';
import { offsetOf, paginated, PaginationQuery } from '../common/pagination';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { ORDER_SUMMARY_SQL } from '../service-orders/order-sql';
import { FipeController, FipeService } from './fipe.service';

/** Placa no padrão antigo (ABC1234) ou Mercosul (ABC1D23). */
export const PLATE_PATTERN = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function normalizePlate(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export class VehicleDto {
  @IsUUID()
  customer_id: string;

  @Transform(({ value }) => normalizePlate(value))
  @Matches(PLATE_PATTERN, { message: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' })
  plate: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(17)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  fuel_type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5_000_000)
  current_mileage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : normalizePlate(value)))
  @Matches(PLATE_PATTERN, { message: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' })
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(17)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  fuel_type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5_000_000)
  current_mileage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class VehicleListQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;
}

const SELECT = `select v.*, c.name as customer_name, c.phone as customer_phone
                  from public.vehicles v join public.customers c on c.id = v.customer_id`;

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger('Vehicles');

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env
  ) {}

  list(ctx: TenantContext, query: VehicleListQuery): Promise<Paginated<Vehicle>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const term = query.q?.trim();
    if (term) {
      params.push(`%${normalizePlate(term) || term}%`, `%${term}%`);
      conditions.push(`(v.plate like $1 or v.model ilike $2 or v.brand ilike $2)`);
    }
    if (query.customer_id) {
      params.push(query.customer_id);
      conditions.push(`v.customer_id = $${params.length}`);
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    return this.db.tenant(rls(ctx), async (db) => {
      const { total } = await db.one<{ total: number }>(`select count(*)::int as total from public.vehicles v ${where}`, params);
      const rows = await db.many<Vehicle>(`${SELECT} ${where} order by v.plate limit ${query.pageSize} offset ${offsetOf(query)}`, params);
      return paginated(rows, total, query);
    });
  }

  count(ctx: TenantContext): Promise<{ total: number }> {
    return this.db.tenant(rls(ctx), (db) => db.one('select count(*)::int as total from public.vehicles'));
  }

  byPlate(ctx: TenantContext, plate: string): Promise<Vehicle> {
    return this.db.tenant(rls(ctx), async (db) => {
      const row = await db.maybeOne<Vehicle>(`${SELECT} where v.plate = $1`, [normalizePlate(plate)]);
      if (!row) throw new NotFoundException('Nenhum veículo com esta placa.');
      return row;
    });
  }

  /** Detalhe + histórico completo de ordens do veículo. */
  get(ctx: TenantContext, id: string): Promise<Vehicle & { orders: ServiceOrderSummary[] }> {
    return this.db.tenant(rls(ctx), async (db) => {
      const vehicle = await db.maybeOne<Vehicle>(`${SELECT} where v.id = $1`, [id]);
      if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
      const orders = await db.many<ServiceOrderSummary>(`${ORDER_SUMMARY_SQL} where o.vehicle_id = $1 order by o.opened_at desc`, [id]);
      return { ...vehicle, orders };
    });
  }

  create(ctx: TenantContext, dto: VehicleDto): Promise<Vehicle> {
    return this.db.tenant(rls(ctx), async (db) => {
      const owner = await db.maybeOne('select 1 from public.customers where id = $1', [dto.customer_id]);
      if (!owner) throw new BadRequestException('Cliente não encontrado.');
      return db.one<Vehicle>(
        `insert into public.vehicles (tenant_id, customer_id, plate, brand, model, year, color, vin, fuel_type, current_mileage, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [
          ctx.tenantId,
          dto.customer_id,
          dto.plate,
          blankToNull(dto.brand),
          blankToNull(dto.model),
          dto.year ?? null,
          blankToNull(dto.color),
          blankToNull(dto.vin)?.toUpperCase() ?? null,
          blankToNull(dto.fuel_type),
          dto.current_mileage ?? null,
          blankToNull(dto.notes)
        ]
      );
    });
  }

  update(ctx: TenantContext, id: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    const text = (value: string | undefined) => (value === undefined ? undefined : blankToNull(value));
    const { sets, values } = buildUpdate(
      {
        customer_id: dto.customer_id,
        plate: dto.plate,
        brand: text(dto.brand),
        model: text(dto.model),
        year: dto.year,
        color: text(dto.color),
        vin: dto.vin === undefined ? undefined : (blankToNull(dto.vin)?.toUpperCase() ?? null),
        fuel_type: text(dto.fuel_type),
        current_mileage: dto.current_mileage,
        notes: text(dto.notes)
      },
      2
    );
    return this.db.tenant(rls(ctx), async (db) => {
      const sql = sets.length ? `update public.vehicles set ${sets.join(', ')} where id = $1 returning *` : 'select * from public.vehicles where id = $1';
      const row = await db.maybeOne<Vehicle>(sql, [id, ...values]);
      if (!row) throw new NotFoundException('Veículo não encontrado.');
      return row;
    });
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    const deleted = await this.db.tenant(rls(ctx), (db) => db.exec('delete from public.vehicles where id = $1', [id]));
    if (!deleted) throw new NotFoundException('Veículo não encontrado.');
  }

  /**
   * Consulta de dados do veículo por placa em provedor externo (FIPE_PLATE_API_URL), com cache de 30 dias.
   * É um atalho de preenchimento: qualquer falha vira 503 amigável e o cadastro segue manual.
   */
  async lookupPlate(
    rawPlate: string
  ): Promise<{ plate: string; brand: string | null; model: string | null; year: number | null; color: string | null; cached: boolean }> {
    const plate = normalizePlate(rawPlate);
    if (!PLATE_PATTERN.test(plate)) throw new BadRequestException('Placa inválida. Use o formato ABC1234 ou ABC1D23.');
    const unavailable = new ServiceUnavailableException('Consulta de placa indisponível no momento. Preencha os dados manualmente.');

    const cached = await this.db.admin((db) =>
      db.maybeOne<{ payload: Record<string, unknown> }>(`select payload from public.fipe_cache where plate = $1 and fetched_at > now() - interval '30 days'`, [
        plate
      ])
    );
    if (cached) return { ...shape(plate, cached.payload), cached: true };
    if (!this.env.fipePlateApiUrl) throw unavailable;

    let payload: Record<string, unknown>;
    try {
      const response = await fetch(this.env.fipePlateApiUrl.replace('{plate}', plate), { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`Consulta de placa falhou: ${(error as Error).message}`);
      throw unavailable;
    }
    await this.db.admin((db) =>
      db.exec(
        `insert into public.fipe_cache (plate, payload) values ($1, $2)
         on conflict (plate) do update set payload = excluded.payload, fetched_at = now()`,
        [plate, JSON.stringify(payload)]
      )
    );
    return { ...shape(plate, payload), cached: false };
  }
}

function shape(plate: string, payload: Record<string, unknown>) {
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return null;
  };
  const year = Number(pick('year', 'ano', 'anoModelo', 'ano_modelo'));
  return {
    plate,
    brand: pick('brand', 'marca'),
    model: pick('model', 'modelo'),
    year: Number.isInteger(year) && year > 1900 ? year : null,
    color: pick('color', 'cor')
  };
}

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@Ctx() ctx: TenantContext, @Query() query: VehicleListQuery) {
    return this.vehicles.list(ctx, query);
  }

  @Get('count')
  count(@Ctx() ctx: TenantContext) {
    return this.vehicles.count(ctx);
  }

  @Get('by-plate/:plate')
  byPlate(@Ctx() ctx: TenantContext, @Param('plate') plate: string) {
    return this.vehicles.byPlate(ctx, plate);
  }

  @Get('lookup/:plate')
  lookup(@Param('plate') plate: string) {
    return this.vehicles.lookupPlate(plate);
  }

  @Get(':id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @Post()
  create(@Ctx() ctx: TenantContext, @Body() dto: VehicleDto) {
    return this.vehicles.create(ctx, dto);
  }

  @Roles(...STAFF_WRITE)
  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(ctx, id, dto);
  }

  @Roles(...MANAGEMENT)
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.remove(ctx, id);
  }
}

@Module({ controllers: [VehiclesController, FipeController], providers: [VehiclesService, FipeService], exports: [VehiclesService] })
export class VehiclesModule {}
