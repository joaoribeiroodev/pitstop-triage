import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '@front/core';

@Component({
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page page-narrow" style="padding-top: 12vh">
      <header class="stack-sm">
        <h1 style="font-size: 3.2rem">PitStop</h1>
        <p class="muted">Triagem, ordens de serviço e orçamentos da oficina em um só lugar.</p>
      </header>
      <form class="sheet stack" (ngSubmit)="submit()">
        <label>E-mail <input type="email" name="email" autocomplete="username" required [(ngModel)]="email" /></label>
        <label>Senha <input type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" /></label>
        @if (error()) {
          <p class="notice notice-stop" role="alert">{{ error() }}</p>
        }
        <button class="btn-primary btn-big" [disabled]="busy()">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
      </form>
      <p class="muted">O acesso é criado pelo responsável da oficina. Esqueceu a senha? Peça a ele um novo acesso.</p>
    </main>
  `
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly voltar = input<string>();
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const me = await this.auth.login(this.email.trim(), this.password);
      if (!me.tenant) {
        await this.router.navigate(['/bloqueado'], { queryParams: { motivo: 'NO_TENANT' } });
        return;
      }
      const target = this.voltar();
      await this.router.navigateByUrl(target && target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

const REASONS: Record<string, { title: string; text: string }> = {
  TENANT_SUSPENDED: {
    title: 'Acesso suspenso',
    text: 'O acesso desta oficina está suspenso. Os dados continuam guardados. Fale com o suporte PitStop para reativar.'
  },
  TENANT_EXPIRED: { title: 'Licença vencida', text: 'A licença desta oficina venceu. Os dados continuam guardados. Fale com o suporte PitStop para renovar.' },
  USER_DISABLED: { title: 'Acesso desativado', text: 'Seu acesso foi desativado pelo responsável da oficina. Fale com ele para voltar a usar o sistema.' },
  NO_TENANT: {
    title: 'Sem oficina vinculada',
    text: 'Este usuário não está vinculado a nenhuma oficina. Confira com o responsável se o convite foi feito para este e-mail.'
  }
};

@Component({
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page page-narrow" style="padding-top: 12vh">
      <h1>{{ reason().title }}</h1>
      <p class="notice notice-wait">{{ reason().text }}</p>
      <div class="row">
        <button type="button" (click)="leave()">Entrar com outra conta</button>
        <a class="btn" routerLink="/dashboard">Tentar de novo</a>
      </div>
    </main>
  `
})
export class BlockedPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly motivo = input<string>('NO_TENANT');

  reason() {
    return REASONS[this.motivo()] ?? REASONS['NO_TENANT'];
  }

  async leave(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

/** Entrada da sessão de suporte: o painel admin abre /suporte#token=… (o fragmento não vai para o servidor nem para logs). */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main class="page page-narrow">
    <p class="notice" role="status">{{ message() }}</p>
  </main>`
})
export class SupportSessionPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly message = signal('Abrindo sessão de suporte…');

  async ngOnInit(): Promise<void> {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    history.replaceState(null, '', location.pathname);
    if (!token) {
      this.message.set('Link de suporte inválido.');
      return;
    }
    try {
      await this.auth.adopt(token);
      await this.router.navigate(['/dashboard']);
    } catch {
      this.auth.clear();
      this.message.set('Sessão de suporte expirada. Gere um novo acesso no painel administrativo.');
    }
  }
}
