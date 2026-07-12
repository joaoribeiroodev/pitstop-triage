import { corrigirOrtografiaPtBr, corrigirValorProfundo, normalizarTextoPdf } from './pt-br-ortografia';
export { corrigirOrtografiaPtBr, corrigirValorProfundo, normalizarTextoPdf };
export function corrigirDiagnosticoCdp(diagnostico) {
    return corrigirValorProfundo(diagnostico);
}
export function corrigirRefinamentoResposta(resposta) {
    return corrigirValorProfundo(resposta);
}
