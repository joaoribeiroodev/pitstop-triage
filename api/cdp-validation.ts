/** Valida estrutura mínima do CDP antes de devolver ao frontend. */
export function isDiagnosticoCdpValid(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d['resumo_para_cliente'] === 'string' &&
    Boolean((d['resumo_para_cliente'] as string).trim()) &&
    typeof d['risco_principal'] === 'string' &&
    Array.isArray(d['hipoteses']) &&
    (d['hipoteses'] as unknown[]).length > 0 &&
    Array.isArray(d['acoes_imediatas']) &&
    (d['acoes_imediatas'] as unknown[]).length > 0
  );
}

export interface RespostaRefinamentoDetalhada {
  id: string;
  pergunta: string;
  resposta: string;
}

export function buildRespostasDetalhadas(
  respostas: Record<string, string> | undefined,
  perguntas: Record<string, string> | undefined
): RespostaRefinamentoDetalhada[] {
  if (!respostas) return [];
  return Object.entries(respostas).map(([id, resposta]) => ({
    id,
    pergunta: perguntas?.[id]?.trim() || id,
    resposta
  }));
}
