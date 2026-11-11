import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES, formatDuration } from '@front/format';
import { PlateComponent, StatusComponent } from '@front/ui';
import {
  ORDER_STATUS_LABELS,
  OrderStatus,
  QUOTE_DRIVEN_STATUSES,
  type ConfirmedCause,
  type Quote,
  type SendQuoteResponse,
  type ServiceOrder,
  type SuggestedCheck,
  type SuggestedPart,
  type SymptomCategory,
  type TenantUser
} from '@pitstop/shared-types';
import { copyText } from '../ui/clipboard';
import { ItemInput, ItemsEditorComponent } from '../ui/items-editor.component';
import { NotifyCustomerComponent } from '../ui/notify.component';
import { SymptomCatalog, SymptomReportComponent } from '../ui/symptoms';

type Tab = 'symptoms' | 'diagnosis' | 'quote' | 'timeline';
type Assignable = Pick<TenantUser, 'id' | 'full_name' | 'role'>;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'symptoms', label: 'Sintomas' },
  { id: 'diagnosis', label: 'Diagnóstico' },
  { id: 'quote', label: 'Orçamento' },
  { id: 'timeline', label: 'Timeline' }
];

/** Rótulo do botão de avanço: diz o que a pessoa faz, não o nome do status. */
const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
  diagnosis: 'Iniciar diagnóstico',
  in_progress: 'Iniciar serviço',
  completed: 'Concluir serviço',
  delivered: 'Registrar entrega'
};

const ORIGIN_LABELS = { global: 'catálogo', shop: 'histórico da oficina', both: 'catálogo e histórico' } as const;
const ACTOR_LABELS = { staff: 'Oficina', customer: 'Cliente', system: 'Sistema', support: 'Suporte PitStop' } as const;

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PlateComponent, StatusComponent, SymptomReportComponent, ItemsEditorComponent, NotifyCustomerComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (order(); as o) {
      <div class="page">
        <header class="stack-sm">
          <a routerLink="/service-orders">← Ordens de serviço</a>
          <span class="eyebrow">Ordem de serviço · aberta em {{ o.opened_at | day }}</span>
          <div class="row-between">
            <div class="row">
              <ps-plate [value]="o.vehicle_plate" [large]="true" />
              <div>
                <h1>OS {{ o.order_number }} <span class="hl">·</span> {{ o.vehicle_label }}</h1>
                <span class="muted"
                  ><a [routerLink]="['/customers', o.customer_id]">{{ o.customer_name }}</a> {{ o.customer_phone | phone }},
                  <a [routerLink]="['/vehicles', o.vehicle_id]">ficha do veículo</a></span
                >
              </div>
            </div>
            <ps-status [value]="o.status" />
          </div>

          <div class="row-between">
            <div class="mechanic stack-sm">
              <label for="mechanic">Mecânico responsável</label>
              @if (canAssign) {
                <select id="mechanic" name="mechanic" [ngModel]="o.assigned_mechanic_id ?? ''" (ngModelChange)="assign($event)" [disabled]="closed()">
                  <option value="">Sem mecânico</option>
                  @for (member of team(); track member.id) {
                    <option [value]="member.id">{{ member.full_name }}</option>
                  }
                </select>
              } @else {
                <span class="row"
                  >{{ o.assigned_mechanic_name || 'Sem mecânico' }}
                  @if (!o.assigned_mechanic_id && !closed()) {
                    <button type="button" (click)="assign(auth.me()?.membership?.id ?? '')">Assumir esta OS</button>
                  }
                </span>
              }
            </div>
            <div class="row">
              @for (next of advances(); track next) {
                <button type="button" class="btn-primary btn-big" (click)="changeStatus(next)">{{ advanceLabels[next] }}</button>
              }
              @if (canCancel()) {
                <button type="button" class="btn-danger" (click)="cancel()">Cancelar OS</button>
              }
            </div>
          </div>
          @if (o.status === 'awaiting_approval') {
            <p class="notice notice-wait">Aguardando o cliente responder ao orçamento. A resposta também pode ser registrada na aba Orçamento.</p>
          } @else if (o.status === 'rejected') {
            <p class="notice notice-stop">O cliente recusou o orçamento. Revise os itens e envie uma nova versão, ou cancele a OS.</p>
          }
        </header>

        <div class="tabs" role="tablist" aria-label="Seções da ordem de serviço">
          @for (item of tabs; track item.id) {
            <button type="button" role="tab" [id]="'tab-' + item.id" [attr.aria-selected]="tab() === item.id" (click)="tab.set(item.id)">
              {{ item.label }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('symptoms') {
            <section class="sheet stripe stack" role="tabpanel" aria-labelledby="tab-symptoms">
              <header class="stack-sm">
                <span class="mono-label signal">Relato do cliente</span>
                <h2>O que o cliente percebeu</h2>
              </header>
              <ps-symptom-report [catalog]="catalog()" [symptoms]="o.reported_symptoms" [notes]="o.free_form_notes" />
              @if (o.triage_session_id) {
                <a [routerLink]="['/triage', o.triage_session_id]">Ver a triagem de origem</a>
              }
            </section>
          }

          @case ('diagnosis') {
            <div class="diagnosis" [class.no-side]="!showSuggestions()" role="tabpanel" aria-labelledby="tab-diagnosis">
              <div class="stack">
                <form class="sheet stack" (ngSubmit)="saveDiagnosis()">
                  <div class="row-between">
                    <header class="stack-sm">
                      <span class="mono-label signal">Análise do mecânico</span>
                      <h2>Diagnóstico do mecânico</h2>
                    </header>
                    @if (hasSuggestions() && !showSuggestions()) {
                      <button type="button" class="btn-quiet" (click)="setSuggestionsHidden(false)">Mostrar sugestões</button>
                    }
                  </div>
                  <label
                    >Análise técnica (interna, o cliente não vê)
                    <textarea name="diagnosis" maxlength="8000" rows="8" [disabled]="closed()" [(ngModel)]="diagnosis"></textarea>
                  </label>

                  <fieldset class="stack-sm">
                    <legend><strong>Causas confirmadas</strong></legend>
                    <small>Alimentam o histórico da oficina quando a OS é concluída. Marque nas sugestões ou escreva a sua.</small>
                    @for (cause of causes(); track cause.symptom_code + cause.cause_description; let i = $index) {
                      <div class="row-between cause">
                        <span
                          >{{ cause.cause_description }} <small>({{ symptomName(cause.symptom_code) }})</small></span
                        >
                        <button type="button" class="btn-quiet" [disabled]="closed()" (click)="removeCause(i)">Remover</button>
                      </div>
                    }
                    @if (o.reported_symptoms.length && !closed()) {
                      <div class="row">
                        <select name="causeSymptom" aria-label="Sintoma da causa" class="grow" [(ngModel)]="newCause.symptom_code">
                          @for (symptom of o.reported_symptoms; track symptom.symptom_code) {
                            <option [value]="symptom.symptom_code">{{ symptomName(symptom.symptom_code) }}</option>
                          }
                        </select>
                        <input
                          name="causeText"
                          aria-label="Causa encontrada"
                          class="grow"
                          maxlength="200"
                          placeholder="Causa encontrada"
                          [(ngModel)]="newCause.cause_description"
                        />
                        <button type="button" (click)="addCustomCause()">Incluir</button>
                      </div>
                    }
                  </fieldset>
                  @if (!closed()) {
                    <div><button class="btn-primary">Salvar diagnóstico</button></div>
                  }
                </form>

                <section class="sheet stack">
                  <header class="stack-sm">
                    <span class="mono-label">Comunicação</span>
                    <h2>Notas</h2>
                  </header>
                  <ul class="list">
                    @for (note of o.notes; track note.id) {
                      <li class="note">
                        <small
                          >{{ note.author_name || 'Oficina' }}, {{ note.created_at | moment }}
                          @if (note.visible_to_customer) {
                            <span class="status" data-tone="wait">Visível ao cliente</span>
                          }
                        </small>
                        <p>{{ note.body }}</p>
                      </li>
                    } @empty {
                      <li class="muted note">Nenhuma nota registrada.</li>
                    }
                  </ul>
                  @if (!closed()) {
                    <form class="stack-sm" (ngSubmit)="addNote()">
                      <label>Nova nota <textarea name="note" required maxlength="4000" rows="3" [(ngModel)]="note.body"></textarea></label>
                      <label class="check"><input type="checkbox" name="visible" [(ngModel)]="note.visible" /> Mostrar esta nota ao cliente no portal</label>
                      <div><button [disabled]="!note.body.trim()">Registrar nota</button></div>
                    </form>
                  }
                </section>
              </div>

              @if (showSuggestions()) {
                <aside class="suggestions" aria-label="Sugestões do motor de diagnóstico">
                  <div class="row-between">
                    <header class="stack-sm">
                      <span class="mono-label">Apoio à análise</span>
                      <h3>Sugestões para considerar</h3>
                    </header>
                    <button type="button" class="btn-quiet" (click)="setSuggestionsHidden(true)">Ignorar sugestões</button>
                  </div>
                  <small
                    >Geradas pelo catálogo e pelo histórico da oficina em {{ o.suggestions_computed_at | moment }}. São apoio à sua análise: nada aqui é
                    obrigatório.</small
                  >
                  @if (o.mechanic_suggestions_snapshot?.ai_note; as aiNote) {
                    <p class="notice ai-note"><span class="mono-label">Resumo por IA</span><br />{{ aiNote }}</p>
                  }
                  @for (suggestion of o.mechanic_suggestions_snapshot?.suggestions; track suggestion.symptom_code) {
                    <details open>
                      <summary>{{ suggestion.symptom_name }}</summary>
                      <small>
                        @switch (suggestion.stats_scope) {
                          @case ('brand') {
                            Histórico da oficina para esta marca: {{ suggestion.shop_total_occurrences }} OS.
                          }
                          @case ('all') {
                            Histórico da oficina (todas as marcas): {{ suggestion.shop_total_occurrences }} OS.
                          }
                          @default {
                            Sem histórico na oficina ainda: baseado só no catálogo.
                          }
                        }
                        Tempo estimado: {{ suggestion.estimated_minutes | duration }}.
                      </small>

                      <h4>Causas a considerar</h4>
                      @for (cause of suggestion.causes; track cause.description) {
                        <div class="score">
                          <span>{{ cause.phrasing }}</span>
                          <small class="num">{{ percent(cause.final_score) }}</small>
                          <div class="score-bar" aria-hidden="true"><i [style.width]="percent(cause.final_score)"></i></div>
                          <small
                            >Origem: {{ originLabels[cause.origin] }}
                            @if (cause.avg_price !== null) {
                              , média {{ cause.avg_price | brl }}
                            }
                          </small>
                          @if (!closed()) {
                            <label class="check confirm"
                              ><input
                                type="checkbox"
                                [checked]="isConfirmed(suggestion.symptom_code, cause.description)"
                                (change)="toggleCause(suggestion.symptom_code, cause.description)"
                              />
                              Confirmei</label
                            >
                          }
                        </div>
                      }

                      @if (suggestion.checks.length) {
                        <h4>Verificações recomendadas</h4>
                        <ul class="plain">
                          @for (check of suggestion.checks; track check.name) {
                            <li>
                              {{ check.name }}
                              <small>({{ checkMeta(check) }})</small>
                            </li>
                          }
                        </ul>
                      }

                      @if (suggestion.parts.length) {
                        <h4>Peças tipicamente envolvidas</h4>
                        <ul class="plain">
                          @for (part of suggestion.parts; track part.name) {
                            <li class="row-between">
                              <span
                                >{{ part.avg_quantity }}× {{ part.name }}
                                @if (part.shop_price !== null) {
                                  <small class="num">{{ part.shop_price | brl }}</small>
                                }
                              </span>
                              @if (itemsEditable()) {
                                <button type="button" class="btn-quiet" (click)="addPart(part)">Pôr no orçamento</button>
                              }
                            </li>
                          }
                        </ul>
                      }
                    </details>
                  }
                  @if (!closed()) {
                    <button type="button" (click)="recompute()">Recalcular sugestões</button>
                  }
                </aside>
              }
            </div>
          }

          @case ('quote') {
            <div class="stack" role="tabpanel" aria-labelledby="tab-quote">
              <section class="sheet stripe stack">
                <header class="stack-sm">
                  <span class="mono-label signal">Itens do serviço</span>
                  <h2>Orçamento para aprovação</h2>
                </header>
                <ps-items-editor [items]="o.items" [editable]="itemsEditable()" (added)="addItem($event)" (removed)="removeItem($event)" />
                @if (!itemsEditable() && !closed()) {
                  <small>Os itens ficam travados depois que o orçamento é enviado. Se o cliente recusar, eles voltam a ser editáveis.</small>
                }
              </section>

              @if (sent(); as result) {
                <section class="sheet stack notice-done" role="status">
                  <h2>Orçamento enviado para aprovação</h2>
                  <p>Envie este link ao cliente. Por segurança ele só aparece agora: se perder, gere um novo envio.</p>
                  <input readonly aria-label="Link de aprovação" [value]="result.portal_url" (focus)="$any($event.target).select()" />
                  <div class="row">
                    <button type="button" class="btn-primary" (click)="copy(result.portal_url, 'Link copiado')">Copiar link</button>
                    <button type="button" (click)="copy(result.message, 'Mensagem copiada')">Copiar mensagem pronta</button>
                    @if (result.whatsapp_url) {
                      <a class="btn btn-go" [href]="result.whatsapp_url" target="_blank" rel="noopener">Abrir no WhatsApp</a>
                    }
                  </div>
                  <small>Válido até {{ result.expires_at | day }}.</small>
                </section>
              } @else if (canSend() && canQuote()) {
                <section class="sheet stack-sm">
                  <span class="mono-label signal">Próximo passo</span>
                  <h2>Enviar ao <span class="hl">cliente</span></h2>
                  <p class="muted">Gera a versão {{ o.quotes.length + 1 }} do orçamento com os itens acima e o link para o cliente aprovar ou recusar.</p>
                  <div>
                    <button type="button" class="btn-primary btn-big" [disabled]="!o.items.length" (click)="sendQuote()">Gerar link de aprovação</button>
                  </div>
                </section>
              } @else if (canQuote()) {
                <p class="notice">Quando os itens estiverem prontos, a recepção gera o link de aprovação para o cliente.</p>
              } @else if (o.status === 'draft') {
                <p class="notice">Inicie o diagnóstico para montar e enviar o orçamento.</p>
              }

              @if (o.quotes.length) {
                <section class="sheet stack-sm">
                  <h2>Versões do orçamento</h2>
                  <ul class="list">
                    @for (quote of o.quotes; track quote.id) {
                      <li class="row-between quote-row">
                        <span>
                          <a [routerLink]="['/quotes', quote.id]"
                            ><strong>Versão {{ quote.version }}</strong></a
                          >, <span class="num">{{ quote.total_amount | brl }}</span> <br /><small>
                            {{ quote.status | quoteStatus }}
                            @if (quote.sent_at) {
                              , enviado em {{ quote.sent_at | moment }}
                            }
                            @if (quote.responded_at) {
                              , respondido em {{ quote.responded_at | moment }} ({{
                                quote.responded_via === 'portal' ? 'pelo portal' : 'registrado pela oficina'
                              }})
                            }
                          </small>
                          @if (quote.response_notes) {
                            <br /><small>Motivo: {{ quote.response_notes }}</small>
                          }
                        </span>
                        @if (quote.status === 'sent' && canSend()) {
                          <span class="row">
                            <button type="button" class="btn-go" (click)="respond(quote, 'approve')">Registrar aprovação</button>
                            <button type="button" class="btn-danger" (click)="respond(quote, 'reject')">Registrar recusa</button>
                          </span>
                        }
                      </li>
                    }
                  </ul>
                </section>
              }

              @if (canSend() && auth.hasFeature('portal') && !closed()) {
                <section class="sheet stack-sm">
                  <h3>Link só de acompanhamento</h3>
                  <p class="muted">Para o cliente acompanhar o status, sem poder aprovar orçamento.</p>
                  @if (trackingUrl()) {
                    <input readonly aria-label="Link de acompanhamento" [value]="trackingUrl()" (focus)="$any($event.target).select()" />
                    <div><button type="button" (click)="copy(trackingUrl(), 'Link copiado')">Copiar link</button></div>
                  } @else {
                    <div><button type="button" (click)="issueTracking()">Gerar link de acompanhamento</button></div>
                  }
                </section>
              }

              @if (canSend() && auth.hasFeature('whatsapp') && o.status !== 'draft' && o.status !== 'cancelled') {
                <ps-notify-customer [orderId]="o.id" />
              }
            </div>
          }

          @case ('timeline') {
            <section class="sheet stripe stack" role="tabpanel" aria-labelledby="tab-timeline">
              <header class="stack-sm">
                <span class="mono-label signal">Histórico da ordem</span>
                <h2>Timeline do serviço</h2>
              </header>
              <ol class="timeline">
                @for (entry of o.history; track entry.id) {
                  <li>
                    <strong>{{ entry.to_status | orderStatus }}</strong>
                    <br /><small>{{ entry.created_at | moment }}, {{ entry.changed_by_name || actorLabels[entry.actor_type] }}</small>
                    @if (entry.note) {
                      <br /><span>{{ entry.note }}</span>
                    }
                  </li>
                }
              </ol>
            </section>
          }
        }
      </div>
    }
  `,
  styles: `
    .mechanic {
      min-width: 14rem;
    }
    h4 {
      margin: 0.75rem 0 0.25rem;
      font-size: 0.85rem;
      color: var(--ink-soft);
    }
    .plain {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.35rem;
    }
    .confirm {
      grid-column: 1 / -1;
      min-height: 2rem;
      font-size: 0.9rem;
    }
    .cause,
    .note,
    .quote-row {
      padding: 0.5rem 0;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
    }
  `
})
export class OrderDetailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly catalogStore = inject(SymptomCatalog);
  readonly auth = inject(AuthService);
  readonly id = input.required<string>();

  readonly tabs = TABS;
  readonly advanceLabels = ADVANCE_LABELS;
  readonly originLabels = ORIGIN_LABELS;
  readonly actorLabels = ACTOR_LABELS;
  readonly canAssign = this.auth.hasRole('owner', 'manager', 'receptionist');

  readonly order = signal<ServiceOrder | null>(null);
  readonly catalog = signal<SymptomCategory[]>([]);
  readonly team = signal<Assignable[]>([]);
  readonly tab = signal<Tab>('symptoms');
  readonly causes = signal<ConfirmedCause[]>([]);
  readonly sent = signal<SendQuoteResponse | null>(null);
  readonly trackingUrl = signal('');
  /** Em tela pequena o painel de sugestões começa fechado; a escolha do mecânico vale para a OS. */
  readonly suggestionsHidden = signal(false);

  diagnosis = '';
  note = { body: '', visible: false };
  newCause: ConfirmedCause = { symptom_code: '', cause_description: '' };

  readonly closed = computed(() => ['delivered', 'cancelled'].includes(this.order()?.status ?? ''));
  readonly itemsEditable = computed(() => ['draft', 'diagnosis', 'rejected'].includes(this.order()?.status ?? ''));
  readonly canQuote = computed(() => ['diagnosis', 'rejected'].includes(this.order()?.status ?? ''));
  readonly canSend = computed(() => this.auth.hasRole('owner', 'manager', 'receptionist'));
  readonly advances = computed(() =>
    (this.order()?.allowed_transitions ?? []).filter((status) => status !== 'cancelled' && !QUOTE_DRIVEN_STATUSES.includes(status) && ADVANCE_LABELS[status])
  );
  readonly canCancel = computed(() => this.canAssign && (this.order()?.allowed_transitions ?? []).includes('cancelled'));
  readonly hasSuggestions = computed(() => this.auth.hasFeature('diagnostics') && !!this.order()?.mechanic_suggestions_snapshot?.suggestions.length);
  readonly showSuggestions = computed(() => this.hasSuggestions() && !this.suggestionsHidden());
  private readonly symptomNames = computed(
    () => new Map(this.catalog().flatMap((category) => category.symptoms.map((symptom) => [symptom.code, symptom.name] as const)))
  );

  private get hiddenKey(): string {
    return `pitstop.sugestoes.ocultas.${this.id()}`;
  }

  async ngOnInit(): Promise<void> {
    void this.catalogStore.load().then((catalog) => this.catalog.set(catalog));
    void this.api.get<Assignable[]>('/users/assignable').then((team) => this.team.set(team.filter((member) => member.role === 'mechanic')));
    const stored = localStorage.getItem(this.hiddenKey);
    this.suggestionsHidden.set(stored === null ? matchMedia('(max-width: 860px)').matches : stored === '1');
    const order = await this.api.get<ServiceOrder>(`/service-orders/${this.id()}`);
    this.apply(order);
    this.tab.set(
      order.status === 'draft'
        ? 'symptoms'
        : order.status === 'diagnosis'
          ? 'diagnosis'
          : ['awaiting_approval', 'rejected'].includes(order.status)
            ? 'quote'
            : 'timeline'
    );
  }

  private apply(order: ServiceOrder): void {
    this.order.set(order);
    this.diagnosis = order.mechanic_diagnosis ?? '';
    this.causes.set(order.confirmed_causes ?? []);
    this.newCause = { symptom_code: order.reported_symptoms[0]?.symptom_code ?? '', cause_description: '' };
  }

  symptomName(code: string): string {
    return this.symptomNames().get(code) ?? code;
  }

  checkMeta(check: SuggestedCheck): string {
    return [formatDuration(check.shop_duration_minutes ?? check.estimated_minutes), ...check.tools].join(', ');
  }

  percent(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  setSuggestionsHidden(hidden: boolean): void {
    this.suggestionsHidden.set(hidden);
    localStorage.setItem(this.hiddenKey, hidden ? '1' : '0');
  }

  // ── cabeçalho ──
  async assign(memberId: string): Promise<void> {
    this.apply(await this.api.patch<ServiceOrder>(`/service-orders/${this.id()}`, { assigned_mechanic_id: memberId || null }));
    this.toast.ok(memberId ? 'Mecânico atribuído' : 'OS sem mecânico');
  }

  async changeStatus(status: OrderStatus, note?: string): Promise<void> {
    this.apply(await this.api.post<ServiceOrder>(`/service-orders/${this.id()}/status`, { status, note }));
    this.toast.ok(`OS ${ORDER_STATUS_LABELS[status].toLowerCase()}`);
    if (status === 'diagnosis') this.tab.set('diagnosis');
  }

  async cancel(): Promise<void> {
    const reason = prompt('Cancelar esta OS? Informe o motivo (fica no histórico):');
    if (reason === null) return;
    await this.changeStatus('cancelled', reason.trim() || undefined);
  }

  // ── diagnóstico ──
  isConfirmed(code: string, description: string): boolean {
    return this.causes().some((cause) => cause.symptom_code === code && cause.cause_description === description);
  }

  toggleCause(code: string, description: string): void {
    this.causes.update((list) =>
      this.isConfirmed(code, description)
        ? list.filter((cause) => !(cause.symptom_code === code && cause.cause_description === description))
        : [...list, { symptom_code: code, cause_description: description }]
    );
    void this.saveDiagnosis(true);
  }

  addCustomCause(): void {
    const description = this.newCause.cause_description.trim();
    if (description.length < 2 || !this.newCause.symptom_code || this.isConfirmed(this.newCause.symptom_code, description)) return;
    this.causes.update((list) => [...list, { symptom_code: this.newCause.symptom_code, cause_description: description }]);
    this.newCause = { ...this.newCause, cause_description: '' };
    void this.saveDiagnosis(true);
  }

  removeCause(index: number): void {
    this.causes.update((list) => list.filter((_, i) => i !== index));
    void this.saveDiagnosis(true);
  }

  async saveDiagnosis(quiet = false): Promise<void> {
    const order = await this.api.patch<ServiceOrder>(`/service-orders/${this.id()}`, { mechanic_diagnosis: this.diagnosis, confirmed_causes: this.causes() });
    this.order.set(order);
    this.causes.set(order.confirmed_causes ?? []);
    if (!quiet) this.toast.ok('Diagnóstico salvo');
  }

  async addNote(): Promise<void> {
    this.apply(
      await this.api.post<ServiceOrder>(`/service-orders/${this.id()}/notes`, { body: this.note.body.trim(), visible_to_customer: this.note.visible })
    );
    this.note = { body: '', visible: false };
  }

  async recompute(): Promise<void> {
    this.apply(await this.api.post<ServiceOrder>(`/service-orders/${this.id()}/recompute-suggestions`));
    this.toast.ok('Sugestões recalculadas');
  }

  // ── orçamento ──
  async addItem(item: ItemInput): Promise<void> {
    this.order.set(await this.api.post<ServiceOrder>(`/service-orders/${this.id()}/items`, item));
  }

  async addPart(part: SuggestedPart): Promise<void> {
    await this.addItem({ type: 'part', description: part.name, quantity: Math.max(1, Math.round(part.avg_quantity)), unit_price: part.shop_price ?? 0 });
    this.toast.ok(part.shop_price === null ? 'Peça adicionada sem preço: ajuste na aba Orçamento' : 'Peça adicionada ao orçamento');
  }

  async removeItem(index: number): Promise<void> {
    const item = this.order()?.items[index];
    if (item) this.order.set(await this.api.delete<ServiceOrder>(`/service-orders/${this.id()}/items/${item.id}`));
  }

  async sendQuote(): Promise<void> {
    const quote = await this.api.post<Quote>(`/service-orders/${this.id()}/quotes`);
    const result = await this.api.post<SendQuoteResponse>(`/quotes/${quote.id}/send`);
    this.sent.set(result);
    await this.reload();
  }

  async respond(quote: Quote, decision: 'approve' | 'reject'): Promise<void> {
    const question =
      decision === 'approve'
        ? 'Registrar que o cliente APROVOU o orçamento? Opcional: como ele confirmou.'
        : 'Registrar que o cliente RECUSOU o orçamento? Opcional: motivo.';
    const notes = prompt(question);
    if (notes === null) return;
    await this.api.post(`/quotes/${quote.id}/${decision}`, { notes: notes.trim() || undefined });
    this.sent.set(null);
    this.toast.ok(decision === 'approve' ? 'Orçamento aprovado' : 'Recusa registrada');
    await this.reload();
  }

  async issueTracking(): Promise<void> {
    const link = await this.api.post<{ portal_url: string }>(`/service-orders/${this.id()}/access-links`);
    this.trackingUrl.set(link.portal_url);
  }

  async copy(text: string, done: string): Promise<void> {
    if (await copyText(text)) this.toast.ok(done);
  }

  private async reload(): Promise<void> {
    this.apply(await this.api.get<ServiceOrder>(`/service-orders/${this.id()}`));
  }
}
