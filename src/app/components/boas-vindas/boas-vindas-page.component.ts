import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { veiculoResumoTexto } from '@constants/cdp-display';
import { LgpdConsentService } from '@services/lgpd-consent.service';
import { TriageStateService } from '@services/triage-state.service';

interface ShowcaseSlide {
  src: string;
  numero: string;
  rotuloCurto: string;
  titulo: string;
  rota: string;
}

@Component({
  selector: 'app-boas-vindas-page',
  standalone: false,
  templateUrl: './boas-vindas-page.component.html',
  styleUrl: './boas-vindas-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BoasVindasPageComponent {
  private readonly lgpd = inject(LgpdConsentService);
  private readonly router = inject(Router);
  private readonly state = inject(TriageStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly aceitouPolitica = signal(false);
  readonly triagemConcluida = this.state.triagemConcluida;
  readonly slideAtivoIndex = signal(0);

  readonly showcaseSlides: readonly ShowcaseSlide[] = [
    {
      src: '/screenshot/etapa-01-veiculo.png',
      numero: '01',
      rotuloCurto: 'Veículo',
      titulo: 'Identifique o veículo pela FIPE ou manualmente',
      rota: 'veiculo'
    },
    {
      src: '/screenshot/etapa-02-mapa.png',
      numero: '02',
      rotuloCurto: 'Mapa',
      titulo: 'Selecione a área do carro no mapa 3D',
      rota: 'mapa'
    },
    {
      src: '/screenshot/etapa-03-sintomas.png',
      numero: '03',
      rotuloCurto: 'Sintomas',
      titulo: 'Marque os sintomas relatados pelo motorista',
      rota: 'sintomas'
    },
    {
      src: '/screenshot/etapa-04-refinamento-ia.png',
      numero: '04',
      rotuloCurto: 'IA',
      titulo: 'A IA faz perguntas técnicas para refinar o diagnóstico',
      rota: 'chat-ia'
    }
  ];

  readonly slideAtivo = computed(() => this.showcaseSlides[this.slideAtivoIndex()]!);

  readonly veiculoResumo = computed(() => {
    if (!this.state.diagnostico()) return '';
    return veiculoResumoTexto(this.state.snapshot());
  });

  constructor() {
    const reduzirMovimento =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduzirMovimento) {
      interval(5500)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          this.slideAtivoIndex.update((i) => (i + 1) % this.showcaseSlides.length);
        });
    }
  }

  irParaSlide(index: number): void {
    this.slideAtivoIndex.set(index);
  }

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
