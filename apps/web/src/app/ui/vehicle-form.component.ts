import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage, silent, ToastService } from '@front/core';
import type { Vehicle } from '@pitstop/shared-types';

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
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="stack" (ngSubmit)="save()">
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
