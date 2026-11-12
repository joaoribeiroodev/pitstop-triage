import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { anonymous, Api, errorMessage } from '@front/core';
import type { AccountLinkInfo } from '@pitstop/shared-types';

/** "Esqueci minha senha": pede o e-mail e mostra a mesma confirmação exista ou não a conta. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="portal">
      <header class="portal-head">
        <span class="mono-label signal">Acesso da equipe</span>
        <h1>Recuperar a senha</h1>
      </header>
      @if (sent()) {
        <p class="notice notice-done" role="status">
          Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Ele vale por uma hora. Confira também a caixa de spam.
        </p>
        <a class="btn" routerLink="/login">Voltar para o login</a>
      } @else {
        <form class="sheet stripe stack" (ngSubmit)="submit()" #form="ngForm">
          <label>E-mail da sua conta <input type="email" name="email" autocomplete="username" required [(ngModel)]="email" /></label>
          @if (error()) {
            <p class="notice notice-stop" role="alert">{{ error() }}</p>
          }
          <button class="btn-primary btn-big" [disabled]="form.invalid || busy()">{{ busy() ? 'Enviando…' : 'Enviar link' }}</button>
          <a routerLink="/login">Voltar para o login</a>
        </form>
      }
    </main>
  `
})
export class ForgotPasswordPage {
  private readonly api = inject(Api);
  readonly sent = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  email = '';

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post('/auth/password-reset', { email: this.email.trim().toLowerCase() }, anonymous());
      this.sent.set(true);
    } catch (failure) {
      this.error.set(errorMessage(failure));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Destino do link de convite ou de redefinição: a pessoa escolhe a própria senha. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="portal">
      <header class="portal-head">
        <span class="mono-label signal">PitStop</span>
        <h1>{{ info()?.purpose === 'reset' ? 'Nova senha' : 'Crie a sua senha' }}</h1>
      </header>
      @if (invalid()) {
        <p class="notice notice-wait">{{ invalid() }}</p>
        <a class="btn" routerLink="/recuperar-senha">Pedir um novo link</a>
      } @else if (done()) {
        <p class="notice notice-done" role="status">Senha definida. Agora é só entrar com o seu e-mail e a senha nova.</p>
        <a class="btn btn-primary" routerLink="/login">Ir para o login</a>
      } @else {
        @if (info(); as link) {
          <form class="sheet stripe stack" (ngSubmit)="submit()" #form="ngForm">
            <p class="muted">
              Conta: <strong>{{ link.email }}</strong>
            </p>
            <label
              >Senha (mínimo de 8 caracteres)
              <input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="200" [(ngModel)]="password" />
            </label>
            <label
              >Repita a senha
              <input type="password" name="confirm" autocomplete="new-password" required [(ngModel)]="confirm" />
            </label>
            @if (error()) {
              <p class="notice notice-stop" role="alert">{{ error() }}</p>
            }
            <button class="btn-primary btn-big" [disabled]="form.invalid || busy()">{{ busy() ? 'Salvando…' : 'Salvar senha' }}</button>
          </form>
        }
      }
    </main>
  `
})
export class SetPasswordPage implements OnInit {
  private readonly api = inject(Api);
  readonly token = input.required<string>();
  readonly info = signal<AccountLinkInfo | null>(null);
  readonly invalid = signal('');
  readonly done = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  password = '';
  confirm = '';

  async ngOnInit(): Promise<void> {
    try {
      this.info.set(await this.api.get<AccountLinkInfo>(`/auth/links/${this.token()}`, undefined, anonymous()));
    } catch {
      this.invalid.set('Este link não vale mais: ele já foi usado ou expirou.');
    }
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (this.password !== this.confirm) return this.error.set('As duas senhas precisam ser iguais.');
    this.busy.set(true);
    try {
      await this.api.post(`/auth/links/${this.token()}`, { password: this.password }, anonymous());
      this.done.set(true);
    } catch (failure) {
      this.error.set(errorMessage(failure));
    } finally {
      this.busy.set(false);
    }
  }
}
