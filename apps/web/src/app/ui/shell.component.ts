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
        <a class="brand shell-brand" routerLink="/dashboard" aria-label="PitStop, ir para o painel"><span class="brand-mark">PS</span><span>PitStop</span></a>
        <div class="shell-shop">
          <span class="mono-label">Oficina</span>
          <strong>{{ auth.tenant()?.name }}</strong>
        </div>
        <a class="nav" routerLink="/dashboard" routerLinkActive="active"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" /></svg
          >Painel</a
        >
        <a class="nav" routerLink="/service-orders" routerLinkActive="active"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg
          >Ordens</a
        >
        @if (auth.hasFeature('triage')) {
          <a class="nav" routerLink="/triage" routerLinkActive="active">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
              <circle cx="12" cy="12" r="2" /></svg
            >Triagem
            @if (pendingTriage()) {
              <span class="badge" [attr.aria-label]="pendingTriage() + ' pendentes'">{{ pendingTriage() }}</span>
            }
          </a>
        }
        <a class="nav" routerLink="/customers" routerLinkActive="active"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.5" />
            <path
              d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.900 2.100 6.500 5.500M16 4.800a3.500 3.500 0 0 1 0 6.400M18.500 14.800c1.700.800 2.700 2.600 3 5.200"
            /></svg
          >Clientes</a
        >
        <a class="nav" routerLink="/vehicles" routerLinkActive="active"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 16V11l2-5h12l2 5v5M4 16h16M4 16v2.500M20 16v2.500M3 11h18" />
            <circle cx="7.500" cy="13.500" r="1" />
            <circle cx="16.500" cy="13.500" r="1" /></svg
          >Veículos</a
        >
        <a class="nav" routerLink="/settings" routerLinkActive="active"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19 12a7 7 0 0 0-.1-1.300l2-1.500-2-3.400-2.300.900a7 7 0 0 0-2.200-1.300L14 3h-4l-.4 2.400a7 7 0 0 0-2.200 1.300l-2.300-.900-2 3.400 2 1.500a7 7 0 0 0 0 2.600l-2 1.500 2 3.400 2.300-.900a7 7 0 0 0 2.200 1.300L10 21h4l.4-2.400a7 7 0 0 0 2.200-1.300l2.300.900 2-3.400-2-1.500c.07-.4.1-.9.1-1.300z"
            /></svg
          >Ajustes</a
        >
        <div class="shell-user">
          <div class="who">
            <strong>{{ auth.me()?.membership?.full_name }}</strong>
            <span class="mono-label">{{ roleLabel() }}</span>
          </div>
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
