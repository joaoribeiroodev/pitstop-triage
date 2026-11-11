import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested
} from 'class-validator';
import { ITEM_TYPES, ItemType, ORDER_STATUSES, OrderStatus } from '@pitstop/shared-types';
import { PaginationQuery } from '../common/pagination';
import { ReportedSymptomDto } from '../common/symptoms';

export class CreateOrderDto {
  @IsUUID()
  customer_id: string;

  @IsUUID()
  vehicle_id: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReportedSymptomDto)
  reported_symptoms?: ReportedSymptomDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  free_form_notes?: string;

  @IsOptional()
  @IsUUID()
  assigned_mechanic_id?: string;
}

export class ConfirmedCauseDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,80}$/)
  symptom_code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  cause_description: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @ValidateIf((dto: UpdateOrderDto) => dto.assigned_mechanic_id !== null)
  @IsUUID()
  assigned_mechanic_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  mechanic_diagnosis?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedCauseDto)
  confirmed_causes?: ConfirmedCauseDto[];
}

export class ItemDto {
  @IsIn(ITEM_TYPES)
  type: ItemType;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;
}

export class UpdateItemDto {
  @IsOptional()
  @IsIn(ITEM_TYPES)
  type?: ItemType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unit_price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;
}

export class ChangeStatusDto {
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class NoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsBoolean()
  visible_to_customer?: boolean;
}

export class OrderListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsUUID()
  mechanic_id?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  vehicle_id?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class BoardQuery {
  @IsOptional()
  @IsUUID()
  mechanic_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
