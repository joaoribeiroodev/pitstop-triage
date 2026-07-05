import { DiagnosticoCdp } from '@models/cdp.model';

/** Detecta CDP gerado pelo fallback local (triagens antigas sem campo `diagnosticoFonte`). */
export function isDiagnosticoContingencia(d: DiagnosticoCdp): boolean {
  const risco = d.risco_principal.toLowerCase();
  return (
    risco.includes('contingência') ||
    risco.includes('contingencia') ||
    risco.includes('sem conexão com a ia') ||
    risco.includes('sem conexao com a ia') ||
    d.resumo_para_cliente.toLowerCase().includes('ia está indisponível') ||
    d.resumo_para_cliente.toLowerCase().includes('ia esta indisponivel')
  );
}
