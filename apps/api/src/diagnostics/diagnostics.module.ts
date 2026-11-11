import { Controller, Get, Inject, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { DiagnosticResult, ReportedSymptom } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, RequireFeature } from '../common/decorators';
import { rls } from '../common/rls';
import { DatabaseService, Db } from '../database/database.service';
import { DIAGNOSTIC_ENHANCER, DiagnosticEnhancer, enhanceSafely, NoOpEnhancer } from './enhancer';
import { CatalogSymptom, computeSuggestions, ShopPartRow, ShopServiceRow, ShopStatRow } from './engine';

export class SuggestQuery {
  @IsOptional() @IsString() @MaxLength(60)
  brand?: string;
}

@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger('Diagnostics');

  constructor(
    private readonly db: DatabaseService,
    @Inject(DIAGNOSTIC_ENHANCER) private readonly enhancer: DiagnosticEnhancer
  ) {}

  /**
   * Carrega os insumos (catálogo global + histórico e catálogos da oficina) e roda o motor.
   * Recebe o `db` da transação em curso para poder participar de operações atômicas (ex.: snapshot na transição).
   */
  async compute(db: Db, symptoms: ReportedSymptom[], vehicleBrand: string | null): Promise<DiagnosticResult> {
    const codes = [...new Set(symptoms.map((symptom) => symptom.symptom_code))];
    if (!codes.length) return computeSuggestions({ symptoms: [], vehicleBrand, catalog: [], stats: [], shopParts: [], shopServices: [] });

    const catalog = await db.many<CatalogSymptom>(
      `select code, name, probable_causes, recommended_checks, typical_parts, avg_service_minutes
         from public.symptoms where code = any($1) and is_active`,
      [codes]
    );
    const stats = await db.many<ShopStatRow>(
      `select symptom_code, vehicle_brand, cause_description, occurrences, avg_price, avg_duration_minutes
         from public.shop_symptom_stats where symptom_code = any($1)`,
      [codes]
    );
    const shopParts = await db.many<ShopPartRow>('select name, sku, default_price from public.shop_parts_catalog where is_active');
    const shopServices = await db.many<ShopServiceRow>(
      'select name, default_price, duration_minutes from public.shop_services_catalog where is_active'
    );
    return computeSuggestions({ symptoms, vehicleBrand, catalog, stats, shopParts, shopServices });
  }

  async suggest(ctx: TenantContext, symptoms: ReportedSymptom[], vehicleBrand: string | null): Promise<DiagnosticResult> {
    const result = await this.db.tenant(rls(ctx), (db) => this.compute(db, symptoms, vehicleBrand));
    return enhanceSafely(this.enhancer, result, { tenantId: ctx.tenantId, enabled: ctx.tenant.feature_flags.ai }, this.logger);
  }

  async suggestByTriage(ctx: TenantContext, triageId: string): Promise<DiagnosticResult> {
    const triage = await this.db.tenant(rls(ctx), (db) =>
      db.maybeOne<{ reported_symptoms: ReportedSymptom[]; brand: string | null }>(
        `select t.reported_symptoms, v.brand
           from public.triage_sessions t left join public.vehicles v on v.id = t.vehicle_id
          where t.id = $1`,
        [triageId]
      )
    );
    if (!triage) throw new NotFoundException('Triagem não encontrada.');
    return this.suggest(ctx, triage.reported_symptoms, triage.brand);
  }

  shopStats(ctx: TenantContext, symptomCode: string): Promise<ShopStatRow[]> {
    return this.db.tenant(rls(ctx), (db) =>
      db.many<ShopStatRow>(
        `select symptom_code, vehicle_brand, cause_description, occurrences, avg_price, avg_duration_minutes
           from public.shop_symptom_stats where symptom_code = $1
          order by occurrences desc, cause_description, vehicle_brand`,
        [symptomCode]
      )
    );
  }
}

@RequireFeature('diagnostics')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get('suggest/by-triage/:triageId')
  byTriage(@Ctx() ctx: TenantContext, @Param('triageId', ParseUUIDPipe) triageId: string) {
    return this.diagnostics.suggestByTriage(ctx, triageId);
  }

  @Get('suggest/:symptomCode')
  suggest(@Ctx() ctx: TenantContext, @Param('symptomCode') symptomCode: string, @Query() query: SuggestQuery) {
    return this.diagnostics.suggest(ctx, [{ symptom_code: symptomCode, answers: {} }], query.brand ?? null);
  }

  @Get('shop-stats/:symptomCode')
  shopStats(@Ctx() ctx: TenantContext, @Param('symptomCode') symptomCode: string) {
    return this.diagnostics.shopStats(ctx, symptomCode);
  }
}

@Module({
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, { provide: DIAGNOSTIC_ENHANCER, useClass: NoOpEnhancer }],
  exports: [DiagnosticsService]
})
export class DiagnosticsModule {}
