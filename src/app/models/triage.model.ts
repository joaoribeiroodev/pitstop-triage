import { ZonaId } from '@data/sintomas.catalog';
import { DiagnosticoCdp } from '@models/cdp.model';
import { PerguntaRefinamentoNaSessao } from '@models/refinamento.model';
import { Veiculo } from '@models/veiculo.model';

export type DiagnosticoFonte = 'ia' | 'contingencia';

export interface RespostaRefinamentoDetalhada {
  id: string;
  pergunta: string;
  resposta: string;
}

export interface TriageSnapshot {
  veiculo: Veiculo;
  zonaSelecionada: ZonaId | '';
  sintomas: string[];
  respostasRefinamento: Record<string, string>;
  perguntasRefinamento: Record<string, string>;
}

export interface PersistedTriageState {
  veiculo: Veiculo;
  zonaSelecionada: ZonaId | '';
  sintomas: string[];
  respostasRefinamento: Record<string, string>;
  perguntasRefinamento: Record<string, string>;
  perguntasAtivas?: PerguntaRefinamentoNaSessao[];
  rodadaRefinamentoMax?: number;
  diagnostico: DiagnosticoCdp | null;
  diagnosticoFonte: DiagnosticoFonte | null;
  triagemConcluida?: boolean;
}

export function buildTriagemApiPayload(
  snapshot: TriageSnapshot,
  extra?: { rodada?: number }
): Record<string, unknown> {
  const respostasDetalhadas: RespostaRefinamentoDetalhada[] = Object.entries(
    snapshot.respostasRefinamento
  ).map(([id, resposta]) => ({
    id,
    pergunta: snapshot.perguntasRefinamento[id]?.trim() || id,
    resposta
  }));

  return {
    veiculo: snapshot.veiculo,
    zonaSelecionada: snapshot.zonaSelecionada,
    sintomas: snapshot.sintomas,
    respostasRefinamento: snapshot.respostasRefinamento,
    respostasDetalhadas,
    ...extra
  };
}
