import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { TenantContext } from '../common/context';
import { Ctx, RequireFeature, Roles, STAFF_WRITE } from '../common/decorators';
import { ItemDto } from '../service-orders/service-orders.dto';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { AccessTokenService } from './access-token.service';
import { QuotesService } from './quotes.service';

export class ReplaceItemsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}

export class RespondDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get('service-orders/:orderId/quotes')
  list(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.quotes.listForOrder(ctx, orderId);
  }

  @Post('service-orders/:orderId/quotes')
  create(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.quotes.createFromOrder(ctx, orderId);
  }

  @Get('quotes/:id')
  get(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(ctx, id);
  }

  @Put('quotes/:id/items')
  replaceItems(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceItemsDto) {
    return this.quotes.replaceItems(ctx, id, dto.items);
  }

  @Roles(...STAFF_WRITE)
  @HttpCode(200)
  @Post('quotes/:id/send')
  send(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(ctx, id);
  }

  @Roles(...STAFF_WRITE)
  @HttpCode(200)
  @Post('quotes/:id/approve')
  approve(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.quotes.respondAsStaff(ctx, id, 'approved', dto.notes);
  }

  @Roles(...STAFF_WRITE)
  @HttpCode(200)
  @Post('quotes/:id/reject')
  reject(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.quotes.respondAsStaff(ctx, id, 'rejected', dto.notes);
  }

  @RequireFeature('portal')
  @Roles(...STAFF_WRITE)
  @Post('service-orders/:orderId/access-links')
  issueLink(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.quotes.issueTrackingLink(ctx, orderId);
  }

  @Roles(...STAFF_WRITE)
  @Get('service-orders/:orderId/access-links')
  listLinks(@Ctx() ctx: TenantContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.quotes.listLinks(ctx, orderId);
  }

  @Roles(...STAFF_WRITE)
  @HttpCode(204)
  @Delete('access-links/:id')
  revokeLink(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.revokeLink(ctx, id);
  }
}

@Module({
  imports: [ServiceOrdersModule],
  controllers: [QuotesController],
  providers: [QuotesService, AccessTokenService],
  exports: [QuotesService, AccessTokenService]
})
export class QuotesModule {}
