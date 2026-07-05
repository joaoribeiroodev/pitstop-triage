/** JSON Schemas (OpenAI structured outputs) — espelham os modelos do frontend. */

const faixaSchema = {
  type: 'object',
  properties: {
    min: { type: 'number' },
    max: { type: 'number' }
  },
  required: ['min', 'max'],
  additionalProperties: false
} as const;

const componenteSchema = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    teste_recomendado: { type: 'string' }
  },
  required: ['nome', 'prioridade', 'teste_recomendado'],
  additionalProperties: false
} as const;

const hipoteseSchema = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    sistema_afetado: { type: 'string' },
    probabilidade: { type: 'number' },
    confianca: { type: 'string', enum: ['baixa', 'media', 'alta'] },
    justificativa_tecnica: { type: 'string' },
    evidencias_usadas: {
      type: 'array',
      items: { type: 'string' }
    },
    componentes_a_verificar: {
      type: 'array',
      items: componenteSchema
    },
    codigos_obd_possiveis: {
      type: 'array',
      items: { type: 'string' }
    },
    custo_estimado_brl: faixaSchema,
    tempo_reparo_horas: faixaSchema
  },
  required: [
    'titulo',
    'sistema_afetado',
    'probabilidade',
    'confianca',
    'justificativa_tecnica',
    'evidencias_usadas',
    'componentes_a_verificar',
    'custo_estimado_brl',
    'tempo_reparo_horas'
  ],
  additionalProperties: false
} as const;

const descartadoSchema = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    motivo_descarte: { type: 'string' }
  },
  required: ['titulo', 'motivo_descarte'],
  additionalProperties: false
} as const;

export const diagnosticoJsonSchema = {
  type: 'object',
  properties: {
    urgencia_geral: {
      type: 'string',
      enum: ['baixa', 'media', 'alta', 'critica']
    },
    pode_dirigir: {
      type: 'string',
      enum: ['sim_normal', 'sim_com_cautela', 'apenas_curtas_distancias', 'nao_dirigir']
    },
    risco_principal: { type: 'string' },
    observacoes_seguranca: { type: 'string' },
    acoes_imediatas: {
      type: 'array',
      items: { type: 'string' }
    },
    hipoteses: {
      type: 'array',
      items: hipoteseSchema
    },
    diagnosticos_descartados: {
      type: 'array',
      items: descartadoSchema
    },
    manutencao_preventiva_relacionada: {
      type: 'array',
      items: { type: 'string' }
    },
    proxima_inspecao_recomendada: { type: 'string' },
    resumo_para_cliente: { type: 'string' }
  },
  required: [
    'urgencia_geral',
    'pode_dirigir',
    'risco_principal',
    'observacoes_seguranca',
    'acoes_imediatas',
    'hipoteses',
    'resumo_para_cliente'
  ],
  additionalProperties: false
} as const;

export const refinamentoJsonSchema = {
  type: 'object',
  properties: {
    perguntas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          pergunta: { type: 'string' },
          tipo: {
            type: 'string',
            enum: ['multipla_escolha', 'sim_nao', 'escala']
          },
          objetivo: { type: 'string' },
          opcoes: {
            type: 'array',
            items: { type: 'string' }
          },
          ajuda: { type: 'string' }
        },
        required: ['id', 'pergunta', 'tipo', 'objetivo', 'opcoes'],
        additionalProperties: false
      }
    },
    raciocinio: { type: 'string' }
  },
  required: ['perguntas'],
  additionalProperties: false
} as const;
