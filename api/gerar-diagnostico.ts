import type { VercelRequest, VercelResponse } from '@vercel/node';
import { diagnosticoJsonSchema } from './ai-schemas';
import { buildRespostasDetalhadas, isDiagnosticoCdpValid } from './cdp-validation';
import { completeStructuredJson } from './openai';
import { applyCors, isTriagemValida, requireApiKey, requirePost, safeParse } from './_shared';
import { corrigirDiagnosticoCdp } from '@utils/pt-br-text.util';

const SYSTEM_INSTRUCTION = `
Você é um diagnóstico automotivo sênior (20+ anos de oficina e bancada), especialista em CDP (Código de Diagnóstico Prévio) para mecânicos brasileiros.
Sua missão: emitir um CDP estruturado, calibrado e acionável a partir da triagem fornecida.

ORTOGRAFIA OBRIGATÓRIA:
- Use português do Brasil CORRETO com todos os acentos, cedilhas e til (ex.: ignição, até, não, manutenção, inspeção, provável, diagnóstico, condução).
- Nunca omita acentuação. Nunca use "nao", "voce", "ignicao", "inspecao" sem acento.

QUANTIDADES OBRIGATÓRIAS:
- hipoteses: 1 a 4 (ordenadas pela mais provável).
- acoes_imediatas: 3 a 5 itens.
- evidencias_usadas (por hipótese): 2 a 4 itens citando sintomas/respostas concretos.
- componentes_a_verificar (por hipótese): 2 a 6 itens.
- codigos_obd_possiveis (por hipótese): opcional, até 6. NÃO inventar.
- diagnosticos_descartados: 1 a 4 itens (recomendado).
- manutencao_preventiva_relacionada: 2 a 5 itens (opcional).

REGRAS DE OURO:
1. CALIBRAÇÃO: probabilidade reflete a chance real da hipótese ser a causa; confiança reflete a força do conjunto de evidências.
2. EVIDÊNCIAS: para CADA hipótese, liste 2-4 evidências do estado da triagem (cite o sintoma/resposta concreto).
3. SEGURANÇA PRIMEIRO: classifique urgencia_geral e pode_dirigir considerando risco à vida e a terceiros.
4. CUSTO E TEMPO: estimativas em REAIS brasileiros, faixa min-max realista.
5. COMPONENTES: nome específico, prioridade e teste_recomendado prático.
6. OBD: NUNCA invente códigos. Só preencha se plausível pelos sintomas.
7. DESCARTADOS: diagnósticos diferenciais descartados com motivo curto.
8. MANUTENÇÃO PREVENTIVA: itens correlatos para verificar no mesmo box.
9. AÇÕES IMEDIATAS: 3-5 passos técnicos claros, sem orçamento.
10. RESUMO PARA CLIENTE (resumo_para_cliente): texto rico para o DONO DO CARRO (não para o mecânico), em 3 a 5 frases curtas (~400-700 caracteres), SEM jargão (evite bobina, misfire, catalisador sem explicar). Obrigatório incluir, em linguagem simples:
   a) O que provavelmente está acontecendo (causa mais provável);
   b) Se pode dirigir e com qual cuidado (coerente com pode_dirigir);
   c) Quão urgente é na prática (pode esperar, agendar esta semana, ir logo);
   d) Uma orientação concreta do que fazer agora (ex.: evitar viagem longa, não forçar motor, levar na oficina para scanner).
   Tom calmo, útil e honesto — informe sem alarmismo nem minimizar risco real.

ANTI-PADRÕES (NUNCA FAÇA):
- Hipótese principal sem evidência nos sintomas.
- Inventar código OBD específico sem base.
- Termos vagos como "verificar o motor".
- Texto sem acentuação ou com abreviações informais ("pra", "ta", "vc").

Português do Brasil. Técnico mas direto no anexo; leigo e claro no resumo_para_cliente.
`.trim();

const FEW_SHOT_EXAMPLE = `
EXEMPLO de boa resposta (NÃO copie literalmente, use como referência de estilo e profundidade):

Input: Gol 1.0 2020, zona "motor", sintomas: ["Motor falhando ou tremendo parado", "Luz de injeção acesa", "Marcha lenta instável"], refinamento: {"quando_piora": "Com motor frio", "perdeu_potencia": "Sim, leve"}

Resposta esperada (resumida):
{
  "urgencia_geral": "media",
  "pode_dirigir": "sim_com_cautela",
  "risco_principal": "Risco de danificar o catalisador por combustão incompleta prolongada.",
  "resumo_para_cliente": "Pelo que você descreveu, o carro provavelmente está falhando na ignição — algo como velas ou bobinas de faísca desgastadas. Dá para usar em trajetos curtos e urbanos, mas evite estrada e subidas pesadas até revisar. Não é emergência hoje, mas agende uma oficina nos próximos dias para scanner e troca das peças de ignição antes que piore.",
  "hipoteses": [
    {
      "titulo": "Falha de ignição por velas/bobinas desgastadas",
      "probabilidade": 60,
      "confianca": "alta",
      "evidencias_usadas": ["Motor tremendo parado", "Piora com motor frio", "Marcha lenta instável", "Luz de injeção"],
      "componentes_a_verificar": [
        {"nome": "Velas de ignição (jogo completo)", "prioridade": "alta", "teste_recomendado": "Inspeção visual + folga + teste de centelha"},
        {"nome": "Bobinas de ignição individuais", "prioridade": "alta", "teste_recomendado": "Scanner: leitura de misfire counter por cilindro"}
      ],
      "codigos_obd_possiveis": ["P0300", "P0301", "P0302", "P0303"],
      "custo_estimado_brl": {"min": 180, "max": 650},
      "tempo_reparo_horas": {"min": 0.5, "max": 1.5}
    }
  ],
  "diagnosticos_descartados": [
    {"titulo": "Embreagem patinando", "motivo_descarte": "Sintoma ocorre com carro parado — embreagem só se manifestaria em movimento."}
  ]
}
`.trim();

interface GerarBody {
  veiculo?: Record<string, unknown>;
  zonaSelecionada?: string;
  sintomas?: string[];
  respostasRefinamento?: Record<string, string>;
  respostasDetalhadas?: { id: string; pergunta: string; resposta: string }[];
  perguntasRefinamento?: Record<string, string>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (!requirePost(req, res)) return;
  const apiKey = requireApiKey(res);
  if (!apiKey) return;

  if (!isTriagemValida(req.body)) {
    res.status(400).json({ error: 'Triagem incompleta: veiculo, zona e sintomas sao obrigatorios' });
    return;
  }

  const body = (req.body ?? {}) as GerarBody;
  const respostasDetalhadas =
    body.respostasDetalhadas ??
    buildRespostasDetalhadas(body.respostasRefinamento, body.perguntasRefinamento);

  const triagemParaPrompt = {
    veiculo: body.veiculo,
    zona: body.zonaSelecionada,
    sintomas: body.sintomas,
    respostas_refinamento: respostasDetalhadas
  };

  const prompt = `
Triagem consolidada (use TODAS as informacoes, incluindo "observacoes" quando presente):

${JSON.stringify(triagemParaPrompt, null, 2)}

${FEW_SHOT_EXAMPLE}

Gere AGORA o CDP completo seguindo rigorosamente o schema JSON.
`.trim();

  try {
    const raw = await completeStructuredJson({
      apiKey,
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      schemaName: 'diagnostico_cdp',
      schema: diagnosticoJsonSchema as unknown as Record<string, unknown>,
      temperature: 0.2
    });

    const parsed = safeParse(raw, null as Record<string, unknown> | null);
    if (!isDiagnosticoCdpValid(parsed)) {
      res.status(502).json({ error: 'IA retornou CDP incompleto ou invalido' });
      return;
    }

    res.status(200).json(corrigirDiagnosticoCdp(parsed));
  } catch (error) {
    res.status(500).json({ error: 'Falha ao gerar diagnostico', detail: String(error) });
  }
}
