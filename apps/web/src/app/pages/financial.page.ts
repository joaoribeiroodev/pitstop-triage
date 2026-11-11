import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import type { FinancialEntry, FinancialSummary, FinancialType } from '@pitstop/shared-types';

type StatusFilter = 'open' | 'overdue' | 'paid' | '';

/** Contas a receber e a pagar. As contas a receber nascem sozinhas quando uma OS é concluída. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Financeiro</span>
          <h1>Como está o <span class="hl">caixa</span>?</h1>
          <p>Cada OS concluída vira uma conta a receber. Despesas e outros recebimentos você lança aqui.</p>
        </header>
        <button type="button" class="btn-primary" (click)="adding.set(!adding())">{{ adding() ? 'Cancelar' : 'Novo lançamento' }}</button>
      </div>

      @if (summary(); as totals) {
        <section class="kpis" aria-label="Resumo financeiro">
          <div class="sheet kpi" data-tone="work">
            <strong class="num">{{ totals.receivable_open | brl }}</strong> a receber
          </div>
          <div class="sheet kpi" [attr.data-tone]="totals.receivable_overdue ? 'stop' : 'done'">
            <strong class="num">{{ totals.receivable_overdue | brl }}</strong> a receber em atraso
          </div>
          <div class="sheet kpi" [attr.data-tone]="totals.payable_overdue ? 'stop' : 'wait'">
            <strong class="num">{{ totals.payable_open | brl }}</strong> a pagar
          </div>
          <div class="sheet kpi" data-tone="done">
            <strong class="num">{{ totals.received_this_month | brl }}</strong> recebido no mês
          </div>
        </section>
      }

      @if (adding()) {
        <form class="sheet stripe stack" (ngSubmit)="create()" #form="ngForm">
          <h2>Novo lançamento</h2>
          <div class="cols-form">
            <label
              >Tipo
              <select name="type" [(ngModel)]="draft.type">
                <option value="payable">Conta a pagar</option>
                <option value="receivable">Conta a receber</option>
              </select>
            </label>
            <label>Descrição <input name="description" required minlength="2" maxlength="200" [(ngModel)]="draft.description" /></label>
            <label>Valor (R$) <input name="amount" type="number" required min="0.01" step="0.01" [(ngModel)]="draft.amount" /></label>
            <label>Vencimento <input name="due" type="date" [(ngModel)]="draft.due_date" /></label>
            <label
              >{{ draft.type === 'payable' ? 'Fornecedor' : 'Cliente' }} <input name="counterparty" maxlength="160" [(ngModel)]="draft.counterparty"
            /></label>
          </div>
          <div><button class="btn-primary" [disabled]="form.invalid">Lançar</button></div>
        </form>
      }

      <div class="row-between">
        <div class="tabs" role="tablist" aria-label="Tipo de lançamento">
          <button type="button" role="tab" [attr.aria-selected]="type() === 'receivable'" (click)="setType('receivable')">A receber</button>
          <button type="button" role="tab" [attr.aria-selected]="type() === 'payable'" (click)="setType('payable')">A pagar</button>
        </div>
        <label
          ><span class="sr-only">Situação</span>
          <select name="status" [(ngModel)]="status" (ngModelChange)="load()">
            <option value="open">Em aberto</option>
            <option value="overdue">Em atraso</option>
            <option value="paid">{{ type() === 'receivable' ? 'Recebidos' : 'Pagos' }}</option>
            <option value="">Todos</option>
          </select>
        </label>
      </div>

      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lançamento</th>
              <th>Vencimento</th>
              <th class="right">Valor</th>
              <th>Situação</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.id) {
              <tr>
                <td>
                  <strong>{{ entry.description }}</strong>
                  <br /><small>
                    {{ entry.counterparty || (entry.type === 'payable' ? 'Sem fornecedor' : 'Sem cliente') }}
                    @if (entry.service_order_id) {
                      · <a [routerLink]="['/service-orders', entry.service_order_id]">OS {{ entry.order_number }}</a>
                    }
                  </small>
                </td>
                <td>{{ entry.due_date ? (entry.due_date + 'T12:00:00' | day) : '—' }}</td>
                <td class="right num">{{ entry.amount | brl }}</td>
                <td>
                  @if (entry.paid_at) {
                    <span class="status" data-tone="done">{{ entry.type === 'receivable' ? 'Recebido' : 'Pago' }} em {{ entry.paid_at | day }}</span>
                  } @else if (entry.overdue) {
                    <span class="status" data-tone="stop">Em atraso</span>
                  } @else {
                    <span class="status" data-tone="wait">Em aberto</span>
                  }
                </td>
                <td class="right">
                  @if (entry.paid_at) {
                    <button type="button" class="btn-quiet" [attr.aria-label]="'Reabrir ' + entry.description" (click)="setPaid(entry, false)">Reabrir</button>
                  } @else {
                    <button type="button" class="btn-go" [attr.aria-label]="'Dar baixa em ' + entry.description" (click)="setPaid(entry, true)">
                      {{ entry.type === 'receivable' ? 'Recebi' : 'Paguei' }}
                    </button>
                  }
                  <button type="button" class="btn-quiet" [attr.aria-label]="'Excluir ' + entry.description" (click)="remove(entry)">Excluir</button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="empty">Nenhum lançamento nesta situação.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class FinancialPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly summary = signal<FinancialSummary | null>(null);
  readonly entries = signal<FinancialEntry[]>([]);
  readonly type = signal<FinancialType>('receivable');
  readonly adding = signal(false);
  status: StatusFilter = 'open';
  draft = this.emptyDraft();

  private emptyDraft() {
    return { type: 'payable' as FinancialType, description: '', amount: null as number | null, due_date: '', counterparty: '' };
  }

  ngOnInit(): void {
    void this.load();
  }

  setType(type: FinancialType): void {
    this.type.set(type);
    void this.load();
  }

  async load(): Promise<void> {
    const [summary, entries] = await Promise.all([
      this.api.get<FinancialSummary>('/financial/summary'),
      this.api.get<FinancialEntry[]>('/financial/entries', { type: this.type(), status: this.status || undefined })
    ]);
    this.summary.set(summary);
    this.entries.set(entries);
  }

  async create(): Promise<void> {
    await this.api.post('/financial/entries', {
      type: this.draft.type,
      description: this.draft.description.trim(),
      amount: Number(this.draft.amount),
      due_date: this.draft.due_date || undefined,
      counterparty: this.draft.counterparty.trim() || undefined
    });
    this.type.set(this.draft.type);
    this.draft = this.emptyDraft();
    this.adding.set(false);
    this.toast.ok('Lançamento registrado');
    await this.load();
  }

  async setPaid(entry: FinancialEntry, paid: boolean): Promise<void> {
    await this.api.patch(`/financial/entries/${entry.id}`, { paid });
    this.toast.ok(paid ? 'Baixa registrada' : 'Lançamento reaberto');
    await this.load();
  }

  async remove(entry: FinancialEntry): Promise<void> {
    if (!confirm(`Excluir o lançamento "${entry.description}"?`)) return;
    await this.api.delete(`/financial/entries/${entry.id}`);
    await this.load();
  }
}
