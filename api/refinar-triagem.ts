import type { VercelRequest, VercelResponse } from '@vercel/node';
import { refinamentoJsonSchema } from './ai-schemas';
import { buildRespostasDetalhadas } from './cdp-validation';
import { completeStructuredJson } from './openai';
import { applyCors, isTriagemValida, requireApiKey, requirePost, safeParse } from './_shared';
import { corrigirRefinamentoResposta } from '@utils/pt-br-text.util';
import { normalizarRefinamentoResponse } from '@utils/refinamento.util';

const SYSTEM_INSTRUCTION = `
Você é um consultor técnico automotivo sênior, especialista em primeira escuta de cliente em oficina de bairro brasileira.
Sua missão: gerar perguntas de refinamento que DISCRIMINEM entre hipóteses técnicas concorrentes, para que o mecânico chegue à bancada já com 70%+ de certeza sobre o que abrir.

ORTOGRAFIA OBRIGATÓRIA:
- Use português do Brasil CORRETO com todos os acentos (ex.: não, até, condição, frequência, inspeção).
- Nunca omita acentuação. Nunca use abreviações informais ("pra", "ta", "vc").

PRINCÍPIOS DE BOA PERGUNTA:
1. Cada pergunta deve eliminar pelo menos UMA hipótese plausível se respondida em um sentido.
2. Linguagem simples para leigo, mas tecnicamente útil.
3. Não repita o que já está nos sintomas — agregue dimensões novas (tempo, temperatura, condição de uso, intensidade, contexto sensorial).
4. Cada opção deve ser mutuamente exclusiva e curta (máx. 10 palavras).
5. Prefira respostas observáveis pelo motorista, não inferências técnicas.

TIPOS DE PERGUNTA (use o mais adequado):
- "multipla_escolha": 3-4 opções, quando há dimensões discretas (frequência, condição, local).
- "sim_nao": 2 opções ("Sim" / "Não"), para confirmação binária.
- "escala": 4-5 opções ordenadas (ex.: "Raramente / Às vezes / Frequentemente / Sempre").

QUANTIDADE:
- Rodada 1: 2 a 3 perguntas (cobrindo as variáveis mais discriminantes).
- Rodada 2 (opcional, se "rodada": 2 no input): mais 2 perguntas aprofundando o que ficou ambíguo.

IMPORTANTE:
- Cada pergunta tem um "id" curto (ex.: "q_temp", "q_freq", "q_ruido_tipo").
- Cada pergunta tem um "objetivo" explicando o que ela está tentando discriminar.
- Campo opcional "ajuda" pode dar exemplo (ex.: "Ex.: chiado agudo vs ronco grave").
`.trim();

interface RefinarBody {
  veiculo?: Record<string, unknown>;
  zonaSelecionada?: string;
  sintomas?: string[];
  respostasRefinamento?: Record<string, string>;
  respostasDetalhadas?: { id: string; pergunta: string; resposta: string }[];
  perguntasRefinamento?: Record<string, string>;
  rodada?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (!requirePost(req, res)) return;
  const apiKey = requireApiKey(res);
  if (!apiKey) return;

  const body = (req.body ?? {}) as RefinarBody;
  if (!isTriagemValida(body)) {
    res.status(400).json({ error: 'Triagem incompleta: veiculo, zona e sintomas sao obrigatorios' });
    return;
  }

  const rodada = body.rodada ?? 1;
  const respostasDetalhadas =
    body.respostasDetalhadas ??
    buildRespostasDetalhadas(body.respostasRefinamento, body.perguntasRefinamento);

  const prompt = `
Rodada de perguntas: ${rodada}
${rodada > 1 ? 'IMPORTANTE: gere perguntas COMPLEMENTARES, aprofundando ambiguidades da rodada anterior. NAO repita as ja respondidas.' : 'Gere as perguntas iniciais.'}

Estado coletado da triagem (JSON):
${JSON.stringify(
  {
    veiculo: body.veiculo,
    zona: body.zonaSelecionada,
    sintomas: body.sintomas,
    respostas_anteriores: respostasDetalhadas
  },
  null,
  2
)}
`.trim();

  try {
    const raw = await completeStructuredJson({
      apiKey,
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      schemaName: 'refinamento_triagem',
      schema: refinamentoJsonSchema as unknown as Record<string, unknown>,
      temperature: 0.35,
      maxTokens: 1536
    });

    const parsed = safeParse(raw, { perguntas: [] as unknown[] });
    if (!Array.isArray(parsed.perguntas) || parsed.perguntas.length === 0) {
      res.status(502).json({ error: 'IA retornou resposta vazia ou invalida' });
      return;
    }

    const normalizado = normalizarRefinamentoResponse(
      corrigirRefinamentoResposta(parsed) as { perguntas?: unknown[]; raciocinio?: string },
      rodada
    );
    if (normalizado.perguntas.length === 0) {
      res.status(502).json({ error: 'IA retornou perguntas sem opcoes validas' });
      return;
    }

    res.status(200).json(normalizado);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao gerar perguntas', detail: String(error) });
  }
}
