import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
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
import { TENANT_PLANS, TENANT_STATUSES, TenantPlan, TenantStatus } from '@pitstop/shared-types';
import { PaginationQuery } from '../common/pagination';

export class FeatureFlagsDto {
  @IsOptional() @IsBoolean() triage?: boolean;
  @IsOptional() @IsBoolean() public_triage?: boolean;
  @IsOptional() @IsBoolean() diagnostics?: boolean;
  @IsOptional() @IsBoolean() portal?: boolean;
  @IsOptional() @IsBoolean() whatsapp?: boolean;
  @IsOptional() @IsBoolean() schedule?: boolean;
  @IsOptional() @IsBoolean() inventory?: boolean;
  @IsOptional() @IsBoolean() financial?: boolean;
  @IsOptional() @IsBoolean() ai?: boolean;
}

export class LimitsDto {
  @IsOptional() @IsInt() @Min(1) @Max(10_000) max_users?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) max_orders_month?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000) max_storage_mb?: number;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'O slug aceita apenas letras minúsculas, números e hífens.' })
  @MinLength(3)
  @MaxLength(60)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contact_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contact_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;

  @IsIn(TENANT_PLANS)
  plan: TenantPlan;

  @IsOptional()
  @IsBoolean()
  is_trial?: boolean;

  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @IsEmail()
  @MaxLength(254)
  owner_email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  owner_name: string;

  /** Opcional: sem senha, o proprietário recebe convite por e-mail. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  owner_password?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contact_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contact_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;

  @IsOptional()
  @IsIn(TENANT_PLANS)
  plan?: TenantPlan;

  @IsOptional()
  @IsBoolean()
  is_trial?: boolean;

  @IsOptional()
  @ValidateIf((dto: UpdateTenantDto) => dto.expires_at !== null)
  @IsDateString()
  expires_at?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FeatureFlagsDto)
  feature_flags?: FeatureFlagsDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LimitsDto)
  limits?: LimitsDto;
}

export class ConfirmSlugDto {
  @IsString()
  @MaxLength(60)
  confirm_slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ImpersonateDto {
  @IsString()
  @MinLength(5, { message: 'Descreva o motivo do acesso de suporte.' })
  @MaxLength(500)
  reason: string;
}

export class TenantListQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;
}

export class AuditQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
