import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { TRIAGE_STEPS, TriageStepPath } from '@constants/triage-steps';
import { LgpdConsentService } from '@services/lgpd-consent.service';
import { TriageStateService } from '@services/triage-state.service';

const ROTAS_SEM_CHROME = ['/inicio', '/privacidade'];

type StepStatus = 'active' | 'done' | 'pending' | 'locked';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly state = inject(TriageStateService);
  private readonly lgpd = inject(LgpdConsentService);
  private readonly router = inject(Router);

  private readonly rotaAtual = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split('?')[0]),
      startWith(this.router.url.split('?')[0])
    ),
    { initialValue: '/inicio' }
  );

  readonly steps = TRIAGE_STEPS;
  readonly urgencia = computed(() => this.state.diagnostico()?.urgencia_geral ?? null);
  readonly progresso = computed(() => this.state.progresso());
  readonly exibirChromeTriagem = computed(() => !ROTAS_SEM_CHROME.includes(this.rotaAtual()));

  readonly etapaAtivaIndex = computed(() => {
    const url = this.rotaAtual();
    const idx = TRIAGE_STEPS.findIndex((s) => url.startsWith(s.path));
    return idx >= 0 ? idx : 0;
  });

  readonly progressTicks = [0, 25, 50, 75, 100];

  podeAcessarEtapa(path: TriageStepPath): boolean {
    return this.state.podeAcessarEtapa(path);
  }

  statusEtapa(index: number): StepStatus {
    const step = this.steps[index];
    if (!step) return 'locked';
    const activeIdx = this.etapaAtivaIndex();
    if (index === activeIdx) return 'active';
    if (index < activeIdx) return 'done';
    if (this.podeAcessarEtapa(step.path)) return 'pending';
    return 'locked';
  }

  classeEtapa(index: number): string {
    const status = this.statusEtapa(index);
    const base = 'telemetry-step';
    if (status === 'active') return `${base} telemetry-step--active`;
    if (status === 'done') return `${base} telemetry-step--done`;
    if (status === 'locked') return `${base} telemetry-step--locked`;
    return base;
  }

  reiniciar(): void {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Reiniciar a triagem atual? Os dados preenchidos serão apagados.')
    )
      return;
    this.state.reiniciar();
    void this.router.navigateByUrl('/veiculo');
  }

  excluirDados(): void {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Excluir todos os dados da triagem e revogar seu consentimento? Você será redirecionado à tela inicial.'
      )
    ) {
      return;
    }
    this.state.reiniciar();
    this.lgpd.revogarConsentimento();
    void this.router.navigateByUrl('/inicio');
  }
}
