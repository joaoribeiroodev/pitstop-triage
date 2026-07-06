import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { rotulosZona, sintomasPorZona } from '@data/sintomas.catalog';
import { TriageStateService } from '@services/triage-state.service';

@Component({
  selector: 'app-sintomas-page',
  standalone: false,
  templateUrl: './sintomas-page.component.html',
  styleUrl: './sintomas-page.component.css',
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

  sintomaCardClass(sintoma: string): string {
    return this.selecionado(sintoma)
      ? 'sintoma-card sintoma-card--selected focus-ring'
      : 'sintoma-card focus-ring';
  }

  sintomaMarkClass(sintoma: string): string {
    return this.selecionado(sintoma)
      ? 'sintoma-card__mark sintoma-card__mark--selected'
      : 'sintoma-card__mark';
  }

  voltar(): void {
    void this.router.navigateByUrl('/mapa');
  }

  avancar(): void {
    void this.router.navigateByUrl('/chat-ia');
  }
}
