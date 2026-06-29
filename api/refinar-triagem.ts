import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_MODEL, applyCors, isTriagemValida, requireApiKey, requirePost, safeParse } from './_shared';

const perguntaSchema = {
  type: Type.OBJECT,
  properties: {
    perguntas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          pergunta: { type: Type.STRING },
          tipo: {
            type: Type.STRING,
            enum: ['multipla_escolha', 'sim_nao', 'escala']
          },
          objetivo: { type: Type.STRING },
          opcoes: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          ajuda: { type: Type.STRING }
        },
        required: ['id', 'pergunta', 'tipo', 'objetivo', 'opcoes']
      }
    },
    raciocinio: { type: Type.STRING }
  },
  required: ['perguntas']
};

const SYSTEM_INSTRUCTION = `
Voce e um consultor tecnico automotivo senior, especialista em primeira escuta de cliente em oficina de bairro brasileira.
Sua missao: gerar perguntas de refinamento que DISCRIMINEM entre hipoteses tecnicas concorrentes, para que o mecanico chegue ao banco de trabalho ja com 70%+ de certeza sobre o que abrir.

PRINCIPIOS DE BOA PERGUNTA:
1. Cada pergunta deve eliminar pelo menos UMA hipotese plausivel se respondida em um sentido.
2. Linguagem simples para leigo, mas tecnicamente util.
3. Nao repita o que ja esta nos sintomas — agregue dimensoes novas (tempo, temperatura, condicao de uso, intensidade, contexto sensorial).
4. Cada opcao deve ser mutuamente exclusiva e curta (max 10 palavras).
5. Prefira respostas observaveis pelo motorista, nao inferencias tecnicas.

TIPOS DE PERGUNTA (use o mais adequado):
- "multipla_escolha": 3-4 opcoes, quando ha dimensoes discretas (frequencia, condicao, local).
- "sim_nao": 2 opcoes ("Sim" / "Nao"), para confirmacao binaria.
- "escala": 4-5 opcoes ordenadas (ex.: "Raramente / Às vezes / Frequentemente / Sempre"; ou "Muito leve / Leve / Forte / Muito forte").

QUANTIDADE:
- Rodada 1: 2 a 3 perguntas (cobrindo as variaveis mais discriminantes).
- Rodada 2 (opcional, ativada se "rodada": 2 no input): mais 2 perguntas APROFUNDANDO o que ficou ambiguo nas respostas da rodada 1.

DIMENSOES TIPICAS A EXPLORAR (escolha as relevantes para a zona):
- Temperatura/momento: frio, quente, com tempo de rodagem.
- Condicao: parado, em movimento, ao acelerar, ao frear, em curva, em subida/descida.
- Intensidade/progressao: piorando? estavel? intermitente?
- Sensorial: ruido (agudo/grave/metalico), cheiro, vibracao, luz no painel, fumaca.
- Historico: ultima manutencao, troca de pecas, panes recentes.

IMPORTANTE:
- Cada pergunta tem um "id" curto (ex.: "q_temp", "q_freq", "q_ruido_tipo").
- Cada pergunta tem um "objetivo" explicando o que ela esta tentando discriminar (sera mostrado ao usuario).
- Campo opcional "ajuda" pode dar exemplo (ex.: "Ex.: chiado de gato vs ronco de moto").
- Use SEMPRE portugues do Brasil.
`.trim();

interface RefinarBody {
  veiculo?: Record<string, unknown>;
  zonaSelecionada?: string;
  sintomas?: string[];
  respostasRefinamento?: Record<string, string>;
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
  const ja_respondidas = body.respostasRefinamento ?? {};

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
Rodada de perguntas: ${rodada}
${rodada > 1 ? 'IMPORTANTE: gere perguntas COMPLEMENTARES, aprofundando ambiguidades da rodada anterior. NAO repita as ja respondidas.' : 'Gere as perguntas iniciais.'}

Estado coletado da triagem (JSON):
${JSON.stringify(
  {
    veiculo: body.veiculo,
    zona: body.zonaSelecionada,
    sintomas: body.sintomas,
    respostas_anteriores: ja_respondidas
  },
  null,
  2
)}
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.35,
        maxOutputTokens: 1536,
        responseMimeType: 'application/json',
        responseSchema: perguntaSchema
      }
    });

    const parsed = safeParse(response.text, { perguntas: [] as unknown[] });
    if (!Array.isArray(parsed.perguntas) || parsed.perguntas.length === 0) {
      res.status(502).json({ error: 'IA retornou resposta vazia ou invalida' });
      return;
    }

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao gerar perguntas', detail: String(error) });
  }
}
