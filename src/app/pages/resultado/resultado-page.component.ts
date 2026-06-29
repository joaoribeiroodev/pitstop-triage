import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of, TimeoutError } from 'rxjs';
import {
  confiancaBadgeClass,
  PODE_DIRIGIR_LABEL,
  podeDirigirBadgeClass,
  prioridadeBadgeClass,
  urgenciaBadgeClass,
  urgenciaDotColor
} from '@core/constants/cdp-display';
import { diagnosticoCdpFallback } from '@core/data/cdp.fallback';
import { rotulosZona } from '@core/data/sintomas.catalog';
import { DiagnosticoApiService } from '@core/services/diagnostico-api.service';
import { CdpPdfService } from '@core/services/cdp-pdf.service';
import { TriageStateService } from '@core/services/triage-state.service';

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
  readonly diagnostico = computed(() => this.state.diagnostico());

  readonly podeDirigirMeta = computed(() => {
    const d = this.diagnostico();
    if (!d) return PODE_DIRIGIR_LABEL.sim_normal;
    return PODE_DIRIGIR_LABEL[d.pode_dirigir] ?? PODE_DIRIGIR_LABEL.sim_normal;
  });

  readonly resumo = computed(() => {
    const snapshot = this.state.snapshot();
    const veiculo = snapshot.veiculo;
    return [
      { label: 'Veículo', value: `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano}`.trim() || '—' },
      { label: 'FIPE / Origem', value: veiculo.codigoFipe || (veiculo.origem === 'manual' ? 'Manual' : '—') },
      { label: 'Zona', value: rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada },
      { label: 'Sintomas', value: snapshot.sintomas.join(', ') || '—' },
      { label: 'Respostas IA', value: Object.values(snapshot.respostasRefinamento).join(' · ') || '—' },
      { label: 'Observações', value: veiculo.observacoes || '—' }
    ];
  });

  gerar(): void {
    this.carregando.set(true);
    this.erro.set('');
    this.api
      .gerarDiagnostico(this.state.snapshot())
      .pipe(
        catchError((err) => {
          const prefix = err instanceof TimeoutError ? 'A IA demorou mais que o esperado (45s). ' : 'A API não respondeu agora. ';
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
