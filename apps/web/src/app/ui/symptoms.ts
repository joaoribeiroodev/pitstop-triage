import { ChangeDetectionStrategy, Component, computed, inject, Injectable, input, model } from '@angular/core';
import { Api, silent } from '@front/core';
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

const CATEGORY_ICONS: Record<string, string> = {
  freios: '🛑',
  motor: '⚙️',
  transmissao: '🔩',
  suspensao: '🛞',
  eletrica: '🔋',
  arrefecimento: '🌡️'
};

/** Etapa "o que está acontecendo": sintomas do catálogo, agrupados por categoria. */
@Component({
  selector: 'ps-symptom-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @for (category of catalog(); track category.id) {
        <fieldset class="symptom-group">
          <legend>
            <span aria-hidden="true">{{ icon(category) }}</span> {{ category.name }}
          </legend>
          <div class="symptom-grid">
            @for (symptom of category.symptoms; track symptom.code) {
              <label class="symptom-opt">
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
  `
})
export class SymptomSelectComponent {
  readonly catalog = input.required<SymptomCategory[]>();
  readonly value = model.required<ReportedSymptom[]>();
  readonly selected = computed(() => new Set(this.value().map((item) => item.symptom_code)));

  icon(category: SymptomCategory): string {
    return CATEGORY_ICONS[category.code] ?? '🔧';
  }

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
