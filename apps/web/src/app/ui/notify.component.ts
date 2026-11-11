import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { Api, silent, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import type { NotificationEvent, NotificationLogEntry, NotificationPreview } from '@pitstop/shared-types';
import { copyText } from './clipboard';

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  quote_pending: 'Orçamento pronto',
  status_update: 'Novidade no serviço',
  vehicle_ready: 'Veículo pronto'
};
const CHANNEL_LABELS: Record<NotificationLogEntry['channel'], string> = { whatsapp_link: 'mensagem pronta', whatsapp_api: 'envio automático' };
const RESULT_LABELS: Record<NotificationLogEntry['status'], string> = { sent: 'ok', failed: 'falhou', skipped: 'não enviado' };

/** Aviso ao cliente pelo WhatsApp: monta a mensagem com o modelo da oficina e o link de acompanhamento. */
@Component({
  selector: 'ps-notify-customer',
  standalone: true,
  imports: [...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sheet stack-sm">
      <span class="mono-label signal">WhatsApp</span>
      <h3>Avisar o cliente</h3>
      <p class="muted">A mensagem sai com o texto da oficina e um link para o cliente acompanhar o serviço.</p>
      <div class="row">
        <button type="button" (click)="prepare('status_update')">Novidade no serviço</button>
        <button type="button" (click)="prepare('vehicle_ready')">Veículo pronto</button>
      </div>
      @if (preview(); as ready) {
        <textarea readonly rows="4" aria-label="Mensagem pronta" [value]="ready.message"></textarea>
        <div class="row">
          @if (ready.whatsapp_url) {
            <a class="btn btn-go" [href]="ready.whatsapp_url" target="_blank" rel="noopener">Abrir no WhatsApp</a>
          } @else {
            <small>O cliente não tem um celular válido no cadastro: copie a mensagem e envie por outro canal.</small>
          }
          <button type="button" (click)="copy(ready.message)">Copiar mensagem</button>
        </div>
      }
      @if (history().length) {
        <details>
          <summary>Avisos já gerados ({{ history().length }})</summary>
          <ul class="list">
            @for (entry of history(); track entry.id) {
              <li>
                {{ events[entry.event] }}, {{ channels[entry.channel] }}: <strong>{{ results[entry.status] }}</strong> <br /><small
                  >{{ entry.created_at | moment }}{{ entry.detail ? ' · ' + entry.detail : '' }}</small
                >
              </li>
            }
          </ul>
        </details>
      }
    </section>
  `
})
export class NotifyCustomerComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly orderId = input.required<string>();
  readonly preview = signal<NotificationPreview | null>(null);
  readonly history = signal<NotificationLogEntry[]>([]);
  readonly events = EVENT_LABELS;
  readonly channels = CHANNEL_LABELS;
  readonly results = RESULT_LABELS;

  ngOnInit(): void {
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.api.get<NotificationLogEntry[]>(`/notifications/orders/${this.orderId()}/history`, undefined, silent()));
    } catch {
      this.history.set([]);
    }
  }

  async prepare(event: NotificationEvent): Promise<void> {
    this.preview.set(await this.api.post<NotificationPreview>(`/notifications/orders/${this.orderId()}/preview`, { event }));
    await this.loadHistory();
  }

  async copy(text: string): Promise<void> {
    if (await copyText(text)) this.toast.ok('Mensagem copiada');
  }
}
