import { BadRequestException, Controller, Get, Inject, Injectable, Logger, Param, ServiceUnavailableException } from '@nestjs/common';
import { FIPE_VEHICLE_TYPES, type FipeOption, type FipePrice, type FipeVehicleType } from '@pitstop/shared-types';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';

/** Marcas, modelos e anos mudam pouco; o preço muda todo mês (a FIPE publica uma tabela por mês). */
const CATALOG_TTL_DAYS = 30;
const PRICE_TTL_DAYS = 7;
const CODE = /^[0-9A-Za-z-]{1,12}$/;

/**
 * Tabela FIPE pela API pública e gratuita da Parallelum (fipe.parallelum.com.br), com cache no banco.
 * É um atalho de preenchimento do cadastro de veículo: se a API estiver fora ou o limite diário acabar,
 * a resposta é um 503 amigável e o cadastro segue manual. O cache (mesma tabela da consulta de placa)
 * faz com que a oficina quase nunca dependa da API ao vivo.
 */
@Injectable()
export class FipeService {
  private readonly logger = new Logger(FipeService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env
  ) {}

  private static type(value: string): FipeVehicleType {
    if (!(FIPE_VEHICLE_TYPES as readonly string[]).includes(value)) throw new BadRequestException('Tipo de veículo inválido.');
    return value as FipeVehicleType;
  }

  private static code(value: string): string {
    if (!CODE.test(value)) throw new BadRequestException('Código FIPE inválido.');
    return value;
  }

  private async cached<T>(path: string, ttlDays: number): Promise<T> {
    const key = `fipe:${path}`;
    const row = await this.db.admin((db) =>
      db.maybeOne<{ payload: T; fresh: boolean }>(
        `select payload, fetched_at > now() - make_interval(days => $2) as fresh from public.fipe_cache where plate = $1`,
        [key, ttlDays]
      )
    );
    if (row?.fresh) return row.payload;

    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.env.fipeApiToken) headers['X-Subscription-Token'] = this.env.fipeApiToken;
      const response = await fetch(`${this.env.fipeApiUrl}/${path}`, { headers, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as T;
      await this.db.admin((db) =>
        db.exec(
          `insert into public.fipe_cache (plate, payload) values ($1, $2)
           on conflict (plate) do update set payload = excluded.payload, fetched_at = now()`,
          [key, JSON.stringify(payload)]
        )
      );
      return payload;
    } catch (error) {
      this.logger.warn(`Consulta FIPE falhou (${path}): ${(error as Error).message}`);
      // Dado vencido ainda é melhor que nenhum: marcas e modelos antigos continuam valendo.
      if (row) return row.payload;
      throw new ServiceUnavailableException('Tabela FIPE indisponível no momento. Preencha os dados manualmente.');
    }
  }

  private async options(path: string): Promise<FipeOption[]> {
    const list = await this.cached<Array<{ code: unknown; name: unknown }>>(path, CATALOG_TTL_DAYS);
    if (!Array.isArray(list)) throw new ServiceUnavailableException('Tabela FIPE indisponível no momento. Preencha os dados manualmente.');
    return list
      .filter((item) => item && item.code !== null && item.code !== undefined && item.name !== null && item.name !== undefined)
      .map((item) => ({ code: String(item.code), name: String(item.name) }));
  }

  brands(type: string): Promise<FipeOption[]> {
    return this.options(`${FipeService.type(type)}/brands`);
  }

  models(type: string, brand: string): Promise<FipeOption[]> {
    return this.options(`${FipeService.type(type)}/brands/${FipeService.code(brand)}/models`);
  }

  years(type: string, brand: string, model: string): Promise<FipeOption[]> {
    return this.options(`${FipeService.type(type)}/brands/${FipeService.code(brand)}/models/${FipeService.code(model)}/years`);
  }

  async price(type: string, brand: string, model: string, year: string): Promise<FipePrice> {
    const path = `${FipeService.type(type)}/brands/${FipeService.code(brand)}/models/${FipeService.code(model)}/years/${FipeService.code(year)}`;
    const raw = await this.cached<Record<string, unknown>>(path, PRICE_TTL_DAYS);
    const text = (key: string) => (typeof raw[key] === 'string' && (raw[key] as string).trim() ? (raw[key] as string).trim() : null);
    // "R$ 16.421,00" → 16421
    const price = Number(
      text('price')
        ?.replace(/[^\d,]/g, '')
        .replace(',', '.')
    );
    const year_ = Number(raw['modelYear']);
    return {
      brand: text('brand'),
      model: text('model'),
      // a FIPE usa 32000 para "zero km"
      year: Number.isInteger(year_) && year_ > 1900 && year_ < 2200 ? year_ : null,
      fuel: text('fuel'),
      fipe_code: text('codeFipe'),
      price: Number.isFinite(price) && price > 0 ? price : null,
      reference_month: text('referenceMonth')
    };
  }
}

/** Consulta à tabela FIPE para preencher o cadastro do veículo. Qualquer usuário da oficina pode consultar. */
@Controller('fipe')
export class FipeController {
  constructor(private readonly fipe: FipeService) {}

  @Get(':type/brands')
  brands(@Param('type') type: string) {
    return this.fipe.brands(type);
  }

  @Get(':type/brands/:brand/models')
  models(@Param('type') type: string, @Param('brand') brand: string) {
    return this.fipe.models(type, brand);
  }

  @Get(':type/brands/:brand/models/:model/years')
  years(@Param('type') type: string, @Param('brand') brand: string, @Param('model') model: string) {
    return this.fipe.years(type, brand, model);
  }

  @Get(':type/brands/:brand/models/:model/years/:year')
  price(@Param('type') type: string, @Param('brand') brand: string, @Param('model') model: string, @Param('year') year: string) {
    return this.fipe.price(type, brand, model, year);
  }
}
