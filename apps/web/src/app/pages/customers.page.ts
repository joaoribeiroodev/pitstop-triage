import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent, StatusComponent } from '@front/ui';
import type { Customer, Paginated, ServiceOrderSummary, Vehicle } from '@pitstop/shared-types';
import { VehicleFormComponent } from '../ui/vehicle-form.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Relacionamento</span>
          <h1>Clientes</h1>
        </header>
        @if (canWrite) {
          <button type="button" class="btn-primary" (click)="dialog.showModal()">Novo cliente</button>
        }
      </div>
      <form class="row" role="search" (ngSubmit)="load(1)">
        <label class="grow"
          ><span class="sr-only">Buscar</span>
          <input type="search" name="q" placeholder="Buscar por nome ou telefone" [(ngModel)]="q" />
        </label>
        <button>Buscar</button>
      </form>

      <div class="sheet sheet-flush">
        <ul class="list">
          @for (customer of page()?.data; track customer.id) {
            <li>
              <a class="list-link" [routerLink]="['/customers', customer.id]">
                <span
                  ><strong>{{ customer.name }}</strong
                  ><br /><small>{{ customer.phone | phone }}</small></span
                >
                <small>{{ customer.vehicles_count }} {{ customer.vehicles_count === 1 ? 'veículo' : 'veículos' }}</small>
              </a>
            </li>
          } @empty {
            <li class="empty">
              {{ q ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente cadastrado ainda. Cadastre o primeiro para abrir uma triagem.' }}
            </li>
          }
        </ul>
      </div>
      @if (page(); as p) {
        @if (p.total > p.pageSize) {
          <div class="row-between">
            <button type="button" [disabled]="p.page === 1" (click)="load(p.page - 1)">Anteriores</button>
            <small>{{ p.total }} clientes, página {{ p.page }}</small>
            <button type="button" [disabled]="p.page * p.pageSize >= p.total" (click)="load(p.page + 1)">Próximos</button>
          </div>
        }
      }
    </div>

    <dialog #dialog>
      <form class="stack" (ngSubmit)="create()">
        <h2>Novo cliente</h2>
        <label>Nome <input name="name" required minlength="2" [(ngModel)]="draft.name" /></label>
        <label>Telefone com DDD <input name="phone" inputmode="tel" [(ngModel)]="draft.phone" /></label>
        <label>E-mail (opcional) <input name="email" type="email" [(ngModel)]="draft.email" /></label>
        <div class="row">
          <button class="btn-primary">Cadastrar cliente</button>
          <button type="button" (click)="dialog.close()">Cancelar</button>
        </div>
      </form>
    </dialog>
  `
})
export class CustomersPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly canWrite = inject(AuthService).hasRole('owner', 'manager', 'receptionist');
  readonly page = signal<Paginated<Customer> | null>(null);
  q = '';
  draft = { name: '', phone: '', email: '' };

  ngOnInit(): void {
    void this.load(1);
  }

  async load(page: number): Promise<void> {
    this.page.set(await this.api.get<Paginated<Customer>>('/customers', { q: this.q, page }));
  }

  async create(): Promise<void> {
    const customer = await this.api.post<Customer>('/customers', {
      name: this.draft.name,
      phone: this.draft.phone || undefined,
      email: this.draft.email || undefined
    });
    await this.router.navigate(['/customers', customer.id]);
  }
}

type CustomerDetail = Customer & { vehicles: Vehicle[]; orders: ServiceOrderSummary[] };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PlateComponent, StatusComponent, VehicleFormComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (customer(); as c) {
      <div class="page">
        <div class="row-between">
          <div>
            <a routerLink="/customers">Clientes</a>
            <h1>{{ c.name }}</h1>
          </div>
          @if (canWrite && !c.anonymized_at) {
            <button type="button" (click)="editing.set(!editing())">{{ editing() ? 'Fechar edição' : 'Editar dados' }}</button>
          }
        </div>

        @if (c.anonymized_at) {
          <p class="notice">Dados pessoais anonimizados em {{ c.anonymized_at | day }} a pedido do titular. O histórico de serviços foi mantido.</p>
        } @else if (editing()) {
          <form class="sheet stack" (ngSubmit)="save()">
            <div class="cols-form">
              <label>Nome <input name="name" required [(ngModel)]="form.name" /></label>
              <label>Telefone <input name="phone" inputmode="tel" [(ngModel)]="form.phone" /></label>
              <label>E-mail <input name="email" type="email" [(ngModel)]="form.email" /></label>
              <label>CPF/CNPJ <input name="document" inputmode="numeric" [(ngModel)]="form.document" /></label>
            </div>
            <label>Observações <textarea name="notes" [(ngModel)]="form.notes"></textarea></label>
            <div><button class="btn-primary">Salvar alterações</button></div>
          </form>
        } @else {
          <div class="sheet cols-form">
            <div><small>Telefone</small><br />{{ c.phone | phone }}</div>
            <div><small>E-mail</small><br />{{ c.email || '—' }}</div>
            <div><small>CPF/CNPJ</small><br />{{ c.document || '—' }}</div>
            @if (c.notes) {
              <div style="grid-column: 1 / -1"><small>Observações</small><br />{{ c.notes }}</div>
            }
          </div>
        }

        <section class="stack-sm">
          <div class="row-between">
            <h2>Veículos</h2>
            @if (canWrite && !c.anonymized_at) {
              <button type="button" (click)="addingVehicle.set(!addingVehicle())">{{ addingVehicle() ? 'Cancelar' : 'Adicionar veículo' }}</button>
            }
          </div>
          @if (addingVehicle()) {
            <div class="sheet"><ps-vehicle-form [customerId]="c.id" (saved)="vehicleSaved()" /></div>
          }
          <div class="sheet sheet-flush">
            <ul class="list">
              @for (vehicle of c.vehicles; track vehicle.id) {
                <li>
                  <a class="list-link" [routerLink]="['/vehicles', vehicle.id]">
                    <span class="row"><ps-plate [value]="vehicle.plate" /> {{ vehicle.brand }} {{ vehicle.model }} {{ vehicle.year }}</span>
                  </a>
                </li>
              } @empty {
                <li class="empty">Nenhum veículo cadastrado para este cliente.</li>
              }
            </ul>
          </div>
        </section>

        <section class="stack-sm">
          <h2>Ordens de serviço</h2>
          <div class="sheet sheet-flush">
            <ul class="list">
              @for (order of c.orders; track order.id) {
                <li>
                  <a class="list-link" [routerLink]="['/service-orders', order.id]">
                    <span
                      ><strong>OS {{ order.order_number }}</strong
                      >, {{ order.opened_at | day }}<br /><small>{{ order.vehicle_plate }} {{ order.vehicle_label }}</small></span
                    >
                    <span class="row"
                      ><span class="num">{{ order.total_amount | brl }}</span
                      ><ps-status [value]="order.status"
                    /></span>
                  </a>
                </li>
              } @empty {
                <li class="empty">Nenhuma ordem de serviço para este cliente.</li>
              }
            </ul>
          </div>
        </section>

        @if (isOwner && !c.anonymized_at) {
          <section class="sheet stack-sm">
            <h3>Privacidade (LGPD)</h3>
            <p class="muted">Use quando o cliente pedir uma cópia dos dados ou a eliminação deles.</p>
            <div class="row">
              <button type="button" (click)="exportData()">Baixar dados do cliente</button>
              <button type="button" class="btn-danger" (click)="anonymize()">Anonimizar cliente</button>
            </div>
          </section>
        }
      </div>
    }
  `
})
export class CustomerDetailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  readonly canWrite = this.auth.hasRole('owner', 'manager', 'receptionist');
  readonly isOwner = this.auth.hasRole('owner');
  readonly customer = signal<CustomerDetail | null>(null);
  readonly editing = signal(false);
  readonly addingVehicle = signal(false);
  form = { name: '', phone: '', email: '', document: '', notes: '' };

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const customer = await this.api.get<CustomerDetail>(`/customers/${this.id()}`);
    this.customer.set(customer);
    this.form = {
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      document: customer.document ?? '',
      notes: customer.notes ?? ''
    };
  }

  async save(): Promise<void> {
    const { email, ...rest } = this.form;
    await this.api.patch(`/customers/${this.id()}`, email ? { ...rest, email } : rest);
    this.toast.ok('Alterações salvas');
    this.editing.set(false);
    await this.load();
  }

  async vehicleSaved(): Promise<void> {
    this.addingVehicle.set(false);
    await this.load();
  }

  async exportData(): Promise<void> {
    const data = await this.api.get<unknown>(`/customers/${this.id()}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cliente-${this.id()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async anonymize(): Promise<void> {
    const sure = confirm('Anonimizar este cliente? Nome, telefone, e-mail, documento e placas serão apagados. Isso não pode ser desfeito.');
    if (!sure) return;
    await this.api.post(`/customers/${this.id()}/anonymize`, { confirm: true });
    this.toast.ok('Cliente anonimizado');
    await this.load();
  }
}
