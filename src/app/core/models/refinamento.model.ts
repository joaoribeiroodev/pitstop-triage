export type TipoPergunta = 'multipla_escolha' | 'sim_nao' | 'escala';

export interface PerguntaRefinamento {
  id: string;
  pergunta: string;
  tipo: TipoPergunta;
  objetivo: string;
  opcoes: string[];
  ajuda?: string;
}

export interface RefinamentoResponse {
  perguntas: PerguntaRefinamento[];
  raciocinio?: string;
}
