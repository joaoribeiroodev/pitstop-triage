import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { STOCK_MOVEMENT_TYPES, type InventoryItem, type StockMovement, type StockMovementType } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, MANAGEMENT, RequireFeature, Roles } from '../common/decorators';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { DatabaseService, Db } from '../database/database.service';

export class InventoryItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  quantity_on_hand?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  minimum_quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_cost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_price?: number;
}

export class UpdateInventoryItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  minimum_quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_cost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_price?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class MovementDto {
  @IsIn(STOCK_MOVEMENT_TYPES)
  type: StockMovementType;

  /** Entrada e saída: quanto movimentar. Ajuste: o saldo contado. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

const ITEM_SQL = `select i.id, i.sku, i.name, i.location, i.quantity_on_hand, i.minimum_quantity, i.unit_cost, i.unit_price, i.is_active,
                         (i.quantity_on_hand <= i.minimum_quantity) as low_stock, i.created_at, i.updated_at
                    from public.inventory_items i`;

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService) {}

  list(ctx: TenantContext, q?: string, lowOnly = false): Promise<InventoryItem[]> {
    const term = q?.trim();
    return this.db.tenant(rls(ctx), (db) =>
      db.many<InventoryItem>(
        `${ITEM_SQL}
          where ($1::text is null or i.name ilike '%' || $1 || '%' or i.sku ilike '%' || $1 || '%')
            and (not $2 or (i.is_active and i.quantity_on_hand <= i.minimum_quantity))
          order by i.is_active desc, lower(i.name)`,
        [term || null, lowOnly]
      )
    );
  }

  private async find(db: Db, id: string): Promise<InventoryItem> {
    const item = await db.maybeOne<InventoryItem>(`${ITEM_SQL} where i.id = $1`, [id]);
    if (!item) throw new NotFoundException('Item de estoque não encontrado.');
    return item;
  }

  get(ctx: TenantContext, id: string): Promise<InventoryItem & { movements: StockMovement[] }> {
    return this.db.tenant(rls(ctx), async (db) => {
      const item = await this.find(db, id);
      const movements = await db.many<StockMovement>(
        `select m.id, m.inventory_item_id, m.type, m.quantity, m.reason, m.service_order_id, m.created_at,
                o.order_number, u.full_name as created_by_name
           from public.stock_movements m
           left join public.service_orders o on o.id = m.service_order_id
           left join public.tenant_users u on u.user_id = m.created_by
          where m.inventory_item_id = $1 order by m.created_at desc limit 100`,
        [id]
      );
      return { ...item, movements };
    });
  }

  create(ctx: TenantContext, dto: InventoryItemDto): Promise<InventoryItem> {
    return this.db.tenant(rls(ctx), async (db) => {
      const sku = blankToNull(dto.sku);
      if (sku && (await db.maybeOne('select 1 from public.inventory_items where lower(sku) = lower($1)', [sku]))) {
        throw new BadRequestException(`Já existe um item com o código ${sku}.`);
      }
      const created = await db.one<{ id: string }>(
        `insert into public.inventory_items (tenant_id, name, sku, location, quantity_on_hand, minimum_quantity, unit_cost, unit_price)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          ctx.tenantId,
          dto.name.trim(),
          sku,
          blankToNull(dto.location),
          dto.quantity_on_hand ?? 0,
          dto.minimum_quantity ?? 0,
          dto.unit_cost ?? 0,
          dto.unit_price ?? 0
        ]
      );
      if (dto.quantity_on_hand) await this.record(db, ctx, created.id, 'in', dto.quantity_on_hand, 'Saldo inicial');
      return this.find(db, created.id);
    });
  }

  update(ctx: TenantContext, id: string, dto: UpdateInventoryItemDto): Promise<InventoryItem> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.find(db, id);
      const { sets, values } = buildUpdate(
        {
          name: dto.name?.trim(),
          sku: dto.sku === undefined ? undefined : blankToNull(dto.sku),
          location: dto.location === undefined ? undefined : blankToNull(dto.location),
          minimum_quantity: dto.minimum_quantity,
          unit_cost: dto.unit_cost,
          unit_price: dto.unit_price,
          is_active: dto.is_active
        },
        2
      );
      if (sets.length) await db.exec(`update public.inventory_items set ${sets.join(', ')} where id = $1`, [id, ...values]);
      return this.find(db, id);
    });
  }

  move(ctx: TenantContext, id: string, dto: MovementDto): Promise<InventoryItem> {
    return this.db.tenant(rls(ctx), async (db) => {
      await this.find(db, id);
      if (dto.type !== 'adjustment' && dto.quantity <= 0) throw new BadRequestException('Informe uma quantidade maior que zero.');
      await this.applyMovement(db, ctx, id, dto.type, dto.quantity, blankToNull(dto.reason), null);
      return this.find(db, id);
    });
  }

  /**
   * Baixa automática das peças de uma OS concluída. Roda na mesma transação da conclusão e é idempotente:
   * uma OS que já gerou saída não gera de novo. O saldo pode ficar negativo — a oficina usou a peça de fato,
   * e esconder isso seria pior do que mostrar a divergência para o inventário corrigir.
   */
  async consumeForOrder(db: Db, ctx: TenantContext, orderId: string): Promise<number> {
    const already = await db.maybeOne(`select 1 from public.stock_movements where service_order_id = $1 and type = 'out' limit 1`, [orderId]);
    if (already) return 0;
    const parts = await db.many<{ inventory_item_id: string; quantity: number; order_number: number }>(
      `select i.inventory_item_id, sum(i.quantity) as quantity, o.order_number
         from public.service_order_items i join public.service_orders o on o.id = i.service_order_id
        where i.service_order_id = $1 and i.type = 'part' and i.inventory_item_id is not null
        group by i.inventory_item_id, o.order_number`,
      [orderId]
    );
    for (const part of parts) {
      await this.applyMovement(db, ctx, part.inventory_item_id, 'out', Number(part.quantity), `Baixa automática da OS ${part.order_number}`, orderId);
    }
    return parts.length;
  }

  private async applyMovement(
    db: Db,
    ctx: TenantContext,
    itemId: string,
    type: StockMovementType,
    quantity: number,
    reason: string | null,
    orderId: string | null
  ) {
    // trava a linha do item: duas saídas simultâneas não podem ler o mesmo saldo
    await db.one('select id from public.inventory_items where id = $1 for update', [itemId]);
    const expression = type === 'in' ? 'quantity_on_hand + $2' : type === 'out' ? 'quantity_on_hand - $2' : '$2';
    await db.exec(`update public.inventory_items set quantity_on_hand = ${expression} where id = $1`, [itemId, quantity]);
    await this.record(db, ctx, itemId, type, quantity, reason, orderId);
  }

  private async record(
    db: Db,
    ctx: TenantContext,
    itemId: string,
    type: StockMovementType,
    quantity: number,
    reason: string | null,
    orderId: string | null = null
  ) {
    await db.exec(
      `insert into public.stock_movements (tenant_id, inventory_item_id, type, quantity, reason, service_order_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, itemId, type, quantity, reason, orderId, ctx.userId]
    );
  }
}

@Controller('inventory')
@RequireFeature('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('items')
  list(@Ctx() ctx: TenantContext, @Query('q') q?: string, @Query('low') low?: string) {
    return this.inventory.list(ctx, q, low === 'true' || low === '1');
  }

  @Get('items/:id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.get(ctx, id);
  }

  @Post('items')
  @Roles(...MANAGEMENT)
  create(@Ctx() ctx: TenantContext, @Body() dto: InventoryItemDto) {
    return this.inventory.create(ctx, dto);
  }

  @Patch('items/:id')
  @Roles(...MANAGEMENT)
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryItemDto) {
    return this.inventory.update(ctx, id, dto);
  }

  @Post('items/:id/movements')
  @Roles(...MANAGEMENT)
  move(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MovementDto) {
    return this.inventory.move(ctx, id, dto);
  }
}

@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
