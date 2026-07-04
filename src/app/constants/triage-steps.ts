export type TriageStepPath = '/veiculo' | '/mapa' | '/sintomas' | '/chat-ia' | '/resultado';

export interface TriageStep {
  path: TriageStepPath;
  label: string;
  short: string;
}

export const TRIAGE_STEPS: readonly TriageStep[] = [
  { path: '/veiculo', label: 'Veículo', short: 'Carro' },
  { path: '/mapa', label: 'Mapa', short: 'Mapa' },
  { path: '/sintomas', label: 'Sintomas', short: 'Sint.' },
  { path: '/chat-ia', label: 'Refinar IA', short: 'IA' },
  { path: '/resultado', label: 'CDP', short: 'CDP' }
] as const;
