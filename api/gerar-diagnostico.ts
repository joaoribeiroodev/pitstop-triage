import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_MODEL, applyCors, isTriagemValida, requireApiKey, requirePost, safeParse } from './_shared';

const faixaSchema = {
  type: Type.OBJECT,
  properties: {
    min: { type: Type.NUMBER },
    max: { type: Type.NUMBER }
  },
  required: ['min', 'max']
};

const componenteSchema = {
  type: Type.OBJECT,
  properties: {
    nome: { type: Type.STRING },
    prioridade: { type: Type.STRING, enum: ['alta', 'media', 'baixa'] },
    teste_recomendado: { type: Type.STRING }
  },
  required: ['nome', 'prioridade', 'teste_recomendado']
};

const hipoteseSchema = {
  type: Type.OBJECT,
  properties: {
    titulo: { type: Type.STRING },
    sistema_afetado: { type: Type.STRING },
    probabilidade: { type: Type.NUMBER },
    confianca: { type: Type.STRING, enum: ['baixa', 'media', 'alta'] },
    justificativa_tecnica: { type: Type.STRING },
    evidencias_usadas: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    componentes_a_verificar: {
      type: Type.ARRAY,
      items: componenteSchema
    },
    codigos_obd_possiveis: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
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
  ]
};

const descartadoSchema = {
  type: Type.OBJECT,
  properties: {
    titulo: { type: Type.STRING },
    motivo_descarte: { type: Type.STRING }
  },
  required: ['titulo', 'motivo_descarte']
};

const diagnosticoSchema = {
  type: Type.OBJECT,
  properties: {
    urgencia_geral: {
      type: Type.STRING,
      enum: ['baixa', 'media', 'alta', 'critica']
    },
    pode_dirigir: {
      type: Type.STRING,
      enum: ['sim_normal', 'sim_com_cautela', 'apenas_curtas_distancias', 'nao_dirigir']
    },
    risco_principal: { type: Type.STRING },
    observacoes_seguranca: { type: Type.STRING },
    acoes_imediatas: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    hipoteses: {
      type: Type.ARRAY,
      items: hipoteseSchema
    },
    diagnosticos_descartados: {
      type: Type.ARRAY,
      items: descartadoSchema
    },
    manutencao_preventiva_relacionada: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    proxima_inspecao_recomendada: { type: Type.STRING },
    resumo_para_cliente: { type: Type.STRING }
  },
  required: [
    'urgencia_geral',
    'pode_dirigir',
    'risco_principal',
    'observacoes_seguranca',
    'acoes_imediatas',
    'hipoteses',
    'resumo_para_cliente'
  ]
};

const SYSTEM_INSTRUCTION = `
Voce e um diagnostico automotivo senior (20+ anos de oficina e bancada), especialista em CDP (Codigo de Diagnostico Previo) para mecanicos brasileiros.
Sua missao: emitir um CDP estruturado, calibrado e acionavel a partir da triagem fornecida.

QUANTIDADES OBRIGATORIAS:
- hipoteses: 1 a 4 (ordenadas pela mais provavel).
- acoes_imediatas: 3 a 5 itens.
- evidencias_usadas (por hipotese): 2 a 4 itens citando sintomas/respostas concretos.
- componentes_a_verificar (por hipotese): 2 a 6 itens.
- codigos_obd_possiveis (por hipotese): opcional, ate 6. NAO inventar.
- diagnosticos_descartados: 1 a 4 itens (recomendado).
- manutencao_preventiva_relacionada: 2 a 5 itens (opcional).

REGRAS DE OURO:
1. CALIBRACAO: probabilidade reflete a chance real da hipotese ser a causa; confianca reflete a forca do conjunto de evidencias (mesmo uma hipotese de 70% pode ter confianca baixa se as evidencias forem fracas).
2. EVIDENCIAS: para CADA hipotese, liste 2-4 evidencias do estado da triagem que apontam para ela (cite o sintoma/resposta concreto).
3. SEGURANCA PRIMEIRO: classifique urgencia_geral e pode_dirigir considerando risco a vida e a terceiros. Se houver duvida razoavel sobre freios, direcao, superaquecimento severo ou pane eletrica em sistema critico, escalone para "alta" ou "critica" e "apenas_curtas_distancias" ou "nao_dirigir".
4. CUSTO E TEMPO: estimativas em REAIS brasileiros (mao de obra de oficina independente em 2024-2026, peca padrao de mercado), faixa min-max. Se for um servico simples, max ate 3x o min. Para reparos majors, indique a faixa de mercado.
5. COMPONENTES: nome especifico (ex.: "Bobina de ignicao do cilindro 3"), prioridade ("alta" = teste primeiro), teste_recomendado curto e pratico (ex.: "scanner OBD-II + leitura de misfire counter").
6. OBD: NUNCA invente codigos. So preencha codigos_obd_possiveis se o sintoma sugerir codigo conhecido (ex.: "Luz de injecao acesa" + "motor falhando" => P0300-P0306 sao plausiveis para misfire).
7. DESCARTADOS: liste ate 4 diagnosticos DIFERENCIAIS que o mecanico poderia pensar mas que voce DESCARTOU, com motivo curto. Isso evita perda de tempo.
8. MANUTENCAO PREVENTIVA: liste itens correlatos que valem a pena verificar no mesmo box (ex.: se for falha de igniçao, sugira trocar filtro de ar se velho).
9. ACOES IMEDIATAS: 3-5 itens, primeira pessoa do plural ("Realizar leitura de codigos OBD", "Inspecionar visualmente velas e bobinas"). NAO inclua orcamento aqui, so passos tecnicos.
10. RESUMO PARA CLIENTE: 1-2 frases em linguagem leiga, sem jargao, explicando o que provavelmente esta acontecendo e o nivel de urgencia.

ANTI-PADROES (NUNCA FACA):
- Listar como hipotese principal algo que so apareceria se houvesse muito mais evidencia.
- Dar probabilidade alta a hipoteses sem evidencia direta nos sintomas.
- Sugerir trocar pecas como primeira acao (sempre TESTE antes).
- Inventar codigo OBD especifico (P0420, etc.) se nao foi reportado no scanner.
- Usar termos vagos como "verificar o motor" — seja especifico.

PORTUGUES DO BRASIL. Tecnico mas direto.
`.trim();

const FEW_SHOT_EXAMPLE = `
EXEMPLO de boa resposta (NAO copie literalmente, use como referencia de estilo e profundidade):

Input: Gol 1.0 2020, zona "motor", sintomas: ["Motor falhando ou tremendo parado", "Luz de injecao acesa", "Marcha lenta instavel"], refinamento: {"quando_piora": "Com motor frio", "perdeu_potencia": "Sim, leve"}

Resposta esperada (resumida):
{
  "urgencia_geral": "media",
  "pode_dirigir": "sim_com_cautela",
  "risco_principal": "Risco de danificar o catalisador por combustao incompleta prolongada.",
  "resumo_para_cliente": "Provavelmente velas ou bobinas de ignicao desgastadas. Da pra rodar curto, mas evite viagens longas ate trocar.",
  "hipoteses": [
    {
      "titulo": "Falha de ignicao por velas/bobinas desgastadas",
      "probabilidade": 60,
      "confianca": "alta",
      "evidencias_usadas": ["Motor tremendo parado", "Piora com motor frio", "Marcha lenta instavel", "Luz de injecao"],
      "componentes_a_verificar": [
        {"nome": "Velas de ignicao (jogo completo)", "prioridade": "alta", "teste_recomendado": "Inspecao visual + folga + teste de centelha"},
        {"nome": "Bobinas de ignicao individuais", "prioridade": "alta", "teste_recomendado": "Scanner: leitura de misfire counter por cilindro"}
      ],
      "codigos_obd_possiveis": ["P0300", "P0301", "P0302", "P0303"],
      "custo_estimado_brl": {"min": 180, "max": 650},
      "tempo_reparo_horas": {"min": 0.5, "max": 1.5}
    }
  ],
  "diagnosticos_descartados": [
    {"titulo": "Embreagem patinando", "motivo_descarte": "Sintoma ocorre com carro parado — embreagem so se manifestaria em movimento."}
  ]
}
`.trim();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (!requirePost(req, res)) return;
  const apiKey = requireApiKey(res);
  if (!apiKey) return;

  if (!isTriagemValida(req.body)) {
    res.status(400).json({ error: 'Triagem incompleta: veiculo, zona e sintomas sao obrigatorios' });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
Triagem consolidada (use TODAS as informacoes, incluindo "observacoes" quando presente):

${JSON.stringify(req.body ?? {}, null, 2)}

${FEW_SHOT_EXAMPLE}

Gere AGORA o CDP completo seguindo rigorosamente o schema.
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: diagnosticoSchema
      }
    });

    res.status(200).json(safeParse(response.text, {}));
  } catch (error) {
    res.status(500).json({ error: 'Falha ao gerar diagnostico', detail: String(error) });
  }
}
