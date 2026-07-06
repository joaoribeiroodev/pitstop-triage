import { PerguntaRefinamento, PerguntaRefinamentoNaSessao, TipoPergunta } from '@models/refinamento.model';

function extrairOpcoes(raw: Record<string, unknown>): string[] {
  const candidato = raw['opcoes'] ?? raw['alternativas'] ?? raw['options'];
  if (Array.isArray(candidato)) {
    return candidato.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof candidato === 'string' && candidato.trim()) {
    return candidato
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizarTipoPergunta(tipo: unknown): TipoPergunta {
  const valor = String(tipo ?? '')
    .toLowerCase()
    .replace(/[\s-]/g, '_');
  if (valor === 'sim_nao' || valor === 'simnao' || valor === 'boolean') return 'sim_nao';
  if (valor === 'escala' || valor === 'scale') return 'escala';
  return 'multipla_escolha';
}

function opcoesPadrao(tipo: TipoPergunta): string[] {
  if (tipo === 'sim_nao') return ['Sim', 'Não'];
  if (tipo === 'escala') return ['Raramente', 'Às vezes', 'Frequentemente', 'Sempre'];
  return ['Sim', 'Não', 'Às vezes', 'Não sei'];
}

/** Garante estrutura completa para renderizar botões de resposta na UI. */
export function normalizarPerguntaRefinamento(
  raw: Partial<PerguntaRefinamentoNaSessao> & Record<string, unknown>,
  rodadaPadrao = 1
): PerguntaRefinamentoNaSessao | null {
  const id = String(raw.id ?? '').trim();
  const pergunta = String(raw.pergunta ?? '').trim();
  if (!id || !pergunta) return null;

  const tipo = normalizarTipoPergunta(raw.tipo);
  let opcoes = extrairOpcoes(raw);
  if (opcoes.length === 0) {
    opcoes = opcoesPadrao(tipo);
  }

  const objetivo = String(raw.objetivo ?? '').trim() || 'Refinar o diagnóstico com mais precisão.';
  const ajuda = raw.ajuda ? String(raw.ajuda).trim() : undefined;

  return {
    id,
    pergunta,
    tipo,
    objetivo,
    opcoes,
    ajuda: ajuda || undefined,
    rodada: typeof raw.rodada === 'number' && raw.rodada > 0 ? raw.rodada : rodadaPadrao
  };
}

export function normalizarPerguntasRefinamento(
  perguntas: unknown[],
  rodadaPadrao = 1
): PerguntaRefinamentoNaSessao[] {
  return perguntas
    .map((item) =>
      normalizarPerguntaRefinamento(
        (item && typeof item === 'object' ? item : {}) as Partial<PerguntaRefinamentoNaSessao> &
          Record<string, unknown>,
        rodadaPadrao
      )
    )
    .filter((item): item is PerguntaRefinamentoNaSessao => item !== null);
}

export function normalizarRefinamentoResponse(
  resposta: { perguntas?: unknown[]; raciocinio?: string },
  rodadaPadrao = 1
): { perguntas: PerguntaRefinamento[]; raciocinio?: string } {
  const perguntas = normalizarPerguntasRefinamento(resposta.perguntas ?? [], rodadaPadrao).map(
    ({ rodada: _rodada, ...pergunta }) => pergunta
  );
  return {
    perguntas,
    raciocinio: resposta.raciocinio
  };
}
