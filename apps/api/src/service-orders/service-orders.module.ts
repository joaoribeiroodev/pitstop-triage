import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { TenantContext } from '../common/context';
import { Ctx, RequireFeature, Roles, STAFF_WRITE } from '../common/decorators';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { FinancialModule } from '../financial/financial.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderWorkflowService } from './order-workflow.service';
import { BoardQuery, ChangeStatusDto, CreateOrderDto, ItemDto, NoteDto, OrderListQuery, UpdateItemDto, UpdateOrderDto } from './service-orders.dto';
import { ServiceOrdersService } from './service-orders.service';

@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @Get()
  list(@Ctx() ctx: TenantContext, @Query() query: OrderListQuery) {
    return this.orders.list(ctx, query);
  }

  @Get('board')
  board(@Ctx() ctx: TenantContext, @Query() query: BoardQuery) {
    return this.orders.board(ctx, query);
  }

  @Get(':id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @Post()
  create(@Ctx() ctx: TenantContext, @Body() dto: CreateOrderDto) {
    return this.orders.create(ctx, dto);
  }

  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(ctx, id, dto);
  }

  @Post(':id/items')
  addItem(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemDto) {
    return this.orders.addItem(ctx, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateItemDto) {
    return this.orders.updateItem(ctx, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.orders.removeItem(ctx, id, itemId);
  }

  @Post(':id/notes')
  addNote(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.orders.addNote(ctx, id, dto);
  }

  @HttpCode(200)
  @Post(':id/status')
  changeStatus(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.orders.changeStatus(ctx, id, dto);
  }

  @RequireFeature('diagnostics')
  @HttpCode(200)
  @Post(':id/recompute-suggestions')
  recompute(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.recomputeSuggestions(ctx, id);
  }
}

@Module({
  imports: [DiagnosticsModule, InventoryModule, FinancialModule, NotificationsModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService, OrderWorkflowService],
  exports: [ServiceOrdersService, OrderWorkflowService]
})
export class ServiceOrdersModule {}
