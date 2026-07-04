import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of, TimeoutError } from 'rxjs';
import {
  buildRoteiroOficina,
  exibirAlertaSegurancaCdp,
  PODE_DIRIGIR_LABEL,
  podeDirigirBadgeClass,
  confiancaBadgeClass,
  prioridadeBadgeClass,
  urgenciaBadgeClass,
  urgenciaDotColor,
  urgenciaLabelHuman,
  veiculoResumoTexto
} from '@constants/cdp-display';
import { corrigirDiagnosticoCdp } from '@utils/pt-br-text.util';
import { diagnosticoCdpFallback } from '@data/cdp.fallback';
import { rotulosZona } from '@data/sintomas.catalog';
import { HipoteseDiagnostica } from '@models/cdp.model';
import { DiagnosticoApiService } from '@services/diagnostico-api.service';
import { CdpPdfService } from '@services/cdp-pdf.service';
import { TriageStateService } from '@services/triage-state.service';

@Component({
  selector: 'app-resultado-page',
  standalone: false,
  templateUrl: './resultado-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResultadoPageComponent {
  readonly state = inject(TriageStateService);
  private readonly api = inject(DiagnosticoApiService);
  private readonly pdf = inject(CdpPdfService);
  private readonly router = inject(Router);

  readonly carregando = signal(false);
  readonly baixandoPdf = signal(false);
  readonly erro = signal('');
  readonly detalhesTecnicosAberto = signal(false);
  readonly triagemAberta = signal(false);

  readonly diagnostico = computed(() => {
    const d = this.state.diagnostico();
    return d ? corrigirDiagnosticoCdp(d) : null;
  });

  readonly podeDirigirMeta = computed(() => {
    const d = this.diagnostico();
    if (!d) return PODE_DIRIGIR_LABEL.sim_normal;
    return PODE_DIRIGIR_LABEL[d.pode_dirigir] ?? PODE_DIRIGIR_LABEL.sim_normal;
  });

  readonly urgenciaLabel = computed(() => urgenciaLabelHuman(this.diagnostico()?.urgencia_geral));

  readonly exibirAlertaSeguranca = computed(() => {
    const d = this.diagnostico();
    return d ? exibirAlertaSegurancaCdp(d) : false;
  });

  readonly hipotesesResumo = computed((): HipoteseDiagnostica[] => {
    const hipoteses = this.diagnostico()?.hipoteses ?? [];
    return hipoteses.slice(0, 3);
  });

  readonly veiculoResumo = computed(() => veiculoResumoTexto(this.state.snapshot()));

  readonly roteiroOficina = computed(() => {
    const d = this.diagnostico();
    if (!d) return [];
    return buildRoteiroOficina(this.state.snapshot(), d);
  });

  readonly resumoTriagem = computed(() => {
    const snapshot = this.state.snapshot();
    return [
      { label: 'Veículo', value: this.veiculoResumo() },
      { label: 'Zona', value: rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada },
      { label: 'Sintomas', value: snapshot.sintomas.join(', ') || '—' }
    ];
  });

  gerar(): void {
    this.carregando.set(true);
    this.erro.set('');
    this.api
      .gerarDiagnostico(this.state.snapshot())
      .pipe(
        catchError((err) => {
          const prefix =
            err instanceof TimeoutError
              ? 'A IA demorou mais que o esperado (45s). '
              : 'A API não respondeu agora. ';
          this.erro.set(`${prefix}Foi gerado um CDP local de contingência.`);
          return of(diagnosticoCdpFallback(this.state.zonaSelecionada(), this.state.sintomas()));
        }),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((diagnostico) => this.state.definirDiagnostico(diagnostico));
  }

  reiniciar(): void {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Iniciar uma nova triagem? Os dados atuais serão apagados.')
    )
      return;
    this.state.reiniciar();
    void this.router.navigateByUrl('/veiculo');
  }

  confirmarTriagem(): void {
    this.state.confirmarTriagem();
    void this.router.navigateByUrl('/inicio');
  }

  async baixarPdf(): Promise<void> {
    const diagnostico = this.diagnostico();
    if (!diagnostico) return;
    this.baixandoPdf.set(true);
    try {
      const doc = await this.pdf.generate(this.state.snapshot(), diagnostico);
      doc.save(`pitstop-cdp-${Date.now()}.pdf`);
    } finally {
      this.baixandoPdf.set(false);
    }
  }

  alternarDetalhesTecnicos(): void {
    this.detalhesTecnicosAberto.update((v) => !v);
  }

  alternarTriagem(): void {
    this.triagemAberta.update((v) => !v);
  }

  formatarCusto(hipotese: HipoteseDiagnostica): string {
    const { min, max } = hipotese.custo_estimado_brl;
    return `R$ ${min} – ${max}`;
  }

  urgenciaClass(): string {
    return urgenciaBadgeClass(this.diagnostico()?.urgencia_geral);
  }

  urgenciaDot(): string {
    return urgenciaDotColor(this.diagnostico()?.urgencia_geral);
  }

  podeDirigirClass(): string {
    return podeDirigirBadgeClass(this.podeDirigirMeta().cor);
  }

  confiancaClass(confianca: string): string {
    return confiancaBadgeClass(confianca);
  }

  prioridadeClass(prioridade: string): string {
    return prioridadeBadgeClass(prioridade);
  }
}
