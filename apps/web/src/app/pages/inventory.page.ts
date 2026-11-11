import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import type { InventoryItem, StockMovement, StockMovementType } from '@pitstop/shared-types';

const MOVEMENT_LABELS: Record<StockMovementType, string> = { in: 'Entrada', out: 'Saída', adjustment: 'Contagem' };

/** Estoque de peças: saldo, mínimo, movimentações e a baixa automática que vem das OS concluídas. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Estoque</span>
          <h1>O que tem na <span class="hl">prateleira</span>?</h1>
          <p>Peças ligadas a uma OS saem do saldo sozinhas quando o serviço é concluído.</p>
        </header>
        @if (canEdit) {
          <button type="button" class="btn-primary" (click)="adding.set(!adding())">{{ adding() ? 'Cancelar' : 'Novo item' }}</button>
        }
      </div>

      <section class="kpis" aria-label="Resumo do estoque">
        <div class="sheet kpi">
          <strong class="num">{{ activeCount() }}</strong> itens ativos
        </div>
        <div class="sheet kpi" [attr.data-tone]="lowCount() ? 'stop' : 'done'">
          <strong class="num">{{ lowCount() }}</strong> abaixo do mínimo
        </div>
        <div class="sheet kpi">
          <strong class="num">{{ stockValue() | brl }}</strong> em peças (a custo)
        </div>
      </section>

      @if (adding()) {
        <form class="sheet stripe stack" (ngSubmit)="create()" #form="ngForm">
          <h2>Novo item de estoque</h2>
          <div class="cols-form">
            <label>Nome <input name="name" required minlength="2" maxlength="160" [(ngModel)]="draft.name" /></label>
            <label>Código (SKU) <input name="sku" maxlength="60" [(ngModel)]="draft.sku" /></label>
            <label>Local na oficina <input name="location" maxlength="80" placeholder="Ex.: Prateleira A3" [(ngModel)]="draft.location" /></label>
            <label>Saldo inicial <input name="quantity" type="number" min="0" step="0.01" [(ngModel)]="draft.quantity_on_hand" /></label>
            <label>Estoque mínimo <input name="minimum" type="number" min="0" step="0.01" [(ngModel)]="draft.minimum_quantity" /></label>
            <label>Custo unitário (R$) <input name="cost" type="number" min="0" step="0.01" [(ngModel)]="draft.unit_cost" /></label>
            <label>Preço de venda (R$) <input name="price" type="number" min="0" step="0.01" [(ngModel)]="draft.unit_price" /></label>
          </div>
          <div><button class="btn-primary" [disabled]="form.invalid">Cadastrar item</button></div>
        </form>
      }

      <form class="row" role="search" (ngSubmit)="load()">
        <label class="grow"
          ><span class="sr-only">Buscar no estoque</span>
          <input name="q" type="search" placeholder="Buscar por nome ou código" [(ngModel)]="q" />
        </label>
        <label class="check"><input type="checkbox" name="low" [(ngModel)]="lowOnly" (ngModelChange)="load()" /> Só abaixo do mínimo</label>
        <button>Buscar</button>
      </form>

      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="right">Saldo</th>
              <th class="right">Mínimo</th>
              <th class="right">Custo</th>
              <th class="right">Venda</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of items(); track item.id) {
              <tr [class.inactive]="!item.is_active">
                <td>
                  <strong>{{ item.name }}</strong>
                  @if (item.low_stock && item.is_active) {
                    <span class="status" data-tone="stop">Repor</span>
                  }
                  <br /><small>{{ item.sku || 'Sem código' }}{{ item.location ? ' · ' + item.location : '' }}</small>
                </td>
                <td class="right num">{{ item.quantity_on_hand }}</td>
                <td class="right num">{{ item.minimum_quantity }}</td>
                <td class="right num">{{ item.unit_cost | brl }}</td>
                <td class="right num">{{ item.unit_price | brl }}</td>
                <td class="right">
                  @if (canEdit) {
                    <button type="button" class="btn-quiet" [attr.aria-label]="'Movimentar ' + item.name" (click)="startMove(item)">Movimentar</button>
                  }
                  <button type="button" class="btn-quiet" [attr.aria-label]="'Histórico de ' + item.name" (click)="toggleHistory(item)">Histórico</button>
                  @if (canEdit) {
                    <button
                      type="button"
                      class="btn-quiet"
                      [attr.aria-label]="(item.is_active ? 'Desativar ' : 'Reativar ') + item.name"
                      (click)="toggle(item)"
                    >
                      {{ item.is_active ? 'Desativar' : 'Reativar' }}
                    </button>
                  }
                </td>
              </tr>
              @if (moving()?.id === item.id) {
                <tr>
                  <td colspan="6">
                    <form class="row move" (ngSubmit)="move(item)" #moveForm="ngForm">
                      <label
                        >Movimento
                        <select name="type" [(ngModel)]="movement.type">
                          <option value="in">Entrada (compra, devolução)</option>
                          <option value="out">Saída (uso, perda)</option>
                          <option value="adjustment">Contagem (informar o saldo real)</option>
                        </select>
                      </label>
                      <label
                        >{{ movement.type === 'adjustment' ? 'Saldo contado' : 'Quantidade' }}
                        <input name="quantity" type="number" required min="0" step="0.01" [(ngModel)]="movement.quantity" />
                      </label>
                      <label class="grow">Motivo (opcional) <input name="reason" maxlength="300" [(ngModel)]="movement.reason" /></label>
                      <button class="btn-primary" [disabled]="moveForm.invalid">Registrar</button>
                      <button type="button" (click)="moving.set(null)">Cancelar</button>
                    </form>
                  </td>
                </tr>
              }
              @if (history()?.id === item.id) {
                <tr>
                  <td colspan="6">
                    <ul class="list movements" [attr.aria-label]="'Movimentações de ' + item.name">
                      @for (entry of history()!.movements; track entry.id) {
                        <li class="row-between">
                          <span>
                            <strong>{{ labels[entry.type] }}</strong>
                            @if (entry.service_order_id) {
                              · <a [routerLink]="['/service-orders', entry.service_order_id]">OS {{ entry.order_number }}</a>
                            }
                            <br /><small
                              >{{ entry.created_at | moment }}{{ entry.created_by_name ? ', ' + entry.created_by_name : ''
                              }}{{ entry.reason ? ' · ' + entry.reason : '' }}</small
                            >
                          </span>
                          <span class="num">{{ entry.type === 'in' ? '+' : entry.type === 'out' ? '−' : '=' }}{{ entry.quantity }}</span>
                        </li>
                      } @empty {
                        <li class="muted">Nenhuma movimentação ainda.</li>
                      }
                    </ul>
                  </td>
                </tr>
              }
            } @empty {
              <tr>
                <td colspan="6" class="empty">
                  {{
                    q || lowOnly ? 'Nenhum item encontrado com esse filtro.' : 'Nenhum item no estoque. Cadastre as peças que a oficina mantém na prateleira.'
                  }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .inactive td:first-child strong {
      color: var(--ink-soft);
      text-decoration: line-through;
    }
    .move {
      align-items: end;
      flex-wrap: wrap;
    }
    .movements {
      max-height: 18rem;
      overflow-y: auto;
    }
    td .status {
      margin-left: 0.5rem;
    }
  `
})
export class InventoryPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly canEdit = inject(AuthService).hasRole('owner', 'manager');
  readonly labels = MOVEMENT_LABELS;
  readonly items = signal<InventoryItem[]>([]);
  readonly adding = signal(false);
  readonly moving = signal<InventoryItem | null>(null);
  readonly history = signal<(InventoryItem & { movements: StockMovement[] }) | null>(null);
  readonly activeCount = computed(() => this.items().filter((item) => item.is_active).length);
  readonly lowCount = computed(() => this.items().filter((item) => item.is_active && item.low_stock).length);
  readonly stockValue = computed(() => this.items().reduce((sum, item) => sum + (item.is_active ? Math.max(0, item.quantity_on_hand) * item.unit_cost : 0), 0));
  q = '';
  lowOnly = false;
  draft = this.emptyDraft();
  movement: { type: StockMovementType; quantity: number | null; reason: string } = { type: 'in', quantity: null, reason: '' };

  private emptyDraft() {
    return { name: '', sku: '', location: '', quantity_on_hand: 0, minimum_quantity: 0, unit_cost: 0, unit_price: 0 };
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.items.set(await this.api.get<InventoryItem[]>('/inventory/items', { q: this.q.trim() || undefined, low: this.lowOnly ? 'true' : undefined }));
  }

  async create(): Promise<void> {
    await this.api.post('/inventory/items', {
      name: this.draft.name.trim(),
      sku: this.draft.sku.trim() || undefined,
      location: this.draft.location.trim() || undefined,
      quantity_on_hand: Number(this.draft.quantity_on_hand) || 0,
      minimum_quantity: Number(this.draft.minimum_quantity) || 0,
      unit_cost: Number(this.draft.unit_cost) || 0,
      unit_price: Number(this.draft.unit_price) || 0
    });
    this.draft = this.emptyDraft();
    this.adding.set(false);
    this.toast.ok('Item cadastrado no estoque');
    await this.load();
  }

  startMove(item: InventoryItem): void {
    this.movement = { type: 'in', quantity: null, reason: '' };
    this.moving.set(this.moving()?.id === item.id ? null : item);
  }

  async move(item: InventoryItem): Promise<void> {
    await this.api.post(`/inventory/items/${item.id}/movements`, {
      type: this.movement.type,
      quantity: Number(this.movement.quantity),
      reason: this.movement.reason.trim() || undefined
    });
    this.moving.set(null);
    this.toast.ok('Movimentação registrada');
    if (this.history()?.id === item.id) await this.loadHistory(item);
    await this.load();
  }

  async toggleHistory(item: InventoryItem): Promise<void> {
    if (this.history()?.id === item.id) return this.history.set(null);
    await this.loadHistory(item);
  }

  private async loadHistory(item: InventoryItem): Promise<void> {
    this.history.set(await this.api.get<InventoryItem & { movements: StockMovement[] }>(`/inventory/items/${item.id}`));
  }

  async toggle(item: InventoryItem): Promise<void> {
    await this.api.patch(`/inventory/items/${item.id}`, { is_active: !item.is_active });
    await this.load();
  }
}
