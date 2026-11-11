import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, silent } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import type { ItemType, ShopPart, ShopService } from '@pitstop/shared-types';

export interface ItemInput {
  type: ItemType;
  description: string;
  quantity: number;
  unit_price: number;
}

export interface ItemRow extends ItemInput {
  id?: string;
  total?: number;
}

/**
 * Composição de itens (mão de obra e peças) de uma OS ou de um orçamento.
 * Só apresenta e emite intenções: quem hospeda decide como persistir.
 */
@Component({
  selector: 'ps-items-editor',
  standalone: true,
  imports: [FormsModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="right">Qtd.</th>
            <th class="right">Unitário</th>
            <th class="right">Total</th>
            @if (editable()) {
              <th><span class="sr-only">Ações</span></th>
            }
          </tr>
        </thead>
        <tbody>
          @for (item of items(); track item.id ?? $index; let i = $index) {
            <tr>
              <td>
                <small>{{ item.type === 'service' ? 'Mão de obra' : 'Peça' }}</small
                ><br />{{ item.description }}
              </td>
              <td class="right num">{{ item.quantity }}</td>
              <td class="right num">{{ item.unit_price | brl }}</td>
              <td class="right num">{{ item.quantity * item.unit_price | brl }}</td>
              @if (editable()) {
                <td class="right">
                  <button type="button" class="btn-quiet" [attr.aria-label]="'Remover ' + item.description" (click)="removed.emit(i)">Remover</button>
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="editable() ? 5 : 4" class="empty">Nenhum item ainda.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="total-line">
      <span>Total</span><span class="num">{{ total() | brl }}</span>
    </div>

    @if (editable()) {
      <form class="stack-sm add-item" (ngSubmit)="add()" #form="ngForm">
        <h3>Adicionar item</h3>
        @if (services().length || parts().length) {
          <label
            >Do catálogo da oficina
            <select name="pick" [(ngModel)]="pick" (ngModelChange)="applyPick()">
              <option value="">Escolher serviço ou peça…</option>
              @if (services().length) {
                <optgroup label="Serviços">
                  @for (service of services(); track service.id) {
                    <option [value]="'s:' + service.id">{{ service.name }} ({{ service.default_price | brl }})</option>
                  }
                </optgroup>
              }
              @if (parts().length) {
                <optgroup label="Peças">
                  @for (part of parts(); track part.id) {
                    <option [value]="'p:' + part.id">{{ part.name }} ({{ part.default_price | brl }})</option>
                  }
                </optgroup>
              }
            </select>
          </label>
        }
        <div class="cols-form">
          <label
            >Tipo
            <select name="type" [(ngModel)]="draft.type">
              <option value="service">Mão de obra</option>
              <option value="part">Peça</option>
            </select>
          </label>
          <label class="wide">Descrição <input name="description" required maxlength="300" [(ngModel)]="draft.description" /></label>
          <label>Quantidade <input name="quantity" type="number" required min="0.01" step="0.01" [(ngModel)]="draft.quantity" /></label>
          <label>Preço unitário (R$) <input name="unit_price" type="number" required min="0" step="0.01" [(ngModel)]="draft.unit_price" /></label>
        </div>
        <div><button [disabled]="form.invalid">Adicionar ao orçamento</button></div>
      </form>
    }
  `,
  styles: `
    .add-item {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--line);
    }
    .wide {
      grid-column: span 2;
    }
    @media (max-width: 560px) {
      .wide {
        grid-column: auto;
      }
    }
  `
})
export class ItemsEditorComponent implements OnInit {
  private readonly api = inject(Api);
  readonly items = input.required<ItemRow[]>();
  readonly editable = input(false);
  readonly added = output<ItemInput>();
  /** Índice do item removido na lista atual. */
  readonly removed = output<number>();
  readonly services = signal<ShopService[]>([]);
  readonly parts = signal<ShopPart[]>([]);
  readonly total = computed(() => this.items().reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
  pick = '';
  draft: ItemInput = { type: 'service', description: '', quantity: 1, unit_price: 0 };

  ngOnInit(): void {
    if (!this.editable()) return;
    void this.api
      .get<ShopService[]>('/catalog/services', undefined, silent())
      .then((list) => this.services.set(list.filter((item) => item.is_active)))
      .catch(() => undefined);
    void this.api
      .get<ShopPart[]>('/catalog/parts', undefined, silent())
      .then((list) => this.parts.set(list.filter((item) => item.is_active)))
      .catch(() => undefined);
  }

  applyPick(): void {
    const [kind, id] = this.pick.split(':');
    const service = kind === 's' ? this.services().find((item) => item.id === id) : undefined;
    const part = kind === 'p' ? this.parts().find((item) => item.id === id) : undefined;
    if (service) this.draft = { type: 'service', description: service.name, quantity: 1, unit_price: service.default_price };
    if (part) this.draft = { type: 'part', description: part.name, quantity: 1, unit_price: part.default_price };
  }

  add(): void {
    this.added.emit({
      ...this.draft,
      description: this.draft.description.trim(),
      quantity: Number(this.draft.quantity),
      unit_price: Number(this.draft.unit_price)
    });
    this.draft = { type: this.draft.type, description: '', quantity: 1, unit_price: 0 };
    this.pick = '';
  }
}
