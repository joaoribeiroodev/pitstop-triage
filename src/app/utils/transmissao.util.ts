import { TipoTransmissao, TipoTransmissaoOrigem } from '@models/veiculo.model';

const PADRAO_CVT = /\bcvt\b|continuamente\s+vari[aá]vel|variable/i;
const PADRAO_MANUAL = /\bmec\b|\bmanual\b/i;
const PADRAO_AUTOMATICO =
  /\baut\b|aut\.|autom[aá]tico|autom[aá]tica|\bat\d+\b|tiptronic|dsg|s-?tronic|dct|powershift|dualogic|easytronic/i;

export const OPCOES_TIPO_TRANSMISSAO: { valor: TipoTransmissao; label: string }[] = [
  { valor: 'automatico_conversor', label: 'Automático tradicional' },
  { valor: 'automatico_embreagem', label: 'Automático automatizado/dupla embreagem (DCT)' },
  { valor: 'cvt', label: 'CVT' },
  { valor: 'manual', label: 'Manual' },
  { valor: 'desconhecido', label: 'Não sei' }
];

export function inferirTipoTransmissao(modeloTexto: string): TipoTransmissao {
  const texto = modeloTexto.trim();
  if (!texto) return 'desconhecido';
  if (PADRAO_CVT.test(texto)) return 'cvt';
  if (PADRAO_MANUAL.test(texto)) return 'manual';
  if (PADRAO_AUTOMATICO.test(texto)) return 'automatico_conversor';
  return 'desconhecido';
}

export function labelTipoTransmissao(tipo?: TipoTransmissao): string {
  const match = OPCOES_TIPO_TRANSMISSAO.find((o) => o.valor === (tipo ?? 'desconhecido'));
  return match?.label ?? 'Não sei';
}

export function resolverOrigemTransmissao(
  selecionado: TipoTransmissao,
  inferido: TipoTransmissao | null
): TipoTransmissaoOrigem | undefined {
  if (inferido !== null && selecionado === inferido) return 'inferido';
  if (selecionado === 'desconhecido' && inferido === null) return undefined;
  return 'usuario';
}
