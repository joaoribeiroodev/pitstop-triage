import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LgpdConsentService } from '@core/services/lgpd-consent.service';

@Component({
  selector: 'app-boas-vindas-page',
  standalone: false,
  templateUrl: './boas-vindas-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BoasVindasPageComponent {
  private readonly lgpd = inject(LgpdConsentService);
  private readonly router = inject(Router);

  readonly aceitouPolitica = signal(false);

  comecar(): void {
    if (!this.aceitouPolitica()) return;
    this.lgpd.registrarAceite();
    void this.router.navigateByUrl('/veiculo');
  }

  alternarAceite(): void {
    this.aceitouPolitica.update((v) => !v);
  }
}
