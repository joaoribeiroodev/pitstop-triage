import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CanActivateFn, Router, RouterLink, RouterLinkActive, RouterOutlet, Routes } from '@angular/router';
import { AuthService, errorMessage } from '@front/core';
import { FeedbackComponent } from '@front/ui';

/** Só super admins passam. O backend revalida `is_super_admin` em toda chamada de /admin. */
export const superAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.me()?.is_super_admin === true || inject(Router).createUrlTree(['/login']);
};

@Component({
  selector: 'pa-root',
  standalone: true,
  imports: [RouterOutlet, FeedbackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><ps-feedback />`
})
export class AppComponent {}

@Component({
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page page-narrow" style="padding-top: 12vh">
      <header class="stack-sm">
        <h1 style="font-size: 2.8rem">PitStop Admin</h1>
        <p class="muted">Painel central de provisionamento. Acesso restrito à equipe PitStop.</p>
      </header>
      <form class="sheet stack" (ngSubmit)="submit()">
        <label>E-mail <input type="email" name="email" autocomplete="username" required [(ngModel)]="email" /></label>
        <label>Senha <input type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" /></label>
        @if (error()) {
          <p class="notice notice-stop" role="alert">{{ error() }}</p>
        }
        <button class="btn-primary btn-big" [disabled]="busy()">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
      </form>
    </main>
  `
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  email = '';
  password = '';

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const me = await this.auth.login(this.email.trim(), this.password);
      if (!me.is_super_admin) {
        await this.auth.logout();
        this.error.set('Esta conta não tem acesso ao painel administrativo.');
        return;
      }
      await this.router.navigate(['/tenants']);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="admin-bar" aria-label="Navegação do painel">
      <span class="brand">PitStop<small>Admin</small></span>
      <a routerLink="/tenants" routerLinkActive="active">Oficinas</a>
      <a routerLink="/metrics" routerLinkActive="active">Métricas</a>
      <a routerLink="/audit" routerLinkActive="active">Auditoria</a>
      <span class="who">{{ auth.me()?.email }} <button type="button" (click)="logout()">Sair</button></span>
    </nav>
    <router-outlet />
  `
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: '',
    component: ShellComponent,
    canActivate: [superAdminGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tenants' },
      { path: 'tenants', loadComponent: () => import('./pages').then((m) => m.TenantsPage) },
      { path: 'tenants/new', loadComponent: () => import('./pages').then((m) => m.NewTenantPage) },
      { path: 'tenants/:id', loadComponent: () => import('./pages').then((m) => m.TenantDetailPage) },
      { path: 'metrics', loadComponent: () => import('./pages').then((m) => m.MetricsPage) },
      { path: 'audit', loadComponent: () => import('./pages').then((m) => m.AuditPage) }
    ]
  },
  { path: '**', redirectTo: '' }
];
