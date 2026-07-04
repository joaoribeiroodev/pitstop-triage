import { Injectable, computed, effect, signal } from '@angular/core';
import { TriageStepPath } from '@constants/triage-steps';
import { ZonaId, zonasCatalogo } from '@data/sintomas.catalog';
import { DiagnosticoCdp } from '@models/cdp.model';
import { PersistedTriageState, TriageSnapshot } from '@models/triage.model';
import { Veiculo } from '@models/veiculo.model';
import { corrigirDiagnosticoCdp } from '@utils/pt-br-text.util';

const STORAGE_KEY = 'pitstop-triage/state/v2';

const emptyVehicle: Veiculo = {
  marca: '',
  modelo: '',
  ano: '',
  codigoFipe: '',
  origem: ''
};

function loadInitial(): PersistedTriageState {
  if (typeof localStorage === 'undefined') {
    return {
      veiculo: { ...emptyVehicle },
      zonaSelecionada: '',
      sintomas: [],
      respostasRefinamento: {},
      diagnostico: null,
      triagemConcluida: false
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw) as Partial<PersistedTriageState>;
    return {
      veiculo: { ...emptyVehicle, ...(parsed.veiculo ?? {}) },
      zonaSelecionada: (parsed.zonaSelecionada as ZonaId | '') ?? '',
      sintomas: parsed.sintomas ?? [],
      respostasRefinamento: parsed.respostasRefinamento ?? {},
      diagnostico: parsed.diagnostico ? corrigirDiagnosticoCdp(parsed.diagnostico) : null,
      triagemConcluida: parsed.triagemConcluida ?? false
    };
  } catch {
    return {
      veiculo: { ...emptyVehicle },
      zonaSelecionada: '',
      sintomas: [],
      respostasRefinamento: {},
      diagnostico: null,
      triagemConcluida: false
    };
  }
}

@Injectable({ providedIn: 'root' })
export class TriageStateService {
  private readonly initial = loadInitial();

  readonly veiculo = signal<Veiculo>(this.initial.veiculo);
  readonly zonaSelecionada = signal<ZonaId | ''>(this.initial.zonaSelecionada);
  readonly sintomas = signal<string[]>(this.initial.sintomas);
  readonly respostasRefinamento = signal<Record<string, string>>(this.initial.respostasRefinamento);
  readonly diagnostico = signal<DiagnosticoCdp | null>(this.initial.diagnostico);
  readonly triagemConcluida = signal(this.initial.triagemConcluida ?? false);

  readonly snapshot = computed<TriageSnapshot>(() => ({
    veiculo: this.veiculo(),
    zonaSelecionada: this.zonaSelecionada(),
    sintomas: this.sintomas(),
    respostasRefinamento: this.respostasRefinamento()
  }));

  readonly podeIrParaMapa = computed(() => {
    const veiculo = this.veiculo();
    return Boolean(veiculo.marca && veiculo.modelo && veiculo.ano);
  });

  readonly podeIrParaSintomas = computed(() => this.podeIrParaMapa() && Boolean(this.zonaSelecionada()));

  readonly podeGerarDiagnostico = computed(() => this.podeIrParaSintomas() && this.sintomas().length > 0);

  readonly podeEmitirCdp = computed(
    () => this.podeGerarDiagnostico() && Object.keys(this.respostasRefinamento()).length > 0
  );

  readonly progresso = computed(() => {
    if (this.triagemConcluida()) return 100;
    let etapas = 0;
    if (this.podeIrParaMapa()) etapas++;
    if (this.zonaSelecionada()) etapas++;
    if (this.sintomas().length > 0) etapas++;
    if (Object.keys(this.respostasRefinamento()).length > 0) etapas++;
    if (this.diagnostico()) etapas++;
    return Math.round((etapas / 5) * 100);
  });

  constructor() {
    effect(() => {
      if (typeof localStorage === 'undefined') return;
      const payload: PersistedTriageState = {
        veiculo: this.veiculo(),
        zonaSelecionada: this.zonaSelecionada(),
        sintomas: this.sintomas(),
        respostasRefinamento: this.respostasRefinamento(),
        diagnostico: this.diagnostico(),
        triagemConcluida: this.triagemConcluida()
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* ignore quota errors */
      }
    });
  }

  podeAcessarEtapa(path: TriageStepPath): boolean {
    switch (path) {
      case '/veiculo':
        return true;
      case '/mapa':
        return this.podeIrParaMapa();
      case '/sintomas':
        return this.podeIrParaSintomas();
      case '/chat-ia':
        return this.podeGerarDiagnostico();
      case '/resultado':
        return this.podeEmitirCdp();
      default:
        return false;
    }
  }

  atualizarVeiculo(partial: Partial<Veiculo>): void {
    this.veiculo.update((current) => ({ ...current, ...partial }));
  }

  selecionarZona(zona: ZonaId): void {
    if (!zonasCatalogo[zona]) return;
    if (this.zonaSelecionada() === zona) return;
    this.zonaSelecionada.set(zona);
    this.sintomas.set([]);
    this.respostasRefinamento.set({});
    this.diagnostico.set(null);
  }

  alternarSintoma(sintoma: string): void {
    this.sintomas.update((items) =>
      items.includes(sintoma) ? items.filter((item) => item !== sintoma) : [...items, sintoma]
    );
    this.diagnostico.set(null);
  }

  responderPergunta(pergunta: string, resposta: string): void {
    this.respostasRefinamento.update((respostas) => ({ ...respostas, [pergunta]: resposta }));
    this.diagnostico.set(null);
  }

  limparRespostas(ids: string[]): void {
    if (ids.length === 0) return;
    this.respostasRefinamento.update((respostas) => {
      const next = { ...respostas };
      for (const id of ids) delete next[id];
      return next;
    });
    this.diagnostico.set(null);
  }

  definirDiagnostico(diagnostico: DiagnosticoCdp | null): void {
    this.diagnostico.set(diagnostico ? corrigirDiagnosticoCdp(diagnostico) : null);
    if (diagnostico) this.triagemConcluida.set(false);
  }

  confirmarTriagem(): void {
    if (!this.diagnostico()) return;
    this.triagemConcluida.set(true);
  }

  reiniciar(): void {
    this.veiculo.set({ ...emptyVehicle });
    this.zonaSelecionada.set('');
    this.sintomas.set([]);
    this.respostasRefinamento.set({});
    this.diagnostico.set(null);
    this.triagemConcluida.set(false);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

// Re-exports para compatibilidade com imports existentes
export type { DiagnosticoCdp, PodeDirigir, UrgenciaGeral } from '@models/cdp.model';
export type { TriageSnapshot } from '@models/triage.model';
export type { Veiculo, VeiculoOrigem } from '@models/veiculo.model';
