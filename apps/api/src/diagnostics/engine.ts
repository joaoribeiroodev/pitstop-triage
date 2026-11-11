import type {
  CauseOrigin,
  DiagnosticResult,
  ReportedSymptom,
  SuggestedCause,
  SymptomCause,
  SymptomCheck,
  SymptomPart,
  SymptomSuggestion
} from '@pitstop/shared-types';

/**
 * Motor de diagnóstico determinístico.
 *
 * Função pura: não lê relógio, banco, rede nem aleatoriedade. A mesma entrada produz
 * exatamente a mesma saída (byte a byte), o que permite snapshot, auditoria e testes de contrato.
 * Não há IA aqui — só aritmética sobre o catálogo global e o histórico da própria oficina.
 */

export const ENGINE_VERSION = '1.0.0';
/** Peso de cada fonte no score final. */
export const GLOBAL_WEIGHT = 0.5;
export const SHOP_WEIGHT = 0.5;
/** Mínimo de ocorrências na marca do veículo para o histórico ser filtrado por marca. */
export const MIN_BRAND_OCCURRENCES = 5;

export interface CatalogSymptom {
  code: string;
  name: string;
  probable_causes: SymptomCause[];
  recommended_checks: SymptomCheck[];
  typical_parts: SymptomPart[];
  avg_service_minutes: number;
}

export interface ShopStatRow {
  symptom_code: string;
  vehicle_brand: string;
  cause_description: string;
  occurrences: number;
  avg_price: number | null;
  avg_duration_minutes: number | null;
}

export interface ShopPartRow {
  name: string;
  sku: string | null;
  default_price: number;
}

export interface ShopServiceRow {
  name: string;
  default_price: number;
  duration_minutes: number | null;
}

export interface EngineInput {
  symptoms: ReportedSymptom[];
  vehicleBrand: string | null;
  catalog: CatalogSymptom[];
  stats: ShopStatRow[];
  shopParts: ShopPartRow[];
  shopServices: ShopServiceRow[];
}

/** Chave de comparação de textos livres: sem acento, sem caixa, espaços colapsados. */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBrand(value: string | null | undefined): string {
  return value ? normalizeKey(value).toUpperCase() : '';
}

/** Comparação por code unit: independe de locale/ICU da máquina, ao contrário de localeCompare. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

interface AggregatedStat {
  description: string;
  occurrences: number;
  priceSum: number;
  priceWeight: number;
  durationSum: number;
  durationWeight: number;
}

function aggregate(rows: ShopStatRow[]): Map<string, AggregatedStat> {
  const byCause = new Map<string, AggregatedStat>();
  // Ordem estável de leitura: o resultado não pode depender da ordem em que o banco devolveu as linhas.
  const ordered = [...rows].sort(
    (a, b) => compareText(a.cause_description, b.cause_description) || compareText(a.vehicle_brand, b.vehicle_brand)
  );
  for (const row of ordered) {
    if (row.occurrences <= 0) continue;
    const key = normalizeKey(row.cause_description);
    const current =
      byCause.get(key) ??
      ({ description: row.cause_description.trim(), occurrences: 0, priceSum: 0, priceWeight: 0, durationSum: 0, durationWeight: 0 } satisfies AggregatedStat);
    current.occurrences += row.occurrences;
    if (row.avg_price !== null) {
      current.priceSum += row.avg_price * row.occurrences;
      current.priceWeight += row.occurrences;
    }
    if (row.avg_duration_minutes !== null) {
      current.durationSum += row.avg_duration_minutes * row.occurrences;
      current.durationWeight += row.occurrences;
    }
    byCause.set(key, current);
  }
  return byCause;
}

function phrase(description: string, occurrences: number, total: number, sharePct: number, scopeLabel: string): string {
  if (occurrences === 0) return `Considere verificar: ${description}. Sugestão do catálogo técnico, ainda sem histórico nesta oficina.`;
  return `Considere verificar: ${description}. Historicamente associado a este sintoma em ${occurrences} de ${total} OS desta oficina${scopeLabel} (${sharePct}%).`;
}

function suggestFor(
  reported: ReportedSymptom,
  symptom: CatalogSymptom,
  input: EngineInput,
  brand: string,
  partsByName: Map<string, ShopPartRow>,
  servicesByName: Map<string, ShopServiceRow>
): SymptomSuggestion {
  const symptomStats = input.stats.filter((row) => row.symptom_code === reported.symptom_code && row.occurrences > 0);
  const brandStats = brand ? symptomStats.filter((row) => normalizeBrand(row.vehicle_brand) === brand) : [];
  const brandTotal = brandStats.reduce((sum, row) => sum + row.occurrences, 0);
  const useBrand = brandTotal >= MIN_BRAND_OCCURRENCES;
  const scope: SymptomSuggestion['stats_scope'] = useBrand ? 'brand' : symptomStats.length ? 'all' : 'none';
  const shop = aggregate(useBrand ? brandStats : symptomStats);
  const shopTotal = [...shop.values()].reduce((sum, stat) => sum + stat.occurrences, 0);
  const scopeLabel = useBrand ? ` para veículos ${brand}` : '';

  const causes: SuggestedCause[] = [];
  const seen = new Set<string>();

  for (const cause of symptom.probable_causes) {
    const key = normalizeKey(cause.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const stat = shop.get(key);
    causes.push(buildCause(cause.name.trim(), Math.min(Math.max(cause.weight, 0), 1), cause.notes ?? null, stat, shopTotal, scopeLabel));
  }
  for (const [key, stat] of shop) {
    if (seen.has(key)) continue;
    seen.add(key);
    causes.push(buildCause(stat.description, null, null, stat, shopTotal, scopeLabel));
  }

  causes.sort((a, b) => b.final_score - a.final_score || compareText(a.description, b.description));

  return {
    symptom_code: symptom.code,
    symptom_name: symptom.name,
    stats_scope: scope,
    shop_total_occurrences: shopTotal,
    causes,
    checks: symptom.recommended_checks.map((check) => {
      const service = servicesByName.get(normalizeKey(check.name));
      return {
        name: check.name,
        tools: [...(check.tools ?? [])],
        estimated_minutes: check.estimated_minutes,
        shop_price: service ? service.default_price : null,
        shop_duration_minutes: service ? service.duration_minutes : null
      };
    }),
    parts: symptom.typical_parts.map((part) => {
      const shopPart = partsByName.get(normalizeKey(part.name));
      return {
        name: part.name,
        avg_quantity: part.avg_quantity,
        shop_price: shopPart ? shopPart.default_price : null,
        shop_sku: shopPart ? shopPart.sku : null
      };
    }),
    estimated_minutes: symptom.avg_service_minutes
  };
}

function buildCause(
  description: string,
  catalogWeight: number | null,
  notes: string | null,
  stat: AggregatedStat | undefined,
  shopTotal: number,
  scopeLabel: string
): SuggestedCause {
  const occurrences = stat?.occurrences ?? 0;
  const frequency = shopTotal > 0 ? occurrences / shopTotal : 0;
  const globalScore = round((catalogWeight ?? 0) * GLOBAL_WEIGHT, 4);
  const shopScore = round(frequency * SHOP_WEIGHT, 4);
  const origin: CauseOrigin = catalogWeight !== null && occurrences > 0 ? 'both' : catalogWeight !== null ? 'global' : 'shop';
  const sharePct = round(frequency * 100, 1);
  return {
    description,
    final_score: round(globalScore + shopScore, 4),
    global_score: globalScore,
    shop_score: shopScore,
    origin,
    shop_occurrences: occurrences,
    shop_share_pct: sharePct,
    avg_price: stat && stat.priceWeight > 0 ? round(stat.priceSum / stat.priceWeight, 2) : null,
    avg_duration_minutes: stat && stat.durationWeight > 0 ? round(stat.durationSum / stat.durationWeight, 1) : null,
    notes,
    phrasing: phrase(description, occurrences, shopTotal, sharePct, scopeLabel)
  };
}

export function computeSuggestions(input: EngineInput): DiagnosticResult {
  const brand = normalizeBrand(input.vehicleBrand);
  const catalogByCode = new Map(input.catalog.map((symptom) => [symptom.code, symptom]));
  // Em nomes duplicados no catálogo da oficina vence o primeiro em ordem alfabética de SKU/nome — regra fixa, não acaso.
  const partsByName = new Map<string, ShopPartRow>();
  for (const part of [...input.shopParts].sort((a, b) => compareText(a.name, b.name) || compareText(a.sku ?? '', b.sku ?? ''))) {
    const key = normalizeKey(part.name);
    if (!partsByName.has(key)) partsByName.set(key, part);
  }
  const servicesByName = new Map<string, ShopServiceRow>();
  for (const service of [...input.shopServices].sort((a, b) => compareText(a.name, b.name) || a.default_price - b.default_price)) {
    const key = normalizeKey(service.name);
    if (!servicesByName.has(key)) servicesByName.set(key, service);
  }

  const suggestions: SymptomSuggestion[] = [];
  const unknown: string[] = [];
  const handled = new Set<string>();
  for (const reported of input.symptoms) {
    if (handled.has(reported.symptom_code)) continue;
    handled.add(reported.symptom_code);
    const symptom = catalogByCode.get(reported.symptom_code);
    if (!symptom) {
      unknown.push(reported.symptom_code);
      continue;
    }
    suggestions.push(suggestFor(reported, symptom, input, brand, partsByName, servicesByName));
  }

  return {
    engine_version: ENGINE_VERSION,
    vehicle_brand: brand || null,
    suggestions,
    total_estimated_minutes: suggestions.reduce((sum, suggestion) => sum + suggestion.estimated_minutes, 0),
    unknown_symptoms: unknown
  };
}
