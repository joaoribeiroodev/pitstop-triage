import { DiagnosticoCdp } from '@models/cdp.model';
import { RefinamentoResponse } from '@models/refinamento.model';
import { corrigirOrtografiaPtBr, corrigirValorProfundo, normalizarTextoPdf } from './pt-br-ortografia';

export { corrigirOrtografiaPtBr, corrigirValorProfundo, normalizarTextoPdf };

export function corrigirDiagnosticoCdp(diagnostico: DiagnosticoCdp): DiagnosticoCdp;
export function corrigirDiagnosticoCdp<T extends Record<string, unknown>>(diagnostico: T): T;
export function corrigirDiagnosticoCdp<T extends Record<string, unknown>>(diagnostico: T): T {
  return corrigirValorProfundo(diagnostico) as T;
}

export function corrigirRefinamentoResposta(resposta: RefinamentoResponse): RefinamentoResponse;
export function corrigirRefinamentoResposta<T extends Record<string, unknown>>(resposta: T): T;
export function corrigirRefinamentoResposta<T extends Record<string, unknown>>(resposta: T): T {
  return corrigirValorProfundo(resposta) as T;
}
