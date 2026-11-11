import { ChangeDetectionStrategy, Component, computed, inject, Injectable, input, model, signal } from '@angular/core';
import { Api, silent } from '@front/core';
import { Car3dComponent } from './car-3d/car-3d.component';
import { isZona, zonasCatalogo } from './zones';
import type { AnswerValue, FollowUpQuestion, ReportedSymptom, Symptom, SymptomCategory } from '@pitstop/shared-types';

/** Catálogo global de sintomas: muda raramente, então é buscado uma vez por sessão do app. */
@Injectable({ providedIn: 'root' })
export class SymptomCatalog {
  private readonly api = inject(Api);
  private cache: Promise<SymptomCategory[]> | null = null;

  load(): Promise<SymptomCategory[]> {
    this.cache ??= this.api.get<SymptomCategory[]>('/triage/catalog', undefined, silent()).catch(() => {
      this.cache = null;
      return [];
    });
    return this.cache;
  }
}

export function indexSymptoms(catalog: SymptomCategory[]): Map<string, Symptom> {
  return new Map(catalog.flatMap((category) => category.symptoms.map((symptom) => [symptom.code, symptom] as const)));
}

export function formatAnswer(value: AnswerValue | undefined): string {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (value === null || value === undefined || value === '') return 'Não respondido';
  return String(value);
}

/** Rótulo, ícone e descrição de uma categoria: usa a zona do carro quando o código bate, senão o próprio catálogo. */
export function zoneOf(category: SymptomCategory): { label: string; icone: string; descricao: string; sistemas: string[] } {
  if (isZona(category.code)) return zonasCatalogo[category.code];
  return { label: category.name, icone: '🔧', descricao: category.description ?? '', sistemas: [] };
}

/**
 * Etapa "onde dói no carro?": o modelo 3D do PitStop Triage, com as zonas clicáveis, e os atalhos ao lado.
 * Os atalhos são a via acessível por teclado e a que funciona onde não há WebGL.
 */
@Component({
  selector: 'ps-zone-map',
  standalone: true,
  imports: [Car3dComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zone-layout">
      <section class="sheet stripe zone-stage" aria-label="Modelo do veículo">
        <div class="zone-stage-head"><span class="mono-label">Visualização 3D · Telemetria</span></div>
        <div class="zone-canvas">
          @if (no3d()) {
            <p class="placeholder">O modelo 3D não está disponível neste aparelho. Escolha a zona nos atalhos.</p>
          } @else {
            @defer (on viewport) {
              <ps-car-3d [selectedZone]="zone()" (zoneSelected)="zone.set($event)" (unavailable)="no3d.set(true)" />
            } @placeholder {
              <p class="placeholder">Carregando o modelo do veículo…</p>
            }
          }
        </div>
      </section>

      <div class="stack">
        <section class="sheet zone-info" aria-live="polite">
          <span class="mono-label">Área selecionada</span>
          @if (current(); as c) {
            <div class="zone-title">
              <span class="zone-icon" aria-hidden="true">{{ c.meta.icone }}</span>
              <h2>{{ c.meta.label }}</h2>
            </div>
            <p class="muted">{{ c.meta.descricao }}</p>
            @if (c.meta.sistemas.length) {
              <ul class="chips">
                @for (sistema of c.meta.sistemas; track sistema) {
                  <li>{{ sistema }}</li>
                }
              </ul>
            }
          } @else {
            <p class="muted">Clique em uma zona do carro ou use os atalhos abaixo.</p>
          }
        </section>

        <section class="sheet stack-sm">
          <span class="mono-label">Atalhos rápidos</span>
          <div class="zone-shortcuts">
            @for (option of options(); track option.code) {
              <button type="button" [attr.aria-pressed]="zone() === option.code" (click)="zone.set(option.code)">
                <span class="zone-icon" aria-hidden="true">{{ option.meta.icone }}</span>
                <span>{{ option.meta.label }}</span>
                @if (option.marked) {
                  <span class="count">{{ option.marked }} {{ option.marked === 1 ? 'marcado' : 'marcados' }}</span>
                }
              </button>
            } @empty {
              <p class="muted">Carregando zonas…</p>
            }
          </div>
        </section>
      </div>
    </div>
  `
})
export class ZoneMapComponent {
  readonly catalog = input.required<SymptomCategory[]>();
  /** Sintomas já marcados: cada atalho mostra quantos são da sua zona. */
  readonly value = input<ReportedSymptom[]>([]);
  /** Código da categoria escolhida. */
  readonly zone = model<string | null>(null);
  readonly no3d = signal(false);

  readonly options = computed(() => {
    const marked = new Set(this.value().map((item) => item.symptom_code));
    return this.catalog().map((category) => ({
      code: category.code,
      meta: zoneOf(category),
      marked: category.symptoms.filter((symptom) => marked.has(symptom.code)).length
    }));
  });
  readonly current = computed(() => this.options().find((option) => option.code === this.zone()) ?? null);
}

/** Etapa "o que está acontecendo?": cartões de sintoma da zona escolhida e o resumo da escuta ao lado. */
@Component({
  selector: 'ps-symptom-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="symptom-layout">
      <div class="stack">
        @for (category of visible(); track category.id) {
          <fieldset class="symptom-group">
            <legend class="sr-only">{{ category.name }}</legend>
            <div class="symptom-grid">
              @for (symptom of category.symptoms; track symptom.code) {
                <label class="symptom-opt">
                  <span class="mono-label signal">{{ category.name }}</span>
                  <input type="checkbox" [checked]="selected().has(symptom.code)" (change)="toggle(symptom.code)" />
                  <span>
                    {{ symptom.name }}
                    @if (symptom.description) {
                      <br /><small>{{ symptom.description }}</small>
                    }
                  </span>
                </label>
              }
            </div>
          </fieldset>
        } @empty {
          <p class="empty">Carregando catálogo de sintomas…</p>
        }
      </div>

      <aside class="sheet listen" aria-label="Resumo da escuta">
        <header class="stack-sm">
          <span class="mono-label signal">Telemetria</span>
          <h2>Resumo da escuta</h2>
          <p>
            <span class="hl num">{{ value().length }}</span> {{ value().length === 1 ? 'sintoma marcado' : 'sintomas marcados' }}
          </p>
        </header>
        @if (marked().length) {
          <ul class="listen-list">
            @for (item of marked(); track item.code) {
              <li>
                <span
                  >{{ item.name }}<br /><small>{{ item.zone }}</small></span
                >
                <button type="button" class="btn-quiet" [attr.aria-label]="'Desmarcar ' + item.name" (click)="toggle(item.code)">Tirar</button>
              </li>
            }
          </ul>
        } @else {
          <p class="listen-empty">Nenhum sintoma marcado ainda.</p>
        }
        <ng-content />
      </aside>
    </div>
  `
})
export class SymptomSelectComponent {
  readonly catalog = input.required<SymptomCategory[]>();
  readonly value = model.required<ReportedSymptom[]>();
  /** Código da zona escolhida no mapa. Sem zona, mostra o catálogo inteiro. */
  readonly zone = input<string | null>(null);
  readonly selected = computed(() => new Set(this.value().map((item) => item.symptom_code)));
  readonly visible = computed(() => {
    const zone = this.zone();
    const match = this.catalog().filter((category) => category.code === zone);
    return match.length ? match : this.catalog();
  });
  readonly marked = computed(() => {
    const names = new Map(
      this.catalog().flatMap((category) => category.symptoms.map((symptom) => [symptom.code, { name: symptom.name, zone: category.name }] as const))
    );
    return this.value().map((item) => ({
      code: item.symptom_code,
      name: names.get(item.symptom_code)?.name ?? item.symptom_code,
      zone: names.get(item.symptom_code)?.zone ?? ''
    }));
  });

  toggle(code: string): void {
    this.value.update((list) =>
      list.some((item) => item.symptom_code === code) ? list.filter((item) => item.symptom_code !== code) : [...list, { symptom_code: code, answers: {} }]
    );
  }
}

/** Etapa "conte um pouco mais": perguntas de follow-up de cada sintoma escolhido. Todas opcionais. */
@Component({
  selector: 'ps-symptom-questions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @for (item of value(); track item.symptom_code) {
        @if (bySymptom().get(item.symptom_code); as symptom) {
          <fieldset class="sheet stack-sm">
            <legend>
              <h3>{{ symptom.name }}</h3>
            </legend>
            @for (question of symptom.follow_up_questions; track question.id) {
              @let fieldId = item.symptom_code + '-' + question.id;
              @switch (question.type) {
                @case ('select') {
                  <label [attr.for]="fieldId"
                    >{{ question.text }}
                    <select [id]="fieldId" [value]="text(item, question)" (change)="answer(item.symptom_code, question, $any($event.target).value)">
                      <option value="">Não sei / não informado</option>
                      @for (option of question.options; track option) {
                        <option [value]="option" [selected]="item.answers[question.id] === option">{{ option }}</option>
                      }
                    </select>
                  </label>
                }
                @case ('boolean') {
                  <div role="radiogroup" [attr.aria-label]="question.text" class="stack-sm">
                    <span class="q-label">{{ question.text }}</span>
                    <div class="row">
                      <label class="check"
                        ><input
                          type="radio"
                          [name]="fieldId"
                          [checked]="item.answers[question.id] === true"
                          (change)="set(item.symptom_code, question.id, true)"
                        />
                        Sim</label
                      >
                      <label class="check"
                        ><input
                          type="radio"
                          [name]="fieldId"
                          [checked]="item.answers[question.id] === false"
                          (change)="set(item.symptom_code, question.id, false)"
                        />
                        Não</label
                      >
                    </div>
                  </div>
                }
                @case ('number') {
                  <label [attr.for]="fieldId"
                    >{{ question.text }}
                    <input
                      [id]="fieldId"
                      type="number"
                      inputmode="decimal"
                      [value]="text(item, question)"
                      (change)="answer(item.symptom_code, question, $any($event.target).value)"
                    />
                  </label>
                }
                @default {
                  <label [attr.for]="fieldId"
                    >{{ question.text }}
                    <input
                      [id]="fieldId"
                      maxlength="300"
                      [value]="text(item, question)"
                      (change)="answer(item.symptom_code, question, $any($event.target).value)"
                    />
                  </label>
                }
              }
            } @empty {
              <p class="muted">Sem perguntas adicionais para este sintoma.</p>
            }
          </fieldset>
        }
      }
    </div>
  `
})
export class SymptomQuestionsComponent {
  readonly catalog = input.required<SymptomCategory[]>();
  readonly value = model.required<ReportedSymptom[]>();
  readonly bySymptom = computed(() => indexSymptoms(this.catalog()));

  text(item: ReportedSymptom, question: FollowUpQuestion): string {
    const value = item.answers[question.id];
    return value === null || value === undefined ? '' : String(value);
  }

  answer(code: string, question: FollowUpQuestion, raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return this.set(code, question.id, null);
    if (question.type === 'number') {
      const parsed = Number(trimmed.replace(',', '.'));
      return this.set(code, question.id, Number.isFinite(parsed) ? parsed : null);
    }
    this.set(code, question.id, trimmed);
  }

  set(code: string, questionId: string, value: AnswerValue): void {
    this.value.update((list) =>
      list.map((item) => {
        if (item.symptom_code !== code) return item;
        const answers = { ...item.answers };
        if (value === null) delete answers[questionId];
        else answers[questionId] = value;
        return { ...item, answers };
      })
    );
  }
}

/** Relato de sintomas em modo leitura: o que o cliente contou, com as respostas de cada pergunta. */
@Component({
  selector: 'ps-symptom-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="report">
      @for (entry of entries(); track entry.code) {
        <li>
          <strong>{{ entry.name }}</strong>
          @if (entry.answers.length) {
            <dl>
              @for (answer of entry.answers; track answer.question) {
                <div>
                  <dt>{{ answer.question }}</dt>
                  <dd>{{ answer.answer }}</dd>
                </div>
              }
            </dl>
          }
        </li>
      } @empty {
        <li class="muted">Nenhum sintoma do catálogo foi registrado.</li>
      }
    </ul>
    @if (notes()) {
      <div class="notice"><small>Relato livre</small><br />{{ notes() }}</div>
    }
  `
})
export class SymptomReportComponent {
  readonly catalog = input.required<SymptomCategory[]>();
  readonly symptoms = input.required<ReportedSymptom[]>();
  readonly notes = input<string | null>(null);

  readonly entries = computed(() => {
    const index = indexSymptoms(this.catalog());
    return this.symptoms().map((item) => {
      const symptom = index.get(item.symptom_code);
      const questions = new Map((symptom?.follow_up_questions ?? []).map((question) => [question.id, question.text]));
      return {
        code: item.symptom_code,
        name: symptom?.name ?? item.symptom_code,
        answers: Object.entries(item.answers ?? {}).map(([id, value]) => ({ question: questions.get(id) ?? id, answer: formatAnswer(value) }))
      };
    });
  });
}
