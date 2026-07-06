export type TipoPergunta = 'multipla_escolha' | 'sim_nao' | 'escala';

export interface PerguntaRefinamento {
  id: string;
  pergunta: string;
  tipo: TipoPergunta;
  objetivo: string;
  opcoes: string[];
  ajuda?: string;
}

/** Pergunta exibida na sessão de refinamento, com rodada de origem. */
export interface PerguntaRefinamentoNaSessao extends PerguntaRefinamento {
  rodada: number;
}

export interface RefinamentoResponse {
  perguntas: PerguntaRefinamento[];
  raciocinio?: string;
}
