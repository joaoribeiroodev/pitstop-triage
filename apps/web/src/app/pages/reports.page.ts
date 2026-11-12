import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Api } from '@front/core';
import { FORMAT_PIPES, localDay } from '@front/format';
import type { ReportsOverview } from '@pitstop/shared-types';

const PERIODS = [
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '12 meses' }
];
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' });

/** Indicadores da oficina sobre as OS concluídas no período. Só a gestão vê. */
@Component({
  standalone: true,
  imports: [...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Indicadores</span>
          <h1>Como a oficina está <span class="hl">rendendo</span>?</h1>
          <p>Calculado sobre as ordens concluídas no período.</p>
        </header>
        <div class="tabs" role="tablist" aria-label="Período">
          @for (period of periods; track period.days) {
            <button type="button" role="tab" [attr.aria-selected]="days() === period.days" (click)="setDays(period.days)">{{ period.label }}</button>
          }
        </div>
      </div>

      @if (data(); as report) {
        <section class="kpis" aria-label="Resumo do período">
          <div class="sheet kpi" data-tone="done">
            <strong class="num">{{ report.revenue | brl }}</strong> faturado
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ report.orders_completed }}</strong> {{ report.orders_completed === 1 ? 'OS concluída' : 'OS concluídas' }}
          </div>
          <div class="sheet kpi" data-tone="work">
            <strong class="num">{{ report.average_ticket | brl }}</strong> ticket médio
          </div>
          <div class="sheet kpi" data-tone="wait">
            <strong class="num">{{ report.quotes.conversion_pct === null ? '—' : report.quotes.conversion_pct + '%' }}</strong> dos orçamentos aprovados
          </div>
        </section>
        <small
          >{{ report.quotes.sent }} {{ report.quotes.sent === 1 ? 'orçamento enviado' : 'orçamentos enviados' }}: {{ report.quotes.approved }} aprovados e
          {{ report.quotes.rejected }} recusados. Tempo médio de execução: {{ report.average_execution_minutes | duration }}.</small
        >

        @if (!report.orders_completed) {
          <p class="notice">Nenhuma OS foi concluída neste período. Os indicadores aparecem conforme os serviços são finalizados.</p>
        } @else {
          <section class="sheet stack">
            <h2>Faturamento por mês</h2>
            <ul class="bars" aria-label="Faturamento por mês">
              @for (month of report.by_month; track month.month) {
                <li>
                  <span class="mono-label">{{ monthLabel(month.month) }}</span>
                  <span class="bar"><i [style.width.%]="share(month.revenue)"></i></span>
                  <span class="num">{{ month.revenue | brl }}</span>
                  <small>{{ month.orders }} OS</small>
                </li>
              }
            </ul>
          </section>

          <div class="two">
            <section class="sheet sheet-flush table-wrap">
              <table>
                <caption>
                  O que mais rende
                </caption>
                <thead>
                  <tr>
                    <th>Serviço ou peça</th>
                    <th class="right">Vezes</th>
                    <th class="right">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of report.top_services; track row.description + row.type) {
                    <tr>
                      <td>
                        <small>{{ row.type === 'service' ? 'Mão de obra' : 'Peça' }}</small
                        ><br />{{ row.description }}
                      </td>
                      <td class="right num">{{ row.times }}</td>
                      <td class="right num">{{ row.revenue | brl }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>

            <section class="sheet sheet-flush table-wrap">
              <table>
                <caption>
                  Por mecânico
                </caption>
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th class="right">OS</th>
                    <th class="right">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of report.by_mechanic; track row.mechanic_name) {
                    <tr>
                      <td>{{ row.mechanic_name }}</td>
                      <td class="right num">{{ row.orders }}</td>
                      <td class="right num">{{ row.revenue | brl }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .bars {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.6rem;
    }
    .bars li {
      display: grid;
      grid-template-columns: 4.5rem 1fr 7.5rem 3.5rem;
      align-items: center;
      gap: 0.75rem;
    }
    .bar {
      height: 0.6rem;
      border-radius: 999px;
      background: var(--line);
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      background: var(--coverall);
      border-radius: inherit;
    }
    .bars .num {
      text-align: right;
    }
    .two {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
      gap: 1rem;
      align-items: start;
    }
    caption {
      text-align: left;
      padding: 1rem 1rem 0.5rem;
      font-family: var(--font-display, inherit);
      font-weight: 600;
    }
    @media (max-width: 560px) {
      .bars li {
        grid-template-columns: 4rem 1fr;
      }
      .bars .num,
      .bars small {
        grid-column: 2;
        text-align: left;
      }
    }
  `
})
export class ReportsPage implements OnInit {
  private readonly api = inject(Api);
  readonly periods = PERIODS;
  readonly days = signal(90);
  readonly data = signal<ReportsOverview | null>(null);
  private readonly peak = computed(() => Math.max(1, ...(this.data()?.by_month.map((month) => month.revenue) ?? [])));

  ngOnInit(): void {
    void this.load();
  }

  setDays(days: number): void {
    this.days.set(days);
    void this.load();
  }

  share(revenue: number): number {
    return Math.round((revenue / this.peak()) * 100);
  }

  monthLabel(month: string): string {
    return MONTH.format(new Date(`${month}-15T12:00:00`))
      .replace('. de ', '/')
      .replace(' de ', '/');
  }

  async load(): Promise<void> {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (this.days() - 1));
    this.data.set(await this.api.get<ReportsOverview>('/reports/overview', { from: localDay(from), to: localDay(to) }));
  }
}
