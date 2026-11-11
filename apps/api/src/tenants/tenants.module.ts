import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Tenant } from '@pitstop/shared-types';
import { toTenantInfo } from '../auth/guards';
import type { TenantContext, TenantInfo } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { DatabaseService } from '../database/database.service';

export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsBoolean()
  mechanics_see_all_orders?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  portal_token_days?: number;

  /** Boxes de serviço usados na agenda. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  bays?: string[];
}

/** Dados e preferências da própria oficina. Plano, limites e flags só mudam pelo painel admin. */
@Controller('tenant')
export class TenantsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  current(@Ctx() ctx: TenantContext): TenantInfo {
    return ctx.tenant;
  }

  @Roles('owner')
  @Patch('settings')
  async updateSettings(@Ctx() ctx: TenantContext, @Body() dto: UpdateTenantSettingsDto): Promise<TenantInfo> {
    const patch = JSON.stringify(dto.bays ? { ...dto, bays: [...new Set(dto.bays.map((bay) => bay.trim()).filter(Boolean))] } : dto);
    // tenants não tem política de escrita para `authenticated`: a alteração passa pelo backend, restrita ao próprio id.
    const tenant = await this.db.admin((db) =>
      db.one<Tenant>(`update public.tenants set settings = settings || $2::jsonb where id = $1 returning *`, [ctx.tenantId, patch])
    );
    return toTenantInfo(tenant);
  }
}

@Module({ controllers: [TenantsController] })
export class TenantsModule {}
