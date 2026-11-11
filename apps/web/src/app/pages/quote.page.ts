import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import type { Quote, SendQuoteResponse } from '@pitstop/shared-types';
import { copyText } from '../ui/clipboard';
import { ItemInput, ItemRow, ItemsEditorComponent } from '../ui/items-editor.component';

/** Uma versão de orçamento: rascunho editável ou registro congelado do que foi enviado ao cliente. */
@Component({
  standalone: true,
  imports: [RouterLink, ItemsEditorComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (quote(); as q) {
      <div class="page">
        <div>
          <a [routerLink]="['/service-orders', q.service_order_id]">Voltar para a ordem de serviço</a>
          <div class="row-between">
            <h1>Orçamento, versão {{ q.version }}</h1>
            <span class="status" [attr.data-tone]="tone()">{{ q.status | quoteStatus }}</span>
          </div>
        </div>

        <section class="sheet stack">
          <ps-items-editor [items]="items()" [editable]="isDraft()" (added)="add($event)" (removed)="remove($event)" />
        </section>

        <section class="sheet cols-form">
          <div><small>Criado em</small><br />{{ q.created_at | moment }}</div>
          <div><small>Enviado em</small><br />{{ q.sent_at | moment }}</div>
          <div><small>Válido até</small><br />{{ q.expires_at | day }}</div>
          <div><small>Respondido em</small><br />{{ q.responded_at | moment }}</div>
          @if (q.response_notes) {
            <div style="grid-column: 1 / -1"><small>Observação da resposta</small><br />{{ q.response_notes }}</div>
          }
        </section>

        @if (sent(); as result) {
          <section class="sheet stack notice-done" role="status">
            <h2>Orçamento enviado para aprovação</h2>
            <input readonly aria-label="Link de aprovação" [value]="result.portal_url" (focus)="$any($event.target).select()" />
            <div class="row">
              <button type="button" class="btn-primary" (click)="copy(result.portal_url, 'Link copiado')">Copiar link</button>
              <button type="button" (click)="copy(result.message, 'Mensagem copiada')">Copiar mensagem pronta</button>
              @if (result.whatsapp_url) {
                <a class="btn btn-go" [href]="result.whatsapp_url" target="_blank" rel="noopener">Abrir no WhatsApp</a>
              }
            </div>
          </section>
        } @else if (canSend) {
          @if (isDraft()) {
            <div><button type="button" class="btn-primary btn-big" [disabled]="!items().length" (click)="send()">Gerar link de aprovação</button></div>
          } @else if (q.status === 'sent') {
            <div class="row">
              <button type="button" class="btn-go" (click)="respond('approve')">Registrar aprovação do cliente</button>
              <button type="button" class="btn-danger" (click)="respond('reject')">Registrar recusa do cliente</button>
            </div>
          }
        }
      </div>
    }
  `
})
export class QuotePage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  readonly canSend = inject(AuthService).hasRole('owner', 'manager', 'receptionist');
  readonly quote = signal<Quote | null>(null);
  readonly sent = signal<SendQuoteResponse | null>(null);
  readonly items = computed<ItemRow[]>(() => this.quote()?.items ?? []);
  readonly isDraft = computed(() => this.quote()?.status === 'draft');
  readonly tone = computed(() => ({ draft: 'idle', sent: 'wait', approved: 'done', rejected: 'stop', expired: 'idle' })[this.quote()?.status ?? 'draft']);

  async ngOnInit(): Promise<void> {
    this.quote.set(await this.api.get<Quote>(`/quotes/${this.id()}`));
  }

  private async replace(items: ItemInput[]): Promise<void> {
    const body = items.map(({ type, description, quantity, unit_price }) => ({ type, description, quantity, unit_price }));
    this.quote.set(await this.api.put<Quote>(`/quotes/${this.id()}/items`, { items: body }));
  }

  add(item: ItemInput): Promise<void> {
    return this.replace([...this.items(), item]);
  }

  remove(index: number): Promise<void> {
    return this.replace(this.items().filter((_, i) => i !== index));
  }

  async send(): Promise<void> {
    const result = await this.api.post<SendQuoteResponse>(`/quotes/${this.id()}/send`);
    this.sent.set(result);
    this.quote.set(result.quote);
  }

  async respond(decision: 'approve' | 'reject'): Promise<void> {
    const notes = prompt(decision === 'approve' ? 'Registrar aprovação. Opcional: como o cliente confirmou.' : 'Registrar recusa. Opcional: motivo.');
    if (notes === null) return;
    this.quote.set(await this.api.post<Quote>(`/quotes/${this.id()}/${decision}`, { notes: notes.trim() || undefined }));
    this.sent.set(null);
    this.toast.ok(decision === 'approve' ? 'Orçamento aprovado' : 'Recusa registrada');
  }

  async copy(text: string, done: string): Promise<void> {
    if (await copyText(text)) this.toast.ok(done);
  }
}
