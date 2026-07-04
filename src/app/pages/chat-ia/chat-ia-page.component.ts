import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  OnDestroy,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of, Subscription, TimeoutError } from 'rxjs';
import { perguntasRefinamentoFallback } from '@core/data/refinamento.fallback';
import { DiagnosticoApiService } from '@core/services/diagnostico-api.service';
import { TriageStateService } from '@core/services/triage-state.service';
import { PerguntaRefinamento } from '@core/models/refinamento.model';
import { corrigirRefinamentoResposta } from '@core/utils/pt-br-text.util';

@Component({
  selector: 'app-chat-ia-page',
  standalone: false,
  templateUrl: './chat-ia-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatIaPageComponent implements OnDestroy {
  readonly state = inject(TriageStateService);
  private readonly api = inject(DiagnosticoApiService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly perguntas = signal<PerguntaRefinamento[]>([]);
  readonly carregando = signal(false);
  readonly carregandoSegundos = signal(0);
  readonly erro = signal('');
  readonly rodadaAtual = signal(1);
  private readonly historicoPerguntas = signal<Record<string, string>>({});
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
    const historico = this.historicoPerguntas();
    return Object.entries(respostas).map(([id, resposta]) => ({
      id,
      pergunta: historico[id] ?? id,
      resposta
    }));
  });

  tipoLabel(tipo: PerguntaRefinamento['tipo']): string {
    if (tipo === 'sim_nao') return 'Sim / Não';
    if (tipo === 'escala') return 'Escala';
    return 'Múltipla escolha';
  }

  carregarRodada(rodada: number): void {
    const idsAtuais = this.perguntas().map((p) => p.id);
    if (idsAtuais.length > 0 && this.rodadaAtual() === rodada) {
      this.state.limparRespostas(idsAtuais);
    }

    this.requestSub?.unsubscribe();
    this.iniciarCarregamento();
    this.erro.set('');
    this.rodadaAtual.set(rodada);
    this.requestSub = this.api
      .gerarPerguntas(this.state.snapshot(), rodada)
      .pipe(
        catchError((err) => {
          const demorou =
            err instanceof TimeoutError
              ? 'A IA demorou mais que o esperado (45s). '
              : 'A IA não respondeu agora. ';
          this.erro.set(`${demorou}Usei perguntas locais para manter o atendimento andando.`);
          return of({ perguntas: perguntasRefinamentoFallback(rodada) });
        }),
        finalize(() => this.pararCarregamento())
      )
      .subscribe((res) => {
        const corrigido = corrigirRefinamentoResposta(res);
        this.perguntas.set(corrigido.perguntas);
        this.historicoPerguntas.update((hist) => {
          const next = { ...hist };
          for (const p of corrigido.perguntas) next[p.id] = p.pergunta;
          return next;
        });
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.requestSub?.unsubscribe();
    this.pararCarregamento();
  }

  responder(pergunta: PerguntaRefinamento, opcao: string): void {
    this.state.responderPergunta(pergunta.id, opcao);
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
