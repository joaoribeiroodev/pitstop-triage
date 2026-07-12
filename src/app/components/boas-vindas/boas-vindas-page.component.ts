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

interface HomeFeature {
  icone: string;
  titulo: string;
  descricao: string;
}

type AuthModal = 'login' | 'signup';

interface UsuarioDemo {
  nome: string;
  email: string;
}

const DEMO_SESSION_KEY = 'pitstop-triage/demo-user/v1';

function carregarUsuarioDemo(): UsuarioDemo | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsuarioDemo;
    if (!parsed.nome?.trim() || !parsed.email?.trim()) return null;
    return { nome: parsed.nome.trim(), email: parsed.email.trim() };
  } catch {
    return null;
  }
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
  readonly authModal = signal<AuthModal | null>(null);
  readonly usuarioDemo = signal<UsuarioDemo | null>(carregarUsuarioDemo());

  loginEmail = '';
  loginSenha = '';
  cadastroNome = '';
  cadastroEmail = '';
  cadastroSenha = '';

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

  readonly features: readonly HomeFeature[] = [
    {
      icone: '🗺️',
      titulo: 'Mapa 3D interativo',
      descricao: 'Aponte a área do carro girando um modelo 3D — motor, freios, suspensão, elétrica e mais.'
    },
    {
      icone: '🤖',
      titulo: 'Refinamento com IA',
      descricao: 'A IA faz perguntas técnicas como um mecânico para estreitar as hipóteses do diagnóstico.'
    },
    {
      icone: '📄',
      titulo: 'CDP em PDF',
      descricao: 'Um relatório com urgência, hipóteses, custos estimados e ações — pronto para a oficina.'
    },
    {
      icone: '🔒',
      titulo: 'Privacidade LGPD',
      descricao: 'Sem nome, CPF ou placa. Seus dados ficam no navegador e podem ser apagados quando quiser.'
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

  abrirAuth(modo: AuthModal): void {
    this.authModal.set(modo);
  }

  fecharAuth(): void {
    this.authModal.set(null);
  }

  enviarLogin(event: Event): void {
    event.preventDefault();
    const email = this.loginEmail.trim();
    if (!email) return;
    const nome = email.split('@')[0]?.replace(/\./g, ' ') || 'Motorista';
    this.persistirDemo({ nome, email });
    this.loginSenha = '';
    this.fecharAuth();
  }

  enviarCadastro(event: Event): void {
    event.preventDefault();
    const nome = this.cadastroNome.trim();
    const email = this.cadastroEmail.trim();
    if (!nome || !email) return;
    this.persistirDemo({ nome, email });
    this.cadastroSenha = '';
    this.fecharAuth();
  }

  sairDemo(): void {
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.removeItem(DEMO_SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
    this.usuarioDemo.set(null);
  }

  private persistirDemo(usuario: UsuarioDemo): void {
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(usuario));
      } catch {
        /* ignore */
      }
    }
    this.usuarioDemo.set(usuario);
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
