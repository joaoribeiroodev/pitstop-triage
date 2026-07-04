import { Confianca, DiagnosticoCdp, PodeDirigir, Prioridade, UrgenciaGeral } from '@models/cdp.model';
import { rotulosZona } from '@data/sintomas.catalog';
import { TriageSnapshot } from '@models/triage.model';

export interface PodeDirigirMeta {
  label: string;
  cor: 'safe' | 'warn' | 'signal' | 'danger';
  icone: string;
}

export const PODE_DIRIGIR_LABEL: Record<PodeDirigir, PodeDirigirMeta> = {
  sim_normal: { label: 'Pode dirigir normalmente', cor: 'safe', icone: '✅' },
  sim_com_cautela: { label: 'Dirija com cautela', cor: 'warn', icone: '⚠️' },
  apenas_curtas_distancias: { label: 'Apenas trajetos curtos', cor: 'signal', icone: '🛑' },
  nao_dirigir: { label: 'NÃO dirija — chame reboque', cor: 'danger', icone: '⛔' }
};

const PODE_DIRIGIR_CLASS: Record<PodeDirigirMeta['cor'], string> = {
  safe: 'bg-pit-safe/15 text-pit-safe border border-pit-safe/30',
  warn: 'bg-pit-warn/15 text-pit-warn border border-pit-warn/30',
  signal: 'bg-pit-signal/15 text-pit-signal border border-pit-signal/30',
  danger: 'bg-pit-danger/15 text-pit-danger border border-pit-danger/30'
};

export function urgenciaBadgeClass(urgencia?: UrgenciaGeral): string {
  if (urgencia === 'critica') return 'bg-pit-danger/15 text-pit-danger border border-pit-danger/30';
  if (urgencia === 'alta') return 'bg-pit-signal/15 text-pit-signal border border-pit-signal/30';
  if (urgencia === 'media') return 'bg-pit-warn/15 text-pit-warn border border-pit-warn/30';
  return 'bg-pit-safe/15 text-pit-safe border border-pit-safe/30';
}

export function urgenciaDotColor(urgencia?: UrgenciaGeral): string {
  if (urgencia === 'critica') return '#EF4444';
  if (urgencia === 'alta') return '#FB923C';
  if (urgencia === 'media') return '#FACC15';
  return '#22C55E';
}

export function podeDirigirBadgeClass(cor: PodeDirigirMeta['cor']): string {
  return PODE_DIRIGIR_CLASS[cor];
}

export function confiancaBadgeClass(confianca: Confianca | string): string {
  if (confianca === 'alta') return 'border-pit-safe/40 bg-pit-safe/10 text-pit-safe';
  if (confianca === 'media') return 'border-pit-warn/40 bg-pit-warn/10 text-pit-warn';
  return 'border-pit-dim/40 bg-pit-dim/10 text-pit-dim';
}

export function prioridadeBadgeClass(prioridade: Prioridade | string): string {
  if (prioridade === 'alta') return 'bg-pit-danger/20 text-pit-danger';
  if (prioridade === 'media') return 'bg-pit-warn/20 text-pit-warn';
  return 'bg-white/10 text-pit-mute';
}

export const URGENCIA_LABEL: Record<UrgenciaGeral, string> = {
  baixa: 'Pode agendar com calma',
  media: 'Agende uma vistoria em breve',
  alta: 'Procure uma oficina logo',
  critica: 'Urgente - não ignore'
};

export function urgenciaLabelHuman(urgencia?: UrgenciaGeral): string {
  return urgencia ? (URGENCIA_LABEL[urgencia] ?? urgencia) : '';
}

export function exibirAlertaSegurancaCdp(d: DiagnosticoCdp): boolean {
  return (
    d.pode_dirigir === 'nao_dirigir' ||
    d.pode_dirigir === 'apenas_curtas_distancias' ||
    d.urgencia_geral === 'alta' ||
    d.urgencia_geral === 'critica'
  );
}

export function veiculoResumoTexto(snapshot: TriageSnapshot): string {
  const v = snapshot.veiculo;
  return `${v.marca} ${v.modelo} ${v.ano}`.trim() || '—';
}

export function buildRoteiroOficina(snapshot: TriageSnapshot, d: DiagnosticoCdp): string[] {
  const linhas: string[] = [
    `Veículo: ${veiculoResumoTexto(snapshot)}`,
    `Área com problema: ${rotulosZona[snapshot.zonaSelecionada] ?? '—'}`,
    `Sintomas: ${snapshot.sintomas.join(', ') || '—'}`
  ];

  const principal = d.hipoteses[0];
  if (principal) {
    linhas.push(`Suspeita principal: ${principal.titulo}`);
    linhas.push(`Estimativa: R$ ${principal.custo_estimado_brl.min} - ${principal.custo_estimado_brl.max}`);
  }

  linhas.push(`Urgência: ${urgenciaLabelHuman(d.urgencia_geral)}`);
  linhas.push(`Condução: ${PODE_DIRIGIR_LABEL[d.pode_dirigir].label}`);

  return linhas;
}

/** Rótulos de condução sem emoji (PDF / texto plano). */
export function podeDirigirLabelPdf(podeDirigir: PodeDirigir): string {
  return PODE_DIRIGIR_LABEL[podeDirigir].label;
}
