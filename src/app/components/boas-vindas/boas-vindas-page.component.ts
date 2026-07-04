import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { veiculoResumoTexto } from '@constants/cdp-display';
import { LgpdConsentService } from '@services/lgpd-consent.service';
import { TriageStateService } from '@services/triage-state.service';

@Component({
  selector: 'app-boas-vindas-page',
  standalone: false,
  templateUrl: './boas-vindas-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BoasVindasPageComponent {
  private readonly lgpd = inject(LgpdConsentService);
  private readonly router = inject(Router);
  private readonly state = inject(TriageStateService);

  readonly aceitouPolitica = signal(false);
  readonly triagemConcluida = this.state.triagemConcluida;
  readonly veiculoResumo = computed(() => {
    if (!this.state.diagnostico()) return '';
    return veiculoResumoTexto(this.state.snapshot());
  });

  comecar(): void {
    if (!this.aceitouPolitica()) return;
    this.lgpd.registrarAceite();
    void this.router.navigateByUrl('/veiculo');
  }

  novaTriagem(): void {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Iniciar uma nova triagem? Os dados atuais serão apagados.')
    )
      return;
    this.state.reiniciar();
    void this.router.navigateByUrl('/veiculo');
  }

  alternarAceite(): void {
    this.aceitouPolitica.update((v) => !v);
  }
}
