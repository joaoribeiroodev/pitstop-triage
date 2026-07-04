import { ZonaId } from '@data/sintomas.catalog';
import { DiagnosticoCdp } from '@models/cdp.model';
import { Veiculo } from '@models/veiculo.model';

export interface TriageSnapshot {
  veiculo: Veiculo;
  zonaSelecionada: ZonaId | '';
  sintomas: string[];
  respostasRefinamento: Record<string, string>;
}

export interface PersistedTriageState {
  veiculo: Veiculo;
  zonaSelecionada: ZonaId | '';
  sintomas: string[];
  respostasRefinamento: Record<string, string>;
  diagnostico: DiagnosticoCdp | null;
  triagemConcluida?: boolean;
}
