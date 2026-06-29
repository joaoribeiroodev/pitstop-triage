import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TRIAGE_STEPS } from '@core/constants/triage-steps';
import { TriageStateService } from '@core/services/triage-state.service';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly state = inject(TriageStateService);
  private readonly router = inject(Router);

  readonly steps = TRIAGE_STEPS;
  readonly urgencia = computed(() => this.state.diagnostico()?.urgencia_geral ?? null);
  readonly progresso = computed(() => this.state.progresso());

  podeAcessarEtapa(path: (typeof TRIAGE_STEPS)[number]['path']): boolean {
    return this.state.podeAcessarEtapa(path);
  }

  reiniciar(): void {
    if (typeof window !== 'undefined' && !window.confirm('Reiniciar a triagem atual?')) return;
    this.state.reiniciar();
    void this.router.navigateByUrl('/veiculo');
  }
}
