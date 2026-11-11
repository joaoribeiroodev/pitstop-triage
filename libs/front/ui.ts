import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ORDER_STATUS_LABELS, OrderStatus } from '@pitstop/shared-types';
import { LoadingService, ToastService } from './core';
import { STATUS_TONE } from './format';

/** Placa do veículo no formato Mercosul — o identificador visual de todo atendimento. */
@Component({
  selector: 'ps-plate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="plate" [class.plate-lg]="large()" [attr.aria-label]="'Placa ' + spaced()"
    ><span>{{ display() }}</span></span
  >`
})
export class PlateComponent {
  readonly value = input.required<string>();
  readonly large = input(false);
  readonly display = computed(() => {
    const plate = this.value().toUpperCase();
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) ? `${plate.slice(0, 3)} ${plate.slice(3)}` : plate;
  });
  readonly spaced = computed(() => this.value().split('').join(' '));
}

@Component({
  selector: 'ps-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="status" [attr.data-tone]="tone()">{{ label() }}</span>`
})
export class StatusComponent {
  readonly value = input.required<OrderStatus>();
  readonly tone = computed(() => STATUS_TONE[this.value()]);
  readonly label = computed(() => ORDER_STATUS_LABELS[this.value()]);
}

@Component({
  selector: 'ps-feedback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading.active()) {
      <div class="loading-bar" role="progressbar" aria-label="Carregando"></div>
    }
    <div class="toasts" aria-live="polite">
      @for (toast of toasts.items(); track toast.id) {
        <div [attr.role]="toast.kind === 'error' ? 'alert' : 'status'">
          <button type="button" class="toast" [attr.data-kind]="toast.kind" title="Fechar aviso" (click)="toasts.dismiss(toast.id)">{{ toast.text }}</button>
        </div>
      }
    </div>
  `
})
export class FeedbackComponent {
  readonly toasts = inject(ToastService);
  readonly loading = inject(LoadingService);
}
