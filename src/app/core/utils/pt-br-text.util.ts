import { DiagnosticoCdp } from '@core/models/cdp.model';
import { RefinamentoResponse } from '@core/models/refinamento.model';
import {
  corrigirOrtografiaPtBr,
  corrigirValorProfundo,
  normalizarTextoPdf
} from '../../../../shared/pt-br-ortografia';

export { corrigirOrtografiaPtBr, normalizarTextoPdf };

export function corrigirDiagnosticoCdp(diagnostico: DiagnosticoCdp): DiagnosticoCdp {
  return corrigirValorProfundo(diagnostico) as DiagnosticoCdp;
}

export function corrigirRefinamentoResposta(resposta: RefinamentoResponse): RefinamentoResponse {
  return corrigirValorProfundo(resposta) as RefinamentoResponse;
}
