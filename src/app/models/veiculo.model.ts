export type VeiculoOrigem = 'fipe' | 'manual' | '';

export type TipoTransmissao =
  | 'manual'
  | 'automatico_conversor'
  | 'automatico_embreagem'
  | 'cvt'
  | 'desconhecido';

export type TipoTransmissaoOrigem = 'inferido' | 'usuario';

export interface Veiculo {
  marca: string;
  modelo: string;
  ano: string;
  codigoFipe: string;
  origem: VeiculoOrigem;
  observacoes?: string;
  fipeMarcaCodigo?: string;
  fipeModeloCodigo?: string;
  fipeAnoCodigo?: string;
  tipoTransmissao?: TipoTransmissao;
  tipoTransmissaoOrigem?: TipoTransmissaoOrigem;
}
