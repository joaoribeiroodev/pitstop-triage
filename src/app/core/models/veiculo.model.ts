export type VeiculoOrigem = 'fipe' | 'manual' | '';

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
}
