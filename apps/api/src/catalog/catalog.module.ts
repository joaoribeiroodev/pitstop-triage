import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ShopPart, ShopService } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, Roles } from '../common/decorators';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { DatabaseService } from '../database/database.service';

export class ShopServiceDto {
  @IsString() @MinLength(2) @MaxLength(160)
  name: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  default_price: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  duration_minutes?: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

export class UpdateShopServiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160)
  name?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  default_price?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  duration_minutes?: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

export class ShopPartDto {
  @IsString() @MinLength(2) @MaxLength(160)
  name: string;

  @IsOptional() @IsString() @MaxLength(60)
  sku?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  default_price: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

export class UpdateShopPartDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160)
  name?: string;

  @IsOptional() @IsString() @MaxLength(60)
  sku?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  default_price?: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

const SERVICE_COLUMNS = 'id, name, description, default_price, duration_minutes, is_active';
const PART_COLUMNS = 'id, name, sku, default_price, is_active';

/** Catálogo próprio da oficina: agiliza orçamentos e enriquece as sugestões com preços reais. */
@Injectable()
export class ShopCatalogService {
  constructor(private readonly db: DatabaseService) {}

  listServices(ctx: TenantContext): Promise<ShopService[]> {
    return this.db.tenant(rls(ctx), (db) => db.many(`select ${SERVICE_COLUMNS} from public.shop_services_catalog order by name`));
  }

  createService(ctx: TenantContext, dto: ShopServiceDto): Promise<ShopService> {
    return this.db.tenant(rls(ctx), (db) =>
      db.one(
        `insert into public.shop_services_catalog (tenant_id, name, description, default_price, duration_minutes, is_active)
         values ($1, $2, $3, $4, $5, $6) returning ${SERVICE_COLUMNS}`,
        [ctx.tenantId, dto.name.trim(), blankToNull(dto.description), dto.default_price, dto.duration_minutes ?? null, dto.is_active ?? true]
      )
    );
  }

  updateService(ctx: TenantContext, id: string, dto: UpdateShopServiceDto): Promise<ShopService> {
    return this.patch(ctx, 'shop_services_catalog', SERVICE_COLUMNS, id, {
      name: dto.name?.trim(),
      description: dto.description === undefined ? undefined : blankToNull(dto.description),
      default_price: dto.default_price,
      duration_minutes: dto.duration_minutes,
      is_active: dto.is_active
    });
  }

  listParts(ctx: TenantContext): Promise<ShopPart[]> {
    return this.db.tenant(rls(ctx), (db) => db.many(`select ${PART_COLUMNS} from public.shop_parts_catalog order by name`));
  }

  createPart(ctx: TenantContext, dto: ShopPartDto): Promise<ShopPart> {
    return this.db.tenant(rls(ctx), (db) =>
      db.one(
        `insert into public.shop_parts_catalog (tenant_id, name, sku, default_price, is_active)
         values ($1, $2, $3, $4, $5) returning ${PART_COLUMNS}`,
        [ctx.tenantId, dto.name.trim(), blankToNull(dto.sku), dto.default_price, dto.is_active ?? true]
      )
    );
  }

  updatePart(ctx: TenantContext, id: string, dto: UpdateShopPartDto): Promise<ShopPart> {
    return this.patch(ctx, 'shop_parts_catalog', PART_COLUMNS, id, {
      name: dto.name?.trim(),
      sku: dto.sku === undefined ? undefined : blankToNull(dto.sku),
      default_price: dto.default_price,
      is_active: dto.is_active
    });
  }

  async remove(ctx: TenantContext, table: 'shop_services_catalog' | 'shop_parts_catalog', id: string): Promise<void> {
    const deleted = await this.db.tenant(rls(ctx), (db) => db.exec(`delete from public.${table} where id = $1`, [id]));
    if (!deleted) throw new NotFoundException('Item de catálogo não encontrado.');
  }

  private patch<T>(ctx: TenantContext, table: string, columns: string, id: string, fields: Record<string, unknown>): Promise<T> {
    const { sets, values } = buildUpdate(fields, 2);
    return this.db.tenant(rls(ctx), async (db) => {
      const sql = sets.length
        ? `update public.${table} set ${sets.join(', ')} where id = $1 returning ${columns}`
        : `select ${columns} from public.${table} where id = $1`;
      const row = await db.maybeOne<T>(sql, [id, ...values]);
      if (!row) throw new NotFoundException('Item de catálogo não encontrado.');
      return row;
    });
  }
}

@Controller('catalog')
export class ShopCatalogController {
  constructor(private readonly catalog: ShopCatalogService) {}

  @Get('services')
  listServices(@Ctx() ctx: TenantContext) {
    return this.catalog.listServices(ctx);
  }

  @Roles(...MANAGEMENT)
  @Post('services')
  createService(@Ctx() ctx: TenantContext, @Body() dto: ShopServiceDto) {
    return this.catalog.createService(ctx, dto);
  }

  @Roles(...MANAGEMENT)
  @Patch('services/:id')
  updateService(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShopServiceDto) {
    return this.catalog.updateService(ctx, id, dto);
  }

  @Roles(...MANAGEMENT)
  @HttpCode(204)
  @Delete('services/:id')
  removeService(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(ctx, 'shop_services_catalog', id);
  }

  @Get('parts')
  listParts(@Ctx() ctx: TenantContext) {
    return this.catalog.listParts(ctx);
  }

  @Roles(...MANAGEMENT)
  @Post('parts')
  createPart(@Ctx() ctx: TenantContext, @Body() dto: ShopPartDto) {
    return this.catalog.createPart(ctx, dto);
  }

  @Roles(...MANAGEMENT)
  @Patch('parts/:id')
  updatePart(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShopPartDto) {
    return this.catalog.updatePart(ctx, id, dto);
  }

  @Roles(...MANAGEMENT)
  @HttpCode(204)
  @Delete('parts/:id')
  removePart(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(ctx, 'shop_parts_catalog', id);
  }
}

@Module({ controllers: [ShopCatalogController], providers: [ShopCatalogService], exports: [ShopCatalogService] })
export class ShopCatalogModule {}
