import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { anonymous, Api, errorMessage } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent, StatusComponent } from '@front/ui';
import type { PortalHistoryEntry, PortalOrderResponse } from '@pitstop/shared-types';

interface PortalIntro {
  shop_name: string;
  consent_required: boolean;
  privacy_policy_version: string;
}

/**
 * Portal do cliente: acesso somente pelo link tokenizado, sem sessão.
 * Mostra o veículo, o andamento, o orçamento pendente e o histórico do mesmo veículo. Nada além disso.
 */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PlateComponent, StatusComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="portal">
      @if (invalid()) {
        <h1>Link indisponível</h1>
        <p class="notice notice-wait">Este link é inválido ou expirou. Peça um novo link à oficina.</p>
      } @else {
        @if (intro(); as i) {
          @if (i.consent_required) {
            <header class="portal-head">
              <span class="muted">Acompanhamento do seu veículo</span>
              <h1>{{ i.shop_name }}</h1>
            </header>
            <section class="sheet stack">
              <h2>Antes de continuar</h2>
              <p>
                Para mostrar o andamento do serviço e o orçamento, a {{ i.shop_name }} trata seus dados de contato e os dados do veículo, apenas para este
                atendimento.
              </p>
              <p><a routerLink="/privacidade" target="_blank">Ler a política de privacidade</a> (versão {{ i.privacy_policy_version }}).</p>
              <button type="button" class="btn-primary btn-big" (click)="accept()">Li e concordo, continuar</button>
            </section>
          } @else {
            @if (data(); as d) {
              <header class="portal-head">
                <span class="muted">{{ d.shop.name }}</span>
                <div class="row">
                  <ps-plate [value]="d.vehicle.plate" [large]="true" />
                  <span>{{ d.vehicle.brand }} {{ d.vehicle.model }} {{ d.vehicle.year }}</span>
                </div>
                <div class="row-between">
                  <span>Ordem de serviço {{ d.order.number }}, aberta em {{ d.order.opened_at | day }}</span>
                  <ps-status [value]="d.order.status" />
                </div>
              </header>

              @if (feedback()) {
                <p class="notice notice-done" role="status">{{ feedback() }}</p>
              }

              @if (d.quote; as quote) {
                <section class="sheet stack" aria-labelledby="quote-title">
                  <h2 id="quote-title">Orçamento</h2>
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Serviço ou peça</th>
                          <th class="right">Qtd.</th>
                          <th class="right">Unitário</th>
                          <th class="right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (item of quote.items; track $index) {
                          <tr>
                            <td>
                              <small>{{ item.type === 'service' ? 'Serviço' : 'Peça' }}</small
                              ><br />{{ item.description }}
                            </td>
                            <td class="right num">{{ item.quantity }}</td>
                            <td class="right num">{{ item.unit_price | brl }}</td>
                            <td class="right num">{{ item.total | brl }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <div class="total-line">
                    <span>Total</span><span class="num">{{ quote.total_amount | brl }}</span>
                  </div>

                  @if (quote.can_respond) {
                    @if (rejecting()) {
                      <form class="stack" (ngSubmit)="respond('reject')">
                        <label
                          >Quer contar o motivo? (opcional)
                          <textarea name="reason" maxlength="1000" [(ngModel)]="reason"></textarea>
                        </label>
                        <div class="row">
                          <button class="btn-danger btn-big" [disabled]="busy()">Confirmar recusa</button>
                          <button type="button" (click)="rejecting.set(false)">Voltar</button>
                        </div>
                      </form>
                    } @else {
                      @if (quote.expires_at) {
                        <small>Orçamento válido até {{ quote.expires_at | day }}.</small>
                      }
                      <div class="row">
                        <button type="button" class="btn-go btn-big grow" [disabled]="busy()" (click)="respond('approve')">Aprovar orçamento</button>
                        <button type="button" class="btn-big" [disabled]="busy()" (click)="rejecting.set(true)">Recusar</button>
                      </div>
                    }
                  } @else {
                    <p class="muted">Situação do orçamento: {{ quote.status | quoteStatus }}.</p>
                  }
                  @if (error()) {
                    <p class="notice notice-stop" role="alert">{{ error() }}</p>
                  }
                </section>
              }

              <section class="sheet stack" aria-labelledby="timeline-title">
                <h2 id="timeline-title">Andamento</h2>
                <ol class="timeline">
                  @for (entry of d.timeline; track $index) {
                    <li>
                      <strong>{{ entry.label }}</strong
                      ><br /><small>{{ entry.at | moment }}</small>
                    </li>
                  }
                </ol>
              </section>

              @if (d.shop_messages.length) {
                <section class="sheet stack-sm">
                  <h2>Recados da oficina</h2>
                  @for (message of d.shop_messages; track $index) {
                    <p>
                      {{ message.body }}<br /><small>{{ message.at | moment }}</small>
                    </p>
                  }
                </section>
              }

              @if (d.reported_symptoms.length || d.customer_notes) {
                <section class="sheet stack-sm">
                  <h2>O que você relatou</h2>
                  <ul class="report">
                    @for (symptom of d.reported_symptoms; track symptom.name) {
                      <li>
                        <strong>{{ symptom.name }}</strong>
                        @if (symptom.answers.length) {
                          <dl>
                            @for (answer of symptom.answers; track answer.question) {
                              <div>
                                <dt>{{ answer.question }}</dt>
                                <dd>{{ answer.answer }}</dd>
                              </div>
                            }
                          </dl>
                        }
                      </li>
                    }
                  </ul>
                  @if (d.customer_notes) {
                    <p>{{ d.customer_notes }}</p>
                  }
                </section>
              }

              @if (history().length) {
                <section class="sheet stack-sm">
                  <h2>Serviços anteriores deste veículo</h2>
                  <ul class="list">
                    @for (past of history(); track past.number) {
                      <li class="past">
                        <div class="row-between">
                          <strong>OS {{ past.number }}, {{ past.opened_at | day }}</strong>
                          <span class="num">{{ past.total_amount | brl }}</span>
                        </div>
                        <small>{{ past.status_label }}{{ past.services.length ? ': ' + past.services.join(', ') : '' }}</small>
                      </li>
                    }
                  </ul>
                </section>
              }

              <footer class="muted">
                @if (d.shop.phone) {
                  Dúvidas? Fale com a oficina: {{ d.shop.phone | phone }}.
                }
                <a routerLink="/privacidade">Política de privacidade</a>
              </footer>
            }
          }
        }
      }
    </main>
  `,
  styles: `
    .past {
      padding: 0.6rem 0;
    }
  `
})
export class PortalPage implements OnInit {
  private readonly api = inject(Api);
  readonly token = input.required<string>();
  readonly intro = signal<PortalIntro | null>(null);
  readonly data = signal<PortalOrderResponse | null>(null);
  readonly history = signal<PortalHistoryEntry[]>([]);
  readonly invalid = signal(false);
  readonly rejecting = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly feedback = signal('');
  reason = '';

  private get base(): string {
    return `/portal/${encodeURIComponent(this.token())}`;
  }

  async ngOnInit(): Promise<void> {
    try {
      const intro = await this.api.get<PortalIntro>(this.base, undefined, anonymous());
      this.intro.set(intro);
      if (!intro.consent_required) await this.load();
    } catch {
      this.invalid.set(true);
    }
  }

  async accept(): Promise<void> {
    try {
      await this.api.post(`${this.base}/consent`, {}, anonymous());
      this.intro.update((intro) => intro && { ...intro, consent_required: false });
      await this.load();
    } catch {
      this.invalid.set(true);
    }
  }

  private async load(): Promise<void> {
    this.data.set(await this.api.get<PortalOrderResponse>(`${this.base}/order`, undefined, anonymous()));
    this.history.set(await this.api.get<PortalHistoryEntry[]>(`${this.base}/history`, undefined, anonymous()).catch(() => []));
  }

  async respond(decision: 'approve' | 'reject'): Promise<void> {
    const quote = this.data()?.quote;
    if (!quote) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const body = decision === 'reject' ? { reason: this.reason.trim() || undefined } : {};
      this.data.set(await this.api.post<PortalOrderResponse>(`${this.base}/quotes/${quote.id}/${decision}`, body, anonymous()));
      this.rejecting.set(false);
      this.feedback.set(
        decision === 'approve'
          ? 'Orçamento aprovado. A oficina já foi avisada e vai iniciar o serviço.'
          : 'Recusa registrada. A oficina vai entrar em contato com você.'
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="portal">
      <h1>Política de privacidade</h1>
      <section class="sheet stack">
        <h2>Quem trata os seus dados</h2>
        <p>
          A oficina que atende o seu veículo é a controladora dos seus dados pessoais. O PitStop é o sistema que ela usa para organizar o atendimento e atua
          como operador, seguindo as instruções da oficina.
        </p>
        <h2>Quais dados e para quê</h2>
        <p>
          Nome, telefone, e-mail, CPF (quando informado), placa e chassi do veículo, além do relato de sintomas e do histórico de serviços. Eles são usados
          somente para executar o serviço contratado: registrar o atendimento, montar o orçamento, pedir a sua aprovação e manter o histórico do veículo.
        </p>
        <h2>Base legal</h2>
        <p>Execução de contrato entre você e a oficina, e legítimo interesse na manutenção do histórico técnico do veículo (Lei 13.709/2018, LGPD).</p>
        <h2>Com quem compartilhamos</h2>
        <p>Com ninguém além da oficina que atende você e dos provedores de infraestrutura necessários para o sistema funcionar. Seus dados não são vendidos.</p>
        <h2>Por quanto tempo</h2>
        <p>
          Enquanto a oficina for cliente do PitStop. Se a conta da oficina ficar suspensa por mais de 90 dias, os dados pessoais são anonimizados e restam
          apenas estatísticas sem identificação.
        </p>
        <h2>Seus direitos</h2>
        <p>
          Você pode pedir à oficina, a qualquer momento, uma cópia dos seus dados, a correção ou a eliminação deles. A oficina consegue exportar e anonimizar o
          seu cadastro direto no sistema.
        </p>
        <h2>Encarregado (DPO)</h2>
        <p>Para falar com o encarregado pelo tratamento de dados do PitStop: <a href="mailto:privacidade@pitstop.app">privacidade&#64;pitstop.app</a>.</p>
      </section>
    </main>
  `
})
export class PrivacyPage {}
