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

type TipoTransmissaoApi = 'manual' | 'automatico_conversor' | 'automatico_embreagem' | 'cvt' | 'desconhecido';

const TERMOS_EMBREAGEM_PEDAL = [
  'cilindro mestre da embreagem',
  'cilindro mestre de embreagem',
  'cilindro escravo da embreagem',
  'cilindro escravo de embreagem',
  'platô de embreagem',
  'plato de embreagem',
  'disco de embreagem',
  'kit de embreagem',
  'pedal de embreagem'
];

const TERMOS_CVT = [
  'cvt',
  'transmissão continuamente variável',
  'transmissao continuamente variavel',
  'corrente cvt',
  'polia variável',
  'polia variavel',
  'variator',
  'continuously variable'
];

function normalizarTexto(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function textoContemTermo(texto: string, termos: string[]): boolean {
  const norm = normalizarTexto(texto);
  return termos.some((termo) => norm.includes(normalizarTexto(termo)));
}

function coletarTextosHipotese(hipotese: Record<string, unknown>): string[] {
  const partes: string[] = [];
  for (const key of ['titulo', 'justificativa_tecnica', 'sistema_afetado'] as const) {
    const val = hipotese[key];
    if (typeof val === 'string') partes.push(val);
  }
  const componentes = hipotese['componentes_a_verificar'];
  if (Array.isArray(componentes)) {
    for (const comp of componentes) {
      if (comp && typeof comp === 'object' && typeof (comp as Record<string, unknown>)['nome'] === 'string') {
        partes.push((comp as Record<string, unknown>)['nome'] as string);
      }
    }
  }
  return partes;
}

function hipoteseIncompativelComTransmissao(
  hipotese: Record<string, unknown>,
  tipo: TipoTransmissaoApi
): boolean {
  const texto = coletarTextosHipotese(hipotese).join(' ');
  if (tipo === 'automatico_conversor' && textoContemTermo(texto, TERMOS_EMBREAGEM_PEDAL)) {
    return true;
  }
  if (tipo !== 'cvt' && textoContemTermo(texto, TERMOS_CVT)) {
    return true;
  }
  return false;
}

export interface SanitizacaoCdpResult {
  cdp: Record<string, unknown>;
  rejeitado: boolean;
  motivo?: string;
}

/** Remove hipóteses incompatíveis com o tipo de transmissão informado. */
export function sanitizarCdpPorTransmissao(
  cdp: Record<string, unknown>,
  tipoTransmissao?: string
): SanitizacaoCdpResult {
  const tipo = (tipoTransmissao ?? 'desconhecido') as TipoTransmissaoApi;
  if (tipo === 'desconhecido' || tipo === 'manual' || tipo === 'automatico_embreagem') {
    return { cdp, rejeitado: false };
  }

  const hipotesesRaw = cdp['hipoteses'];
  if (!Array.isArray(hipotesesRaw)) return { cdp, rejeitado: false };

  const removidas: string[] = [];
  const hipotesesFiltradas = hipotesesRaw.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const h = item as Record<string, unknown>;
    if (hipoteseIncompativelComTransmissao(h, tipo)) {
      removidas.push(typeof h['titulo'] === 'string' ? h['titulo'] : '(sem título)');
      return false;
    }
    return true;
  });

  if (removidas.length > 0) {
    console.warn(
      `[cdp-validation] Hipóteses removidas por incompatibilidade com transmissão "${tipo}":`,
      removidas
    );
  }

  if (hipotesesFiltradas.length === 0) {
    return {
      cdp,
      rejeitado: true,
      motivo: `Todas as hipóteses eram incompatíveis com transmissão "${tipo}"`
    };
  }

  return {
    cdp: { ...cdp, hipoteses: hipotesesFiltradas },
    rejeitado: false
  };
}

export function buildInstrucaoTransmissao(veiculo: Record<string, unknown> | undefined): string {
  const tipo = veiculo?.['tipoTransmissao'] ?? 'desconhecido';
  const origem = veiculo?.['tipoTransmissaoOrigem'] ?? 'nao_informada';

  return `
RESTRICOES DE TRANSMISSAO:
O veiculo tem tipo de transmissao: ${tipo} (origem: ${origem}).
- NAO gere hipoteses nem itens de verificacao citando componentes de embreagem com pedal (disco, plato, cilindro mestre/escravo, kit de embreagem) se o tipo for "automatico_conversor".
- NAO gere hipotese de CVT (corrente CVT, polias variaveis, transmissao continuamente variavel) se o tipo NAO for "cvt".
- Se tipoTransmissaoOrigem for "inferido", trate como provavel mas nao confirmado.
- Se tipoTransmissao for "desconhecido", voce pode considerar multiplas possibilidades, mas inclua nas acoes_imediatas a recomendacao de confirmar o tipo de cambio na oficina.
`.trim();
}
