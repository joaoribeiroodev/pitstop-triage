import { canTransition, ORDER_STATUSES, ORDER_TRANSITIONS, type DiagnosticResult } from '@pitstop/shared-types';
import { Logger } from '@nestjs/common';
import { enhanceSafely, NoOpEnhancer, type DiagnosticEnhancer } from './enhancer';
import { CatalogSymptom, computeSuggestions, EngineInput, ShopStatRow } from './engine';

const BRAKE: CatalogSymptom = {
  code: 'brake_noise',
  name: 'Chiado ao frear',
  probable_causes: [
    { name: 'Pastilhas desgastadas', weight: 0.8, notes: 'Indicador de desgaste' },
    { name: 'Disco com sulcos', weight: 0.4 },
    { name: 'Guias sem lubrificação', weight: 0.4 }
  ],
  recommended_checks: [{ name: 'Medir pastilhas', tools: ['Paquímetro'], estimated_minutes: 15 }],
  typical_parts: [{ name: 'Jogo de pastilhas', avg_quantity: 1 }],
  avg_service_minutes: 90
};

const IDLE: CatalogSymptom = {
  code: 'rough_idle',
  name: 'Marcha lenta instável',
  probable_causes: [{ name: 'TBI sujo', weight: 0.7 }],
  recommended_checks: [],
  typical_parts: [],
  avg_service_minutes: 120
};

function stat(cause: string, occurrences: number, brand = 'FORD', price: number | null = 300, minutes: number | null = 60): ShopStatRow {
  return { symptom_code: 'brake_noise', vehicle_brand: brand, cause_description: cause, occurrences, avg_price: price, avg_duration_minutes: minutes };
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    symptoms: [{ symptom_code: 'brake_noise', answers: {} }],
    vehicleBrand: 'Ford',
    catalog: [BRAKE, IDLE],
    stats: [],
    shopParts: [],
    shopServices: [],
    ...overrides
  };
}

const causesOf = (result: DiagnosticResult) => result.suggestions[0].causes;

describe('motor determinístico — contrato', () => {
  it('mesma entrada produz a mesma saída, byte a byte', () => {
    const data = input({ stats: [stat('Pastilhas desgastadas', 3), stat('Pinça travada', 1)] });
    const first = JSON.stringify(computeSuggestions(data));
    for (let run = 0; run < 25; run += 1) expect(JSON.stringify(computeSuggestions(structuredClone(data)))).toBe(first);
  });

  it('a saída não depende da ordem em que o banco devolve as linhas', () => {
    const stats = [stat('Pastilhas desgastadas', 3), stat('Pinça travada', 1), stat('Disco com sulcos', 2, 'FIAT')];
    const parts = [
      { name: 'Jogo de pastilhas', sku: 'B', default_price: 200 },
      { name: 'jogo de pastilhas', sku: 'A', default_price: 150 }
    ];
    const forward = computeSuggestions(input({ stats, shopParts: parts }));
    const backward = computeSuggestions(input({ stats: [...stats].reverse(), shopParts: [...parts].reverse(), catalog: [IDLE, BRAKE] }));
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it('não altera a entrada', () => {
    const data = input({ stats: [stat('Pastilhas desgastadas', 3)] });
    const before = JSON.stringify(data);
    computeSuggestions(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('motor determinístico — cálculo do score', () => {
  it('sem histórico: score = peso do catálogo × 0,5 e origem global', () => {
    const result = computeSuggestions(input());
    expect(result.suggestions[0].stats_scope).toBe('none');
    expect(causesOf(result)[0]).toMatchObject({
      description: 'Pastilhas desgastadas',
      global_score: 0.4,
      shop_score: 0,
      final_score: 0.4,
      origin: 'global',
      shop_occurrences: 0
    });
  });

  it('combina catálogo e frequência normalizada da oficina', () => {
    const result = computeSuggestions(input({ stats: [stat('Pastilhas desgastadas', 3), stat('Disco com sulcos', 1)] }));
    const [first, second] = causesOf(result);
    // pastilhas: 0,8×0,5 + (3/4)×0,5 = 0,775 | disco: 0,4×0,5 + (1/4)×0,5 = 0,325
    expect(first).toMatchObject({ description: 'Pastilhas desgastadas', final_score: 0.775, shop_score: 0.375, origin: 'both', shop_share_pct: 75 });
    expect(second).toMatchObject({ description: 'Disco com sulcos', final_score: 0.325, origin: 'both' });
    expect(result.suggestions[0].shop_total_occurrences).toBe(4);
  });

  it('causa que só existe no histórico da oficina entra com global_score zero', () => {
    const result = computeSuggestions(input({ stats: [stat('Pinça travada', 4)] }));
    const shopOnly = causesOf(result).find((cause) => cause.description === 'Pinça travada');
    expect(shopOnly).toMatchObject({ global_score: 0, shop_score: 0.5, final_score: 0.5, origin: 'shop', avg_price: 300, avg_duration_minutes: 60 });
    expect(causesOf(result)[0].description).toBe('Pinça travada');
  });

  it('casa causas do histórico com as do catálogo ignorando caixa e acentos', () => {
    const result = computeSuggestions(input({ stats: [stat('  pastilhas DESGASTADAS ', 2)] }));
    expect(causesOf(result)).toHaveLength(3);
    expect(causesOf(result)[0]).toMatchObject({ description: 'Pastilhas desgastadas', origin: 'both', shop_occurrences: 2 });
  });

  it('desempata por ordem alfabética da descrição', () => {
    const result = computeSuggestions(input());
    const tied = causesOf(result)
      .filter((cause) => cause.final_score === 0.2)
      .map((cause) => cause.description);
    expect(tied).toEqual(['Disco com sulcos', 'Guias sem lubrificação']);
  });

  it('o score final fica sempre entre 0 e 1, mesmo com peso de catálogo fora da faixa', () => {
    const wild = {
      ...BRAKE,
      probable_causes: [
        { name: 'X', weight: 7 },
        { name: 'Y', weight: -3 }
      ]
    };
    const result = computeSuggestions(input({ catalog: [wild], stats: [stat('X', 10)] }));
    for (const cause of causesOf(result)) {
      expect(cause.final_score).toBeGreaterThanOrEqual(0);
      expect(cause.final_score).toBeLessThanOrEqual(1);
    }
  });
});

describe('motor determinístico — escopo por marca', () => {
  const stats = [stat('Pastilhas desgastadas', 5, 'FORD'), stat('Disco com sulcos', 20, 'FIAT')];

  it('com 5+ ocorrências na marca, usa apenas o histórico da marca', () => {
    const result = computeSuggestions(input({ stats, vehicleBrand: 'ford' }));
    expect(result.suggestions[0]).toMatchObject({ stats_scope: 'brand', shop_total_occurrences: 5 });
    expect(causesOf(result).find((cause) => cause.description === 'Disco com sulcos')?.shop_occurrences).toBe(0);
    expect(causesOf(result)[0].phrasing).toContain('para veículos FORD');
  });

  it('abaixo do mínimo, agrega todas as marcas', () => {
    const result = computeSuggestions(input({ stats: [stat('Pastilhas desgastadas', 4, 'FORD'), stats[1]], vehicleBrand: 'Ford' }));
    expect(result.suggestions[0]).toMatchObject({ stats_scope: 'all', shop_total_occurrences: 24 });
  });

  it('pondera preço e duração médios pelas ocorrências ao agregar marcas', () => {
    const result = computeSuggestions(
      input({ vehicleBrand: null, stats: [stat('Pastilhas desgastadas', 1, 'FORD', 100, 30), stat('Pastilhas desgastadas', 3, 'FIAT', 300, 90)] })
    );
    expect(causesOf(result)[0]).toMatchObject({ shop_occurrences: 4, avg_price: 250, avg_duration_minutes: 75 });
  });
});

describe('motor determinístico — enriquecimento e saída', () => {
  it('anexa preço e SKU da oficina às peças e preço/duração às verificações', () => {
    const result = computeSuggestions(
      input({
        shopParts: [{ name: 'JOGO DE PASTILHAS', sku: 'PF-1', default_price: 189.9 }],
        shopServices: [{ name: 'medir pastilhas', default_price: 40, duration_minutes: 20 }]
      })
    );
    expect(result.suggestions[0].parts[0]).toMatchObject({ shop_price: 189.9, shop_sku: 'PF-1' });
    expect(result.suggestions[0].checks[0]).toMatchObject({ shop_price: 40, shop_duration_minutes: 20 });
  });

  it('sem cadastro na oficina, os campos de enriquecimento ficam nulos', () => {
    const result = computeSuggestions(input());
    expect(result.suggestions[0].parts[0]).toMatchObject({ shop_price: null, shop_sku: null });
  });

  it('soma o tempo estimado e mantém a ordem dos sintomas relatados', () => {
    const result = computeSuggestions(
      input({
        symptoms: [
          { symptom_code: 'rough_idle', answers: {} },
          { symptom_code: 'brake_noise', answers: {} },
          { symptom_code: 'rough_idle', answers: {} }
        ]
      })
    );
    expect(result.suggestions.map((suggestion) => suggestion.symptom_code)).toEqual(['rough_idle', 'brake_noise']);
    expect(result.total_estimated_minutes).toBe(210);
  });

  it('sintoma fora do catálogo é reportado, não derruba o cálculo', () => {
    const result = computeSuggestions(
      input({
        symptoms: [
          { symptom_code: 'nao_existe', answers: {} },
          { symptom_code: 'brake_noise', answers: {} }
        ]
      })
    );
    expect(result.unknown_symptoms).toEqual(['nao_existe']);
    expect(result.suggestions).toHaveLength(1);
  });

  it('a linguagem é sempre de sugestão, nunca afirmativa', () => {
    const result = computeSuggestions(input({ stats: [stat('Pastilhas desgastadas', 3)] }));
    for (const cause of causesOf(result)) expect(cause.phrasing).toMatch(/^Considere verificar: /);
    expect(causesOf(result)[0].phrasing).toContain('3 de 3 OS desta oficina');
  });
});

describe('DiagnosticEnhancer — a camada opcional nunca está no caminho crítico', () => {
  const base = computeSuggestions(input());
  const logger = new Logger('test');
  beforeAll(() => jest.spyOn(logger, 'warn').mockImplementation(() => undefined));

  it('desligado para o tenant: nem chega a ser chamado', async () => {
    const enhancer: DiagnosticEnhancer = { enhance: jest.fn() };
    expect(await enhanceSafely(enhancer, base, { tenantId: 't', enabled: false }, logger)).toBe(base);
    expect(enhancer.enhance).not.toHaveBeenCalled();
  });

  it('NoOp devolve a saída determinística intacta', async () => {
    expect(await enhanceSafely(new NoOpEnhancer(), base, { tenantId: 't', enabled: true }, logger)).toBe(base);
  });

  it('se a implementação falhar, vale a saída determinística', async () => {
    const broken: DiagnosticEnhancer = { enhance: () => Promise.reject(new Error('fora do ar')) };
    expect(await enhanceSafely(broken, base, { tenantId: 't', enabled: true }, logger)).toBe(base);
  });

  it('se a implementação devolver algo inválido, vale a saída determinística', async () => {
    const liar: DiagnosticEnhancer = { enhance: async () => ({ ...base, suggestions: [] }) };
    expect(await enhanceSafely(liar, base, { tenantId: 't', enabled: true }, logger)).toBe(base);
  });
});

describe('matriz de transições da OS', () => {
  it('permite o caminho feliz completo', () => {
    const path = ['draft', 'diagnosis', 'awaiting_approval', 'approved', 'in_progress', 'completed', 'delivered'] as const;
    for (let step = 0; step < path.length - 1; step += 1) expect(canTransition(path[step], path[step + 1])).toBe(true);
  });

  it('bloqueia os atalhos proibidos pela especificação', () => {
    expect(canTransition('diagnosis', 'approved')).toBe(false);
    expect(canTransition('awaiting_approval', 'in_progress')).toBe(false);
    expect(canTransition('draft', 'in_progress')).toBe(false);
    expect(canTransition('in_progress', 'delivered')).toBe(false);
    expect(canTransition('approved', 'delivered')).toBe(false);
  });

  it('recusa volta para diagnóstico ou cancela; estados finais não saem do lugar', () => {
    expect([...ORDER_TRANSITIONS.rejected]).toEqual(['diagnosis', 'cancelled']);
    expect(ORDER_TRANSITIONS.delivered).toHaveLength(0);
    expect(ORDER_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it('nenhum estado transita para si mesmo e todo destino é um estado conhecido', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
      for (const target of ORDER_TRANSITIONS[status]) expect(ORDER_STATUSES).toContain(target);
    }
  });
});
