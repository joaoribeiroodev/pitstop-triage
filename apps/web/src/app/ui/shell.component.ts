import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api, AuthService, silent } from '@front/core';
import { ROLE_LABELS } from '@front/format';
import type { DashboardSummary } from '@pitstop/shared-types';

@Component({
  selector: 'ps-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <nav class="shell-nav" aria-label="Navegação principal">
        <div class="shell-brand">PitStop</div>
        <div class="shell-shop">{{ auth.tenant()?.name }}</div>
        <a routerLink="/dashboard" routerLinkActive="active">Painel</a>
        <a routerLink="/service-orders" routerLinkActive="active">Ordens</a>
        @if (auth.hasFeature('triage')) {
          <a routerLink="/triage" routerLinkActive="active">
            Triagem
            @if (pendingTriage()) {
              <span class="badge" [attr.aria-label]="pendingTriage() + ' pendentes'">{{ pendingTriage() }}</span>
            }
          </a>
        }
        <a routerLink="/customers" routerLinkActive="active">Clientes</a>
        <a routerLink="/vehicles" routerLinkActive="active">Veículos</a>
        <a routerLink="/settings" routerLinkActive="active">Ajustes</a>
        <div class="shell-user">
          <strong>{{ auth.me()?.membership?.full_name }}</strong>
          <span>{{ roleLabel() }}</span>
          <button type="button" (click)="logout()">Sair</button>
        </div>
      </nav>
      <main class="shell-main">
        @if (auth.me()?.impersonated_by; as support) {
          <div class="support-banner" role="status">
            Sessão de suporte ({{ support }}). Tudo o que for feito aqui fica registrado.
            <button type="button" class="btn-quiet" (click)="logout()">Encerrar</button>
          </div>
        }
        <router-outlet />
      </main>
    </div>
  `
})
export class ShellComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly pendingTriage = signal(0);

  roleLabel(): string {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  }

  ngOnInit(): void {
    this.api
      .get<DashboardSummary>('/dashboard/summary', undefined, silent())
      .then((summary) => this.pendingTriage.set(summary.pending_triage))
      .catch(() => undefined);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
