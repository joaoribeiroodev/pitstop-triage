import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, silent, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { FIPE_VEHICLE_TYPE_LABELS, FIPE_VEHICLE_TYPES, type FipeOption, type FipePrice, type FipeVehicleType, type Vehicle } from '@pitstop/shared-types';

interface PlateLookup {
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
}

/** Cadastro/edição de veículo. A consulta por placa é um atalho: se falhar, o preenchimento segue manual. */
@Component({
  selector: 'ps-vehicle-form',
  standalone: true,
  imports: [FormsModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="stack" (ngSubmit)="save()">
      <details class="fipe" (toggle)="openFipe($event)">
        <summary>Buscar na tabela FIPE</summary>
        <div class="cols-form">
          <label
            >Tipo
            <select name="fipe_type" [ngModel]="fipeType()" (ngModelChange)="setFipeType($event)">
              @for (type of fipeTypes; track type) {
                <option [value]="type">{{ fipeTypeLabels[type] }}</option>
              }
            </select>
          </label>
          <label
            >Marca (FIPE)
            <select name="fipe_brand" [ngModel]="fipeBrand()" (ngModelChange)="setFipeBrand($event)" [disabled]="!fipeBrands().length">
              <option value="">Escolha a marca</option>
              @for (option of fipeBrands(); track option.code) {
                <option [value]="option.code">{{ option.name }}</option>
              }
            </select>
          </label>
          <label
            >Modelo (FIPE)
            <select name="fipe_model" [ngModel]="fipeModel()" (ngModelChange)="setFipeModel($event)" [disabled]="!fipeModels().length">
              <option value="">Escolha o modelo</option>
              @for (option of fipeModels(); track option.code) {
                <option [value]="option.code">{{ option.name }}</option>
              }
            </select>
          </label>
          <label
            >Ano (FIPE)
            <select name="fipe_year" [ngModel]="fipeYear()" (ngModelChange)="setFipeYear($event)" [disabled]="!fipeYears().length">
              <option value="">Escolha o ano</option>
              @for (option of fipeYears(); track option.code) {
                <option [value]="option.code">{{ option.name }}</option>
              }
            </select>
          </label>
        </div>
        @if (fipePrice(); as found) {
          <p class="notice notice-done" role="status">
            {{ found.brand }} {{ found.model }}{{ found.year ? ', ' + found.year : '' }}. Valor de referência FIPE:
            <strong>{{ found.price === null ? 'não informado' : (found.price | brl) }}</strong>
            @if (found.reference_month) {
              ({{ found.reference_month }})
            }
          </p>
        }
        @if (fipeError()) {
          <p class="notice notice-wait" role="status">{{ fipeError() }}</p>
        }
      </details>
      <div class="cols-form">
        <label
          >Placa
          <input name="plate" required maxlength="8" autocapitalize="characters" placeholder="ABC1D23" [(ngModel)]="form.plate" (blur)="lookup()" />
        </label>
        <label>Marca <input name="brand" [(ngModel)]="form.brand" /></label>
        <label>Modelo <input name="model" [(ngModel)]="form.model" /></label>
        <label>Ano <input name="year" type="number" min="1900" max="2100" [(ngModel)]="form.year" /></label>
        <label>Cor <input name="color" [(ngModel)]="form.color" /></label>
        <label
          >Combustível
          <select name="fuel_type" [(ngModel)]="form.fuel_type">
            <option value="">Não informado</option>
            <option>Flex</option>
            <option>Gasolina</option>
            <option>Etanol</option>
            <option>Diesel</option>
            <option>GNV</option>
            <option>Híbrido</option>
            <option>Elétrico</option>
          </select>
        </label>
        <label>Quilometragem <input name="km" type="number" min="0" [(ngModel)]="form.current_mileage" /></label>
        <label>Chassi (VIN) <input name="vin" maxlength="17" [(ngModel)]="form.vin" /></label>
      </div>
      @if (hint()) {
        <p class="muted" role="status">{{ hint() }}</p>
      }
      <div>
        <button class="btn-primary">{{ vehicle() ? 'Salvar veículo' : 'Cadastrar veículo' }}</button>
      </div>
    </form>
  `,
  styles: `
    .fipe {
      border: 1px dashed var(--line);
      border-radius: 0.75rem;
      padding: 0.75rem 1rem;
    }
    .fipe summary {
      cursor: pointer;
      color: var(--coverall);
      font-weight: 600;
    }
    .fipe[open] summary {
      margin-bottom: 0.75rem;
    }
  `
})
export class VehicleFormComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly customerId = input<string>();
  readonly vehicle = input<Vehicle>();
  readonly initialPlate = input<string>('');
  readonly saved = output<Vehicle>();
  readonly hint = signal('');
  // ── tabela FIPE: marca → modelo → ano preenchem o cadastro ──
  readonly fipeTypes = FIPE_VEHICLE_TYPES;
  readonly fipeTypeLabels = FIPE_VEHICLE_TYPE_LABELS;
  readonly fipeType = signal<FipeVehicleType>('cars');
  readonly fipeBrands = signal<FipeOption[]>([]);
  readonly fipeModels = signal<FipeOption[]>([]);
  readonly fipeYears = signal<FipeOption[]>([]);
  readonly fipeBrand = signal('');
  readonly fipeModel = signal('');
  readonly fipeYear = signal('');
  readonly fipePrice = signal<FipePrice | null>(null);
  readonly fipeError = signal('');
  form = { plate: '', brand: '', model: '', year: null as number | null, color: '', fuel_type: '', current_mileage: null as number | null, vin: '' };

  ngOnInit(): void {
    const vehicle = this.vehicle();
    if (vehicle) {
      this.form = {
        plate: vehicle.plate,
        brand: vehicle.brand ?? '',
        model: vehicle.model ?? '',
        year: vehicle.year,
        color: vehicle.color ?? '',
        fuel_type: vehicle.fuel_type ?? '',
        current_mileage: vehicle.current_mileage,
        vin: vehicle.vin ?? ''
      };
    } else {
      this.form.plate = this.initialPlate();
    }
  }

  private async fipe<T>(path: string): Promise<T | null> {
    this.fipeError.set('');
    try {
      return await this.api.get<T>(`/fipe/${this.fipeType()}/${path}`, undefined, silent());
    } catch (error) {
      this.fipeError.set(errorMessage(error));
      return null;
    }
  }

  /** As marcas só são buscadas quando a pessoa abre a seção. */
  openFipe(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.fipeBrands().length) void this.setFipeType(this.fipeType());
  }

  /** Limpa as escolhas a partir de um nível (cada nível depende do anterior). */
  private resetFipe(from: 'brand' | 'model' | 'year'): void {
    if (from === 'brand') {
      this.fipeBrand.set('');
      this.fipeBrands.set([]);
    }
    if (from !== 'year') {
      if (from === 'brand') this.fipeModels.set([]);
      this.fipeModel.set('');
      this.fipeYears.set([]);
    }
    this.fipeYear.set('');
    this.fipePrice.set(null);
  }

  async setFipeType(type: FipeVehicleType): Promise<void> {
    this.fipeType.set(type);
    this.resetFipe('brand');
    this.fipeBrands.set((await this.fipe<FipeOption[]>('brands')) ?? []);
  }

  async setFipeBrand(code: string): Promise<void> {
    this.resetFipe('model');
    this.fipeModels.set([]);
    this.fipeBrand.set(code);
    if (code) this.fipeModels.set((await this.fipe<FipeOption[]>(`brands/${code}/models`)) ?? []);
  }

  async setFipeModel(code: string): Promise<void> {
    this.resetFipe('model');
    this.fipeModel.set(code);
    if (code) this.fipeYears.set((await this.fipe<FipeOption[]>(`brands/${this.fipeBrand()}/models/${code}/years`)) ?? []);
  }

  async setFipeYear(code: string): Promise<void> {
    this.resetFipe('year');
    this.fipeYear.set(code);
    if (!code) return;
    const found = await this.fipe<FipePrice>(`brands/${this.fipeBrand()}/models/${this.fipeModel()}/years/${code}`);
    if (!found) return;
    this.fipePrice.set(found);
    const fuels = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'GNV', 'Híbrido', 'Elétrico'];
    const fuel = fuels.find((option) => option.toLowerCase() === (found.fuel ?? '').toLowerCase());
    this.form = {
      ...this.form,
      brand: found.brand ?? this.form.brand,
      model: found.model ?? this.form.model,
      // a FIPE usa 32000 para "zero km"
      year: found.year && found.year <= 2100 ? found.year : this.form.year,
      fuel_type: fuel ?? this.form.fuel_type
    };
    this.hint.set('Marca, modelo e ano preenchidos pela tabela FIPE. Confira antes de salvar.');
  }

  async lookup(): Promise<void> {
    const plate = this.form.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.vehicle() || plate.length !== 7 || this.form.brand || this.form.model) return;
    try {
      const found = await this.api.get<PlateLookup>(`/vehicles/lookup/${plate}`, undefined, silent());
      this.form = { ...this.form, brand: found.brand ?? '', model: found.model ?? '', year: found.year, color: found.color ?? '' };
      this.hint.set('Dados preenchidos pela consulta da placa. Confira antes de salvar.');
    } catch (error) {
      this.hint.set(errorMessage(error));
    }
  }

  async save(): Promise<void> {
    const body = {
      plate: this.form.plate,
      brand: this.form.brand || undefined,
      model: this.form.model || undefined,
      year: this.form.year ?? undefined,
      color: this.form.color || undefined,
      fuel_type: this.form.fuel_type || undefined,
      current_mileage: this.form.current_mileage ?? undefined,
      vin: this.form.vin || undefined
    };
    const current = this.vehicle();
    const vehicle = current
      ? await this.api.patch<Vehicle>(`/vehicles/${current.id}`, body)
      : await this.api.post<Vehicle>('/vehicles', { ...body, customer_id: this.customerId() });
    this.toast.ok(current ? 'Veículo salvo' : 'Veículo cadastrado');
    this.saved.emit(vehicle);
  }
}
