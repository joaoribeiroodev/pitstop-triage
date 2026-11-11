import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent } from '@front/ui';
import type { Customer, Paginated, Vehicle } from '@pitstop/shared-types';
import { VehicleFormComponent } from './vehicle-form.component';

type CustomerWithVehicles = Customer & { vehicles: Vehicle[] };

/**
 * Escolha de cliente + veículo para abrir um atendimento.
 * Um campo só: a recepção digita a placa, o nome ou o telefone e segue; se não existir, cadastra ali mesmo.
 */
@Component({
  selector: 'ps-vehicle-picker',
  standalone: true,
  imports: [FormsModule, PlateComponent, VehicleFormComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <form class="row" role="search" (ngSubmit)="search()">
        <label class="grow"
          >Placa, nome ou telefone do cliente
          <input name="term" type="search" autocomplete="off" placeholder="Ex.: ABC1D23 ou Marina" [(ngModel)]="term" />
        </label>
        <button class="btn-primary" style="align-self: end">Buscar</button>
      </form>

      @if (searched()) {
        @if (vehicles().length) {
          <section class="stack-sm">
            <h3>Veículos encontrados</h3>
            <div class="sheet sheet-flush">
              <ul class="list">
                @for (vehicle of vehicles(); track vehicle.id) {
                  <li>
                    <button type="button" class="list-link pick" (click)="picked.emit(vehicle)">
                      <span class="row"
                        ><ps-plate [value]="vehicle.plate" /> <span>{{ vehicle.brand }} {{ vehicle.model }} {{ vehicle.year }}</span></span
                      >
                      <small>{{ vehicle.customer_name }}</small>
                    </button>
                  </li>
                }
              </ul>
            </div>
          </section>
        }

        @if (customers().length && !customer()) {
          <section class="stack-sm">
            <h3>Clientes encontrados</h3>
            <div class="sheet sheet-flush">
              <ul class="list">
                @for (found of customers(); track found.id) {
                  <li>
                    <button type="button" class="list-link pick" (click)="openCustomer(found.id)">
                      <span
                        ><strong>{{ found.name }}</strong
                        ><br /><small>{{ found.phone | phone }}</small></span
                      >
                      <small>{{ found.vehicles_count }} {{ found.vehicles_count === 1 ? 'veículo' : 'veículos' }}</small>
                    </button>
                  </li>
                }
              </ul>
            </div>
          </section>
        }

        @if (!vehicles().length && !customers().length && !customer() && !creating()) {
          <p class="notice">Nada encontrado para “{{ lastTerm() }}”. Cadastre o cliente para continuar.</p>
        }
      }

      @if (customer(); as c) {
        <section class="sheet stack">
          <div class="row-between">
            <h3>{{ c.name }}</h3>
            <button type="button" class="btn-quiet" (click)="customer.set(null)">Trocar cliente</button>
          </div>
          @if (c.vehicles.length) {
            <ul class="list">
              @for (vehicle of c.vehicles; track vehicle.id) {
                <li>
                  <button type="button" class="list-link pick" (click)="pickFrom(c, vehicle)">
                    <span class="row"
                      ><ps-plate [value]="vehicle.plate" /> <span>{{ vehicle.brand }} {{ vehicle.model }} {{ vehicle.year }}</span></span
                    >
                    <small>Escolher</small>
                  </button>
                </li>
              }
            </ul>
          }
          <h3>{{ c.vehicles.length ? 'Ou cadastre outro veículo' : 'Cadastre o veículo' }}</h3>
          <ps-vehicle-form [customerId]="c.id" [initialPlate]="plateGuess()" (saved)="pickFrom(c, $event)" />
        </section>
      } @else if (creating()) {
        <form class="sheet stack" (ngSubmit)="createCustomer()">
          <h3>Novo cliente</h3>
          <div class="cols-form">
            <label>Nome <input name="name" required minlength="2" [(ngModel)]="draft.name" /></label>
            <label>Telefone com DDD <input name="phone" inputmode="tel" [(ngModel)]="draft.phone" /></label>
          </div>
          <div class="row">
            <button class="btn-primary">Cadastrar e continuar</button>
            <button type="button" (click)="creating.set(false)">Cancelar</button>
          </div>
        </form>
      } @else {
        <div><button type="button" (click)="startCreating()">Cadastrar novo cliente</button></div>
      }
    </div>
  `,
  styles: `
    .pick {
      width: 100%;
      border: 0;
      border-radius: 0;
      text-align: left;
      font-weight: 400;
    }
  `
})
export class VehiclePickerComponent {
  private readonly api = inject(Api);
  readonly picked = output<Vehicle>();
  readonly vehicles = signal<Vehicle[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly customer = signal<CustomerWithVehicles | null>(null);
  readonly searched = signal(false);
  readonly creating = signal(false);
  readonly lastTerm = signal('');
  term = '';
  draft = { name: '', phone: '' };

  /** Se a busca parecia uma placa, ela já vem preenchida no cadastro do veículo. */
  plateGuess(): string {
    const compact = this.lastTerm()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(compact) ? compact : '';
  }

  async search(): Promise<void> {
    const q = this.term.trim();
    if (!q) return;
    const [vehicles, customers] = await Promise.all([
      this.api.get<Paginated<Vehicle>>('/vehicles', { q, pageSize: 8 }),
      this.api.get<Paginated<Customer>>('/customers', { q, pageSize: 8 })
    ]);
    this.vehicles.set(vehicles.data);
    this.customers.set(customers.data);
    this.customer.set(null);
    this.lastTerm.set(q);
    this.searched.set(true);
  }

  async openCustomer(id: string): Promise<void> {
    this.customer.set(await this.api.get<CustomerWithVehicles>(`/customers/${id}`));
  }

  startCreating(): void {
    const term = this.term.trim();
    const digits = term.replace(/\D/g, '');
    this.draft = this.plateGuess() ? { name: '', phone: '' } : digits.length >= 10 ? { name: '', phone: digits } : { name: term, phone: '' };
    this.creating.set(true);
  }

  async createCustomer(): Promise<void> {
    const created = await this.api.post<Customer>('/customers', { name: this.draft.name, phone: this.draft.phone || undefined });
    this.creating.set(false);
    this.customer.set({ ...created, vehicles: [] });
  }

  pickFrom(customer: Customer, vehicle: Vehicle): void {
    this.picked.emit({ ...vehicle, customer_id: customer.id, customer_name: customer.name, customer_phone: customer.phone });
  }
}
