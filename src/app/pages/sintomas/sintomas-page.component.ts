import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { rotulosZona, sintomasPorZona } from '@core/data/sintomas.catalog';
import { TriageStateService } from '@core/services/triage-state.service';

@Component({
  selector: 'app-sintomas-page',
  standalone: false,
  templateUrl: './sintomas-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SintomasPageComponent {
  readonly state = inject(TriageStateService);
  private readonly router = inject(Router);

  readonly sintomas = computed(() => {
    const zona = this.state.zonaSelecionada();
    return zona ? sintomasPorZona[zona] : [];
  });
  readonly zonaLabel = computed(() => rotulosZona[this.state.zonaSelecionada()] ?? 'não selecionada');

  selecionado(sintoma: string): boolean {
    return this.state.sintomas().includes(sintoma);
  }

  voltar(): void {
    void this.router.navigateByUrl('/mapa');
  }

  avancar(): void {
    void this.router.navigateByUrl('/chat-ia');
  }
}
