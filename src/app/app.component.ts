import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { TRIAGE_STEPS } from '@core/constants/triage-steps';
import { LgpdConsentService } from '@core/services/lgpd-consent.service';
import { TriageStateService } from '@core/services/triage-state.service';

const ROTAS_SEM_CHROME = ['/inicio', '/privacidade'];

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
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

  podeAcessarEtapa(path: (typeof TRIAGE_STEPS)[number]['path']): boolean {
    return this.state.podeAcessarEtapa(path);
  }

  reiniciar(): void {
    if (typeof window !== 'undefined' && !window.confirm('Reiniciar a triagem atual? Os dados preenchidos serão apagados.')) return;
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
