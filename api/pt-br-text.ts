import {
  corrigirOrtografiaPtBr,
  corrigirValorProfundo,
  normalizarTextoPdf
} from '../shared/pt-br-ortografia';

export { corrigirOrtografiaPtBr, normalizarTextoPdf, corrigirValorProfundo };

export function corrigirDiagnosticoCdp<T extends Record<string, unknown>>(diagnostico: T): T {
  return corrigirValorProfundo(diagnostico) as T;
}

export function corrigirRefinamentoResposta<T extends Record<string, unknown>>(resposta: T): T {
  return corrigirValorProfundo(resposta) as T;
}
