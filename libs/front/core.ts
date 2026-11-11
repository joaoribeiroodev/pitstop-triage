import { HttpClient, HttpContext, HttpContextToken, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { ApiError, FeatureFlag, MeResponse, SessionTokens, TenantRole } from '@pitstop/shared-types';
import { catchError, finalize, firstValueFrom, from, Observable, switchMap, throwError } from 'rxjs';

export const API_BASE = '/api/v1';
/** Chave de armazenamento da sessão — cada app (oficina, admin) usa a sua. */
export const SESSION_KEY = new InjectionToken<string>('SESSION_KEY');
/** Requisição que trata o próprio erro: o interceptor não mostra toast. */
export const SILENT = new HttpContextToken<boolean>(() => false);
/** Rotas públicas (portal, triagem pública): sem Authorization e sem redirecionar ao login. */
export const ANONYMOUS = new HttpContextToken<boolean>(() => false);

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  ok(text: string): void {
    this.push('ok', text, 3500);
  }

  error(text: string): void {
    this.push('error', text, 6000);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }

  private push(kind: Toast['kind'], text: string, ttl: number): void {
    const id = this.next++;
    this.items.update((list) => [...list.slice(-2), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ttl);
  }
}

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);
  readonly active = computed(() => this.pending() > 0);

  begin(): void {
    this.pending.update((count) => count + 1);
  }

  end(): void {
    this.pending.update((count) => Math.max(0, count - 1));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    const body = error.error as Partial<ApiError> | null;
    const message = body?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (message) return message;
  }
  return 'Não foi possível concluir a ação. Tente de novo.';
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof HttpErrorResponse ? (error.error as { code?: string } | null)?.code : undefined;
}

type Params = Record<string, string | number | boolean | null | undefined>;

/** Acesso fino à API: um método por verbo, tipado pelo chamador com os contratos de shared-types. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Params, context?: HttpContext): Promise<T> {
    return firstValueFrom(this.http.get<T>(API_BASE + path, { params: toParams(params), context }));
  }

  post<T>(path: string, body: unknown = {}, context?: HttpContext): Promise<T> {
    return firstValueFrom(this.http.post<T>(API_BASE + path, body, { context }));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(API_BASE + path, body));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(API_BASE + path, body));
  }

  delete<T = void>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(API_BASE + path));
  }
}

function toParams(params?: Params): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== '') result = result.set(key, String(value));
  }
  return result;
}

export const anonymous = () => new HttpContext().set(ANONYMOUS, true).set(SILENT, true);
export const silent = () => new HttpContext().set(SILENT, true);

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly key = inject(SESSION_KEY);
  private refreshing: Promise<boolean> | null = null;

  readonly tokens = signal<Partial<SessionTokens> | null>(this.read());
  readonly me = signal<MeResponse | null>(null);
  readonly isAuthenticated = computed(() => this.me() !== null);
  readonly role = computed<TenantRole | null>(() => this.me()?.membership?.role ?? null);
  readonly tenant = computed(() => this.me()?.tenant ?? null);

  private read(): Partial<SessionTokens> | null {
    try {
      return JSON.parse(localStorage.getItem(this.key) ?? 'null');
    } catch {
      return null;
    }
  }

  private store(tokens: Partial<SessionTokens> | null): void {
    this.tokens.set(tokens);
    if (tokens) localStorage.setItem(this.key, JSON.stringify(tokens));
    else localStorage.removeItem(this.key);
  }

  /** Restaura a sessão ao abrir o app. Nunca lança: sem sessão válida, segue deslogado. */
  async restore(): Promise<void> {
    if (!this.tokens()?.access_token) return;
    try {
      await this.loadMe();
    } catch {
      /* o interceptor já tentou renovar; se chegou aqui, a sessão acabou */
    }
  }

  async loadMe(): Promise<MeResponse> {
    const me = await firstValueFrom(this.http.get<MeResponse>(`${API_BASE}/auth/me`, { context: silent() }));
    this.me.set(me);
    return me;
  }

  async login(email: string, password: string): Promise<MeResponse> {
    const tokens = await firstValueFrom(this.http.post<SessionTokens>(`${API_BASE}/auth/login`, { email, password }, { context: anonymous() }));
    this.store(tokens);
    return this.loadMe();
  }

  /** Sessão de suporte (impersonation): só access token, sem renovação. */
  async adopt(accessToken: string): Promise<MeResponse> {
    this.store({ access_token: accessToken });
    return this.loadMe();
  }

  refresh(): Promise<boolean> {
    const refreshToken = this.tokens()?.refresh_token;
    if (!refreshToken) return Promise.resolve(false);
    this.refreshing ??= firstValueFrom(this.http.post<SessionTokens>(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken }, { context: anonymous() }))
      .then((tokens) => {
        this.store(tokens);
        return true;
      })
      .catch(() => false)
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout(): Promise<void> {
    if (this.tokens()?.access_token) {
      await firstValueFrom(this.http.post(`${API_BASE}/auth/logout`, {}, { context: silent() })).catch(() => undefined);
    }
    this.clear();
  }

  clear(): void {
    this.store(null);
    this.me.set(null);
  }

  hasRole(...roles: TenantRole[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  hasFeature(flag: FeatureFlag): boolean {
    return this.tenant()?.feature_flags[flag] === true;
  }
}

/** JWT em toda chamada autenticada; renova a sessão uma vez em 401; erros viram toast em um só lugar. */
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const loading = inject(LoadingService);
  const router = inject(Router);

  const isAnonymous = request.context.get(ANONYMOUS);
  const withToken = (token: string | undefined) => (token && !isAnonymous ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);

  const fail = (error: HttpErrorResponse): Observable<never> => {
    const code = errorCode(error);
    if (!isAnonymous && error.status === 401) {
      auth.clear();
      void router.navigate(['/login']);
    } else if (!isAnonymous && (code === 'TENANT_SUSPENDED' || code === 'TENANT_EXPIRED' || code === 'USER_DISABLED' || code === 'NO_TENANT')) {
      void router.navigate(['/bloqueado'], { queryParams: { motivo: code } });
    } else if (!request.context.get(SILENT)) {
      toast.error(errorMessage(error));
    }
    return throwError(() => error);
  };

  loading.begin();
  return next(withToken(auth.tokens()?.access_token)).pipe(
    catchError((error: HttpErrorResponse) => {
      const canRetry = error.status === 401 && !isAnonymous && !request.url.includes('/auth/');
      if (!canRetry) return fail(error);
      return from(auth.refresh()).pipe(switchMap((renewed) => (renewed ? next(withToken(auth.tokens()?.access_token)).pipe(catchError(fail)) : fail(error))));
    }),
    finalize(() => loading.end())
  );
};

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login'], { queryParams: { voltar: state.url } });
  if (!auth.tenant()) return router.createUrlTree(['/bloqueado'], { queryParams: { motivo: 'NO_TENANT' } });
  return true;
};

export const roleGuard =
  (...roles: TenantRole[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    return auth.hasRole(...roles) || inject(Router).createUrlTree(['/']);
  };

export const featureFlagGuard =
  (flag: FeatureFlag): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    return auth.hasFeature(flag) || inject(Router).createUrlTree(['/']);
  };

/**
 * Falhas de API já são tratadas no interceptor (toast, redirecionamento). As páginas não precisam de try/catch
 * só para silenciar a promessa rejeitada: este ouvinte evita o "Uncaught (in promise)" duplicado no console.
 */
export function ignoreHandledApiRejections(): void {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof HttpErrorResponse) event.preventDefault();
  });
}
