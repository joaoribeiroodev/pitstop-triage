import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES, STATUS_TONE } from '@front/format';
import { PlateComponent } from '@front/ui';
import {
  canTransition,
  ORDER_STATUS_LABELS,
  OrderStatus,
  QUOTE_DRIVEN_STATUSES,
  type ServiceOrder,
  type ServiceOrderSummary,
  type TenantUser,
  type Vehicle
} from '@pitstop/shared-types';
import { VehiclePickerComponent } from '../ui/vehicle-picker.component';

/** Colunas do quadro, na ordem em que o veículo anda pela oficina. Canceladas ficam fora do quadro. */
const COLUMNS: OrderStatus[] = ['draft', 'diagnosis', 'awaiting_approval', 'rejected', 'approved', 'in_progress', 'completed', 'delivered'];

type Assignable = Pick<TenantUser, 'id' | 'full_name' | 'role'>;

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag, PlateComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide">
      <div class="row-between">
        <h1>Ordens de serviço</h1>
        @if (canOpen) {
          <div class="row">
            @if (auth.hasFeature('triage')) {
              <a class="btn btn-primary" routerLink="/triage/new">Nova triagem</a>
            }
            <a class="btn" routerLink="/service-orders/new">Abrir OS sem triagem</a>
          </div>
        }
      </div>

      <form class="row" role="search" (ngSubmit)="load()">
        <label class="grow"
          >Cliente, placa ou número da OS
          <input name="q" type="search" [(ngModel)]="filters.q" />
        </label>
        <label
          >Mecânico
          <select name="mechanic" [(ngModel)]="filters.mechanic_id" (ngModelChange)="load()">
            <option value="">Todos</option>
            @for (member of mechanics(); track member.id) {
              <option [value]="member.id">{{ member.full_name }}</option>
            }
          </select>
        </label>
        <label>Abertas desde <input name="from" type="date" [(ngModel)]="filters.from" (ngModelChange)="load()" /></label>
        <label>Até <input name="to" type="date" [(ngModel)]="filters.to" (ngModelChange)="load()" /></label>
        <button style="align-self: end">Filtrar</button>
      </form>

      <div class="board" cdkDropListGroup>
        @for (column of columns(); track column.status) {
          <section
            class="board-col"
            [attr.data-tone]="column.tone"
            [attr.aria-label]="column.label"
            cdkDropList
            [cdkDropListData]="column.status"
            (cdkDropListDropped)="drop($event)"
          >
            <h3>
              {{ column.label }} <small class="num">{{ column.orders.length }}</small>
            </h3>
            @for (order of column.orders; track order.id) {
              <a class="board-card" cdkDrag [cdkDragData]="order" [routerLink]="['/service-orders', order.id]">
                <span class="row-between"
                  ><ps-plate [value]="order.vehicle_plate" /><small class="num">OS {{ order.order_number }}</small></span
                >
                <strong>{{ order.customer_name }}</strong>
                <small>{{ order.vehicle_label }}</small>
                <span class="row-between">
                  <small>{{ order.assigned_mechanic_name || 'Sem mecânico' }}</small>
                  @if (order.total_amount) {
                    <small class="num">{{ order.total_amount | brl }}</small>
                  }
                </span>
              </a>
            } @empty {
              <small class="muted">Nenhuma OS aqui.</small>
            }
          </section>
        }
      </div>
      <p class="muted">
        Arraste um cartão para mudar o status. Envio e resposta de orçamento acontecem dentro da OS. Entregues há mais de 7 dias saem do quadro.
      </p>
    </div>
  `
})
export class OrdersBoardPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  readonly canOpen = this.auth.hasRole('owner', 'manager', 'receptionist');
  readonly orders = signal<ServiceOrderSummary[]>([]);
  readonly mechanics = signal<Assignable[]>([]);
  filters = { q: '', mechanic_id: '', from: '', to: '' };

  readonly columns = computed(() =>
    COLUMNS.map((status) => ({
      status,
      label: ORDER_STATUS_LABELS[status],
      tone: STATUS_TONE[status],
      orders: this.orders().filter((order) => order.status === status)
    }))
  );

  ngOnInit(): void {
    void this.load();
    void this.api.get<Assignable[]>('/users/assignable').then((team) => this.mechanics.set(team.filter((member) => member.role === 'mechanic')));
  }

  async load(): Promise<void> {
    this.orders.set(await this.api.get<ServiceOrderSummary[]>('/service-orders/board', this.filters));
  }

  async drop(event: CdkDragDrop<OrderStatus, OrderStatus, ServiceOrderSummary>): Promise<void> {
    const order = event.item.data;
    const to = event.container.data;
    if (order.status === to) return;
    if (QUOTE_DRIVEN_STATUSES.includes(to)) {
      this.toast.error(`"${ORDER_STATUS_LABELS[to]}" depende do orçamento. Abra a OS para enviar ou registrar a resposta do cliente.`);
      return;
    }
    if (!canTransition(order.status, to)) {
      this.toast.error(`Uma OS "${ORDER_STATUS_LABELS[order.status]}" não pode ir direto para "${ORDER_STATUS_LABELS[to]}".`);
      return;
    }
    // Move na tela já; se o backend recusar, o quadro é recarregado com o estado real.
    this.orders.update((list) => list.map((item) => (item.id === order.id ? { ...item, status: to } : item)));
    try {
      await this.api.post(`/service-orders/${order.id}/status`, { status: to });
      this.toast.ok(`OS ${order.order_number}: ${ORDER_STATUS_LABELS[to]}`);
    } catch {
      await this.load();
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PlateComponent, VehiclePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div>
        <a routerLink="/service-orders">Ordens de serviço</a>
        <h1>Abrir OS sem triagem</h1>
      </div>
      @if (vehicle(); as v) {
        <form class="sheet stack" (ngSubmit)="create()">
          <div class="row-between">
            <span class="row"
              ><ps-plate [value]="v.plate" /> <span>{{ v.brand }} {{ v.model }} {{ v.year }}, {{ v.customer_name }}</span></span
            >
            <button type="button" class="btn-quiet" (click)="vehicle.set(null)">Trocar</button>
          </div>
          <label
            >O que o cliente pediu ou relatou
            <textarea name="notes" maxlength="4000" placeholder="Ex.: revisão dos 60 mil km, troca de óleo" [(ngModel)]="notes"></textarea>
          </label>
          <label
            >Mecânico responsável (opcional)
            <select name="mechanic" [(ngModel)]="mechanicId">
              <option value="">Definir depois</option>
              @for (member of mechanics(); track member.id) {
                <option [value]="member.id">{{ member.full_name }}</option>
              }
            </select>
          </label>
          <div><button class="btn-primary btn-big">Abrir ordem de serviço</button></div>
        </form>
      } @else {
        <ps-vehicle-picker (picked)="vehicle.set($event)" />
      }
    </div>
  `
})
export class NewOrderPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly vehicle = signal<Vehicle | null>(null);
  readonly mechanics = signal<Assignable[]>([]);
  notes = '';
  mechanicId = '';

  ngOnInit(): void {
    void this.api.get<Assignable[]>('/users/assignable').then((team) => this.mechanics.set(team.filter((member) => member.role === 'mechanic')));
  }

  async create(): Promise<void> {
    const vehicle = this.vehicle();
    if (!vehicle) return;
    const order = await this.api.post<ServiceOrder>('/service-orders', {
      customer_id: vehicle.customer_id,
      vehicle_id: vehicle.id,
      free_form_notes: this.notes.trim() || undefined,
      assigned_mechanic_id: this.mechanicId || undefined
    });
    await this.router.navigate(['/service-orders', order.id]);
  }
}
