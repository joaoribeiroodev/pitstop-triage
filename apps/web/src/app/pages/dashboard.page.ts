import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, AuthService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent, StatusComponent } from '@front/ui';
import type { DashboardSummary } from '@pitstop/shared-types';

@Component({
  standalone: true,
  imports: [RouterLink, PlateComponent, StatusComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">{{ auth.tenant()?.name }}</span>
          <h1>Painel</h1>
        </header>
        @if (auth.hasRole('owner', 'manager', 'receptionist')) {
          <div class="row">
            @if (auth.hasFeature('triage')) {
              <a class="btn btn-primary" routerLink="/triage/new">Nova triagem</a>
            }
            <a class="btn" routerLink="/service-orders/new">Abrir OS sem triagem</a>
          </div>
        }
      </div>

      @if (data(); as summary) {
        <section class="kpis" aria-label="Indicadores">
          <div class="sheet kpi">
            <strong class="num">{{ summary.opened_today }}</strong> abertas hoje
          </div>
          <div class="sheet kpi" data-tone="wait">
            <strong class="num">{{ summary.awaiting_approval }}</strong> aguardando aprovação
          </div>
          <div class="sheet kpi" data-tone="work">
            <strong class="num">{{ summary.in_progress }}</strong> em execução
          </div>
          <div class="sheet kpi" data-tone="done">
            <strong class="num">{{ summary.completed_this_week }}</strong> concluídas na semana
          </div>
        </section>

        @if (summary.pending_triage && auth.hasFeature('triage')) {
          <a class="notice notice-wait" routerLink="/triage">
            {{ summary.pending_triage }} {{ summary.pending_triage === 1 ? 'triagem pendente' : 'triagens pendentes' }} esperando virar OS.
          </a>
        }

        @if (showOnboarding(summary)) {
          <section class="sheet stripe stack" aria-labelledby="primeiros-passos">
            <header class="stack-sm">
              <span class="mono-label signal">Primeiros passos</span>
              <h2 id="primeiros-passos">Deixe a oficina pronta para o primeiro atendimento</h2>
            </header>
            <ol class="onboard">
              <li [class.done]="summary.onboarding.team">
                <span><strong>Cadastre a equipe</strong><small>Recepção e mecânicos entram com o próprio login e veem só o que é do papel deles.</small></span>
                <a class="btn" routerLink="/settings/users">{{ summary.onboarding.team ? 'Ver equipe' : 'Cadastrar' }}</a>
              </li>
              <li [class.done]="summary.onboarding.catalog">
                <span
                  ><strong>Monte o catálogo de serviços e peças</strong
                  ><small>Os preços padrão entram no orçamento com um toque e dão valor às sugestões.</small></span
                >
                <a class="btn" routerLink="/settings/catalog">{{ summary.onboarding.catalog ? 'Ver catálogo' : 'Montar' }}</a>
              </li>
              <li [class.done]="summary.onboarding.first_order">
                <span
                  ><strong>Abra a primeira triagem</strong><small>Escolha o veículo, marque os sintomas e transforme o relato em ordem de serviço.</small></span
                >
                <a class="btn btn-primary" routerLink="/triage/new">Começar</a>
              </li>
            </ol>
          </section>
        }

        <section class="stack-sm">
          <h2>Precisam de você</h2>
          <div class="sheet sheet-flush">
            <ul class="list">
              @for (order of summary.needs_action; track order.id) {
                <li>
                  <a class="list-link" [routerLink]="['/service-orders', order.id]">
                    <span class="row">
                      <ps-plate [value]="order.vehicle_plate" />
                      <span>
                        <strong>OS {{ order.order_number }}</strong
                        >, {{ order.customer_name }} <br /><small>{{ order.vehicle_label }}</small>
                      </span>
                    </span>
                    <ps-status [value]="order.status" />
                  </a>
                </li>
              } @empty {
                <li class="empty">Nada pendente por aqui. Quando uma OS precisar de ação sua, ela aparece nesta lista.</li>
              }
            </ul>
          </div>
        </section>
      }
    </div>
  `
})
export class DashboardPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  readonly data = signal<DashboardSummary | null>(null);

  /** O cartão de primeiros passos é da gestão e some quando os três passos estão feitos. */
  showOnboarding(summary: DashboardSummary): boolean {
    const steps = summary.onboarding;
    return this.auth.hasRole('owner', 'manager') && !!steps && !(steps.team && steps.catalog && steps.first_order);
  }

  async ngOnInit(): Promise<void> {
    this.data.set(await this.api.get<DashboardSummary>('/dashboard/summary'));
  }
}
