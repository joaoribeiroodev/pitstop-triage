import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ZonaId, rotulosZona, zonasCatalogo } from '@data/sintomas.catalog';
import { TriageStateService } from '@services/triage-state.service';

@Component({
  selector: 'app-mapa-page',
  standalone: false,
  templateUrl: './mapa-page.component.html',
  styleUrls: ['./mapa-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapaPageComponent {
  readonly state = inject(TriageStateService);
  private readonly router = inject(Router);

  readonly atalhos = Object.values(zonasCatalogo);

  readonly zonaLabel = computed(() => rotulosZona[this.state.zonaSelecionada()] ?? 'Nenhuma');
  readonly zonaMeta = computed(() => {
    const id = this.state.zonaSelecionada();
    return id ? zonasCatalogo[id] : null;
  });

  selecionar(zona: ZonaId): void {
    this.state.selecionarZona(zona);
  }

  voltar(): void {
    void this.router.navigateByUrl('/veiculo');
  }

  avancar(): void {
    void this.router.navigateByUrl('/sintomas');
  }
}
