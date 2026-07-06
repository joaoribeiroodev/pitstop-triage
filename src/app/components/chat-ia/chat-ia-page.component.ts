import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, of, Subscription, TimeoutError } from 'rxjs';
import { perguntasRefinamentoFallback } from '@data/refinamento.fallback';
import { AI_REQUEST_TIMEOUT_S, DiagnosticoApiService } from '@services/diagnostico-api.service';
import { TriageStateService } from '@services/triage-state.service';
import { PerguntaRefinamento, PerguntaRefinamentoNaSessao } from '@models/refinamento.model';
import { corrigirRefinamentoResposta } from '@utils/pt-br-text.util';
import { normalizarPerguntasRefinamento } from '@utils/refinamento.util';

@Component({
  selector: 'app-chat-ia-page',
  standalone: false,
  templateUrl: './chat-ia-page.component.html',
  styleUrl: './chat-ia-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatIaPageComponent implements OnInit, OnDestroy {
  readonly state = inject(TriageStateService);
  private readonly api = inject(DiagnosticoApiService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly timeoutSegundos = AI_REQUEST_TIMEOUT_S;
  readonly perguntas = signal<PerguntaRefinamentoNaSessao[]>([]);
  readonly carregando = signal(false);
  readonly carregandoSegundos = signal(0);
  readonly erro = signal('');
  readonly rodadaAtual = signal(1);
  private requestSub?: Subscription;
  private loadingTimer: ReturnType<typeof setInterval> | null = null;

  readonly respondidasRodada = computed(
    () => this.perguntas().filter((p) => !!this.state.respostasRefinamento()[p.id]).length
  );
  readonly pctRodada = computed(() => {
    const total = this.perguntas().length || 1;
    return Math.round((this.respondidasRodada() / total) * 100);
  });
  readonly totalRespostas = computed(() => Object.keys(this.state.respostasRefinamento()).length);

  readonly respostasArr = computed(() => {
    const respostas = this.state.respostasRefinamento();
    const historico = this.state.perguntasRefinamento();
    return Object.entries(respostas).map(([id, resposta]) => ({
      id,
      pergunta: historico[id] ?? id,
      resposta
    }));
  });

  ngOnInit(): void {
    const salvas = normalizarPerguntasRefinamento(
      this.state.perguntasAtivas() as unknown[],
      this.state.rodadaRefinamentoMax() || 1
    );
    if (salvas.length > 0) {
      this.perguntas.set(salvas);
      this.rodadaAtual.set(this.state.rodadaRefinamentoMax() || 1);
      if (salvas.length !== this.state.perguntasAtivas().length) {
        this.state.salvarSessaoRefinamento(salvas, this.state.rodadaRefinamentoMax() || 1);
      }
    }
  }

  tipoLabel(tipo: PerguntaRefinamento['tipo']): string {
    if (tipo === 'sim_nao') return 'Sim / Não';
    if (tipo === 'escala') return 'Escala';
    return 'Múltipla escolha';
  }

  opcaoClass(pergunta: PerguntaRefinamento, opcao: string): string {
    const base = 'option-btn focus-ring';
    const selected = this.resposta(pergunta.id) === opcao;
    if (!selected) return base;
    if (pergunta.tipo === 'sim_nao') {
      return opcao.toLowerCase().startsWith('s') ? `${base} option-btn--safe` : `${base} option-btn--danger`;
    }
    return `${base} option-btn--selected`;
  }

  carregarRodada(rodada: number, opts?: { regerar?: boolean }): void {
    const regerar = opts?.regerar ?? false;
    const idsRodada = this.perguntas()
      .filter((p) => p.rodada === rodada)
      .map((p) => p.id);

    this.requestSub?.unsubscribe();
    this.iniciarCarregamento();
    this.erro.set('');
    this.rodadaAtual.set(rodada);

    this.requestSub = this.api
      .gerarPerguntas(this.state.snapshot(), rodada)
      .pipe(
        map((res) => ({ res, contingencia: false as const })),
        catchError((err) => {
          const demorou =
            err instanceof TimeoutError
              ? `A IA demorou mais que o esperado (${AI_REQUEST_TIMEOUT_S}s). `
              : 'A IA não respondeu agora. ';
          this.erro.set(`${demorou}Usei perguntas locais para manter o atendimento andando.`);
          return of({
            res: { perguntas: perguntasRefinamentoFallback(rodada) },
            contingencia: true as const
          });
        }),
        finalize(() => this.pararCarregamento())
      )
      .subscribe(({ res }) => {
        const corrigido = corrigirRefinamentoResposta(res);
        const novas = normalizarPerguntasRefinamento(corrigido.perguntas ?? [], rodada).map((p) => ({
          ...p,
          rodada
        }));

        if (novas.length === 0) {
          this.erro.set('As perguntas retornadas estavam incompletas. Tente regerar.');
          return;
        }

        if (regerar && idsRodada.length > 0) {
          this.state.limparRespostas(idsRodada);
        }

        const lista = this.mesclarPerguntas(this.perguntas(), novas, rodada, regerar);
        this.perguntas.set(lista);
        this.state.registrarPerguntas(novas);
        this.state.salvarSessaoRefinamento(lista, Math.max(this.state.rodadaRefinamentoMax() ?? 0, rodada));
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.requestSub?.unsubscribe();
    this.pararCarregamento();
  }

  responder(pergunta: PerguntaRefinamento, opcao: string): void {
    this.state.responderPergunta(pergunta.id, opcao, pergunta.pergunta);
    this.cdr.markForCheck();
  }

  resposta(id: string): string {
    return this.state.respostasRefinamento()[id] ?? '';
  }

  podeAvancar(): boolean {
    return this.state.podeEmitirCdp() && this.respondidasRodada() === this.perguntas().length;
  }

  voltar(): void {
    void this.router.navigateByUrl('/sintomas');
  }

  avancar(): void {
    void this.router.navigateByUrl('/resultado');
  }

  private mesclarPerguntas(
    atuais: PerguntaRefinamentoNaSessao[],
    novas: PerguntaRefinamentoNaSessao[],
    rodada: number,
    regerar: boolean
  ): PerguntaRefinamentoNaSessao[] {
    if (rodada === 1 && !regerar && atuais.length === 0) {
      return novas;
    }

    const manter = regerar
      ? atuais.filter((p) => p.rodada !== rodada)
      : atuais.filter((p) => p.rodada < rodada);
    return [...manter, ...novas].sort((a, b) => a.rodada - b.rodada);
  }

  private iniciarCarregamento(): void {
    this.pararCarregamento();
    this.carregando.set(true);
    this.carregandoSegundos.set(0);
    this.loadingTimer = setInterval(() => {
      this.carregandoSegundos.update((s) => s + 1);
      this.cdr.markForCheck();
    }, 1000);
    this.cdr.markForCheck();
  }

  private pararCarregamento(): void {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.carregando.set(false);
    this.cdr.markForCheck();
  }
}
