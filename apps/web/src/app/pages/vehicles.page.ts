import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent, StatusComponent } from '@front/ui';
import type { Paginated, ServiceOrderSummary, Vehicle } from '@pitstop/shared-types';
import { VehicleFormComponent } from '../ui/vehicle-form.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PlateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <span class="eyebrow">Frota atendida</span>
        <h1>Veículos</h1>
        <p>Cada carro guarda o histórico de tudo o que já foi feito nele aqui.</p>
      </header>
      <form class="row" role="search" (ngSubmit)="load(1)">
        <label class="grow"
          ><span class="sr-only">Buscar</span>
          <input type="search" name="q" placeholder="Buscar por placa, marca ou modelo" [(ngModel)]="q" />
        </label>
        <button>Buscar</button>
      </form>
      <div class="sheet sheet-flush">
        <ul class="list">
          @for (vehicle of page()?.data; track vehicle.id) {
            <li>
              <a class="list-link" [routerLink]="['/vehicles', vehicle.id]">
                <span class="row"
                  ><ps-plate [value]="vehicle.plate" /> <span>{{ vehicle.brand }} {{ vehicle.model }} {{ vehicle.year }}</span></span
                >
                <small>{{ vehicle.customer_name }}</small>
              </a>
            </li>
          } @empty {
            <li class="empty">
              {{ q ? 'Nenhum veículo encontrado para essa busca.' : 'Nenhum veículo cadastrado. Os veículos são cadastrados na ficha do cliente.' }}
            </li>
          }
        </ul>
      </div>
      @if (page(); as p) {
        @if (p.total > p.pageSize) {
          <div class="row-between">
            <button type="button" [disabled]="p.page === 1" (click)="load(p.page - 1)">Anteriores</button>
            <small>{{ p.total }} veículos, página {{ p.page }}</small>
            <button type="button" [disabled]="p.page * p.pageSize >= p.total" (click)="load(p.page + 1)">Próximos</button>
          </div>
        }
      }
    </div>
  `
})
export class VehiclesPage implements OnInit {
  private readonly api = inject(Api);
  readonly page = signal<Paginated<Vehicle> | null>(null);
  q = '';

  ngOnInit(): void {
    void this.load(1);
  }

  async load(page: number): Promise<void> {
    this.page.set(await this.api.get<Paginated<Vehicle>>('/vehicles', { q: this.q, page }));
  }
}

type VehicleDetail = Vehicle & { orders: ServiceOrderSummary[] };

@Component({
  standalone: true,
  imports: [RouterLink, PlateComponent, StatusComponent, VehicleFormComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vehicle(); as v) {
      <div class="page">
        <div class="row-between">
          <div class="stack-sm">
            <a routerLink="/vehicles">Veículos</a>
            <div class="row">
              <ps-plate [value]="v.plate" [large]="true" />
              <h1>{{ v.brand }} {{ v.model }} {{ v.year }}</h1>
            </div>
            <p>
              Cliente: <a [routerLink]="['/customers', v.customer_id]">{{ v.customer_name }}</a
              >, {{ v.customer_phone | phone }}
            </p>
          </div>
          @if (canWrite) {
            <div class="row">
              @if (auth.hasFeature('triage')) {
                <a class="btn btn-primary" routerLink="/triage/new" [queryParams]="{ vehicleId: v.id }">Nova triagem</a>
              }
              <button type="button" (click)="editing.set(!editing())">{{ editing() ? 'Fechar edição' : 'Editar veículo' }}</button>
            </div>
          }
        </div>

        @if (editing()) {
          <div class="sheet"><ps-vehicle-form [vehicle]="v" (saved)="saved()" /></div>
        } @else {
          <div class="sheet cols-form">
            <div><small>Cor</small><br />{{ v.color || '—' }}</div>
            <div><small>Combustível</small><br />{{ v.fuel_type || '—' }}</div>
            <div><small>Quilometragem</small><br />{{ v.current_mileage ?? '—' }}</div>
            <div><small>Chassi</small><br />{{ v.vin || '—' }}</div>
          </div>
        }

        <section class="stack-sm">
          <h2>Histórico de serviços</h2>
          <div class="sheet sheet-flush">
            <ul class="list">
              @for (order of v.orders; track order.id) {
                <li>
                  <a class="list-link" [routerLink]="['/service-orders', order.id]">
                    <span
                      ><strong>OS {{ order.order_number }}</strong
                      >, aberta em {{ order.opened_at | day }} <br /><small>{{
                        order.assigned_mechanic_name ? 'Mecânico: ' + order.assigned_mechanic_name : 'Sem mecânico atribuído'
                      }}</small></span
                    >
                    <span class="row"
                      ><span class="num">{{ order.total_amount | brl }}</span
                      ><ps-status [value]="order.status"
                    /></span>
                  </a>
                </li>
              } @empty {
                <li class="empty">Primeira visita: este veículo ainda não tem ordens de serviço.</li>
              }
            </ul>
          </div>
        </section>
      </div>
    }
  `
})
export class VehicleDetailPage implements OnInit {
  private readonly api = inject(Api);
  readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  readonly canWrite = this.auth.hasRole('owner', 'manager', 'receptionist');
  readonly vehicle = signal<VehicleDetail | null>(null);
  readonly editing = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.vehicle.set(await this.api.get<VehicleDetail>(`/vehicles/${this.id()}`));
  }

  async saved(): Promise<void> {
    this.editing.set(false);
    await this.load();
  }
}
