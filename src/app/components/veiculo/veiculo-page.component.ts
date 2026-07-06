import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { FipeAno, FipeMarca, FipeModelo, FipeService } from '@services/fipe.service';
import { TriageStateService, VeiculoOrigem } from '@services/triage-state.service';

type Modo = 'fipe' | 'manual';

@Component({
  selector: 'app-veiculo-page',
  standalone: false,
  templateUrl: './veiculo-page.component.html',
  styleUrl: './veiculo-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VeiculoPageComponent {
  readonly state = inject(TriageStateService);
  private readonly fipe = inject(FipeService);
  private readonly router = inject(Router);

  readonly anoAtual = new Date().getFullYear() + 1;
  readonly modo = signal<Modo>(this.detectarModoInicial());

  readonly marcas = signal<FipeMarca[]>([]);
  readonly modelos = signal<FipeModelo[]>([]);
  readonly anos = signal<FipeAno[]>([]);
  readonly marcaSelecionada = signal('');
  readonly modeloSelecionado = signal('');
  readonly anoSelecionado = signal('');
  readonly carregando = signal(false);
  readonly erro = signal('');

  readonly manualMarca = signal('');
  readonly manualModelo = signal('');
  readonly manualAno = signal('');
  readonly manualVersao = signal('');
  readonly manualObservacoes = signal('');

  readonly resumo = computed(() => {
    const veiculo = this.state.veiculo();
    const origemLabel = veiculo.origem === 'fipe' ? 'FIPE' : veiculo.origem === 'manual' ? 'Manual' : '—';
    return [
      { label: 'Marca', value: veiculo.marca },
      { label: 'Modelo', value: veiculo.modelo },
      { label: 'Ano', value: veiculo.ano },
      { label: 'Código FIPE', value: veiculo.codigoFipe },
      { label: 'Origem', value: origemLabel }
    ];
  });

  constructor() {
    const v = this.state.veiculo();
    if (v.origem === 'manual') {
      this.manualMarca.set(v.marca);
      this.manualModelo.set(v.modelo);
      this.manualAno.set(v.ano);
      this.manualObservacoes.set(v.observacoes ?? '');
    } else if (v.origem === 'fipe' && v.fipeMarcaCodigo) {
      this.restaurarFipe(v.fipeMarcaCodigo, v.fipeModeloCodigo, v.fipeAnoCodigo);
    }
    this.carregarMarcas();
  }

  private restaurarFipe(marcaCodigo: string, modeloCodigo?: string, anoCodigo?: string): void {
    this.marcaSelecionada.set(marcaCodigo);
    this.carregando.set(true);
    this.fipe
      .listarModelos(marcaCodigo)
      .pipe(
        catchError(() => of([])),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((modelos) => {
        this.modelos.set(modelos);
        if (!modeloCodigo) return;
        this.modeloSelecionado.set(modeloCodigo);
        this.carregando.set(true);
        this.fipe
          .listarAnos(marcaCodigo, modeloCodigo)
          .pipe(
            catchError(() => of([])),
            finalize(() => this.carregando.set(false))
          )
          .subscribe((anos) => {
            this.anos.set(anos);
            if (anoCodigo) this.anoSelecionado.set(anoCodigo);
          });
      });
  }

  private detectarModoInicial(): Modo {
    return this.state.veiculo().origem === 'manual' ? 'manual' : 'fipe';
  }

  setModo(modo: Modo): void {
    this.modo.set(modo);
    this.erro.set('');
  }

  carregarMarcas(): void {
    this.carregando.set(true);
    this.fipe
      .listarMarcas()
      .pipe(
        catchError(() => {
          this.erro.set('Não consegui consultar a FIPE agora. Você pode usar o modo manual.');
          return of([]);
        }),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((marcas) => this.marcas.set(marcas));
  }

  selecionarMarca(codigo: string): void {
    this.marcaSelecionada.set(codigo);
    this.modeloSelecionado.set('');
    this.anoSelecionado.set('');
    this.modelos.set([]);
    this.anos.set([]);
    const marca = this.marcas().find((item) => item.codigo === codigo);
    this.atualizarFipe({
      marca: marca?.nome ?? '',
      modelo: '',
      ano: '',
      codigoFipe: '',
      fipeMarcaCodigo: codigo,
      fipeModeloCodigo: '',
      fipeAnoCodigo: ''
    });
    if (!codigo) return;
    this.carregando.set(true);
    this.fipe
      .listarModelos(codigo)
      .pipe(
        catchError(() => {
          this.erro.set('Falha ao listar modelos da FIPE.');
          return of([]);
        }),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((modelos) => this.modelos.set(modelos));
  }

  selecionarModelo(codigo: string): void {
    this.modeloSelecionado.set(codigo);
    this.anoSelecionado.set('');
    this.anos.set([]);
    const modelo = this.modelos().find((item) => String(item.codigo) === String(codigo));
    this.atualizarFipe({
      modelo: modelo?.nome ?? '',
      ano: '',
      codigoFipe: '',
      fipeModeloCodigo: codigo,
      fipeAnoCodigo: ''
    });
    if (!codigo || !this.marcaSelecionada()) return;
    this.carregando.set(true);
    this.fipe
      .listarAnos(this.marcaSelecionada(), codigo)
      .pipe(
        catchError(() => {
          this.erro.set('Falha ao listar anos da FIPE.');
          return of([]);
        }),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((anos) => this.anos.set(anos));
  }

  selecionarAno(codigo: string): void {
    this.anoSelecionado.set(codigo);
    if (!codigo || !this.marcaSelecionada() || !this.modeloSelecionado()) return;
    this.carregando.set(true);
    this.fipe
      .consultarValor(this.marcaSelecionada(), this.modeloSelecionado(), codigo)
      .pipe(
        catchError(() => {
          this.erro.set('Falha ao consultar valor FIPE.');
          return of(null);
        }),
        finalize(() => this.carregando.set(false))
      )
      .subscribe((valor) => {
        if (!valor) return;
        this.atualizarFipe({
          marca: valor.Marca,
          modelo: valor.Modelo,
          ano: String(valor.AnoModelo),
          codigoFipe: valor.CodigoFipe,
          fipeAnoCodigo: codigo
        });
      });
  }

  setManual(patch: {
    marca?: string;
    modelo?: string;
    ano?: string;
    versao?: string;
    observacoes?: string;
  }): void {
    if (patch.marca !== undefined) this.manualMarca.set(patch.marca);
    if (patch.modelo !== undefined) this.manualModelo.set(patch.modelo);
    if (patch.ano !== undefined) this.manualAno.set(String(patch.ano));
    if (patch.versao !== undefined) this.manualVersao.set(patch.versao);
    if (patch.observacoes !== undefined) this.manualObservacoes.set(patch.observacoes);

    const modeloFinal = [this.manualModelo().trim(), this.manualVersao().trim()].filter(Boolean).join(' ');
    this.state.atualizarVeiculo({
      marca: this.manualMarca().trim(),
      modelo: modeloFinal,
      ano: String(this.manualAno()).trim(),
      codigoFipe: '',
      origem: 'manual' as VeiculoOrigem,
      observacoes: this.manualObservacoes().trim() || undefined,
      fipeMarcaCodigo: undefined,
      fipeModeloCodigo: undefined,
      fipeAnoCodigo: undefined
    });
  }

  private atualizarFipe(partial: {
    marca?: string;
    modelo?: string;
    ano?: string;
    codigoFipe?: string;
    fipeMarcaCodigo?: string;
    fipeModeloCodigo?: string;
    fipeAnoCodigo?: string;
  }): void {
    this.state.atualizarVeiculo({
      ...partial,
      origem: 'fipe' as VeiculoOrigem,
      observacoes: undefined
    });
  }

  limpar(): void {
    this.marcaSelecionada.set('');
    this.modeloSelecionado.set('');
    this.anoSelecionado.set('');
    this.modelos.set([]);
    this.anos.set([]);
    this.manualMarca.set('');
    this.manualModelo.set('');
    this.manualAno.set('');
    this.manualVersao.set('');
    this.manualObservacoes.set('');
    this.erro.set('');
    this.state.reiniciar();
  }

  avancar(): void {
    void this.router.navigateByUrl('/mapa');
  }

  tabClass(modo: Modo): string {
    if (this.modo() !== modo) return 'tab-btn focus-ring';
    return modo === 'fipe' ? 'tab-btn tab-btn--active focus-ring' : 'tab-btn tab-btn--active-soft focus-ring';
  }
}
