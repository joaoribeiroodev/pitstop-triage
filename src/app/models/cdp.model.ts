export type UrgenciaGeral = 'baixa' | 'media' | 'alta' | 'critica';
export type PodeDirigir = 'sim_normal' | 'sim_com_cautela' | 'apenas_curtas_distancias' | 'nao_dirigir';
export type Prioridade = 'alta' | 'media' | 'baixa';
export type Confianca = 'baixa' | 'media' | 'alta';

export interface Faixa {
  min: number;
  max: number;
}

export interface ComponenteVerificar {
  nome: string;
  prioridade: Prioridade;
  teste_recomendado: string;
}

export interface HipoteseDiagnostica {
  titulo: string;
  sistema_afetado: string;
  probabilidade: number;
  confianca: Confianca;
  justificativa_tecnica: string;
  evidencias_usadas: string[];
  componentes_a_verificar: ComponenteVerificar[];
  codigos_obd_possiveis?: string[];
  custo_estimado_brl: Faixa;
  tempo_reparo_horas: Faixa;
}

export interface DiagnosticoDescartado {
  titulo: string;
  motivo_descarte: string;
}

export interface DiagnosticoCdp {
  urgencia_geral: UrgenciaGeral;
  pode_dirigir: PodeDirigir;
  risco_principal: string;
  observacoes_seguranca: string;
  acoes_imediatas: string[];
  hipoteses: HipoteseDiagnostica[];
  diagnosticos_descartados?: DiagnosticoDescartado[];
  manutencao_preventiva_relacionada?: string[];
  proxima_inspecao_recomendada?: string;
  resumo_para_cliente: string;
}
