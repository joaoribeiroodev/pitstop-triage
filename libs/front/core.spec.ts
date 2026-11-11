import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeResponse } from '@pitstop/shared-types';
import { anonymous, Api, apiInterceptor, AuthService, errorMessage, SESSION_KEY, ToastService } from './core';

const ME: MeResponse = {
  id: 'u1',
  email: 'dono@demo.local',
  is_super_admin: false,
  membership: { id: 'm1', role: 'receptionist', full_name: 'Rafa' },
  tenant: {
    id: 't1',
    name: 'Oficina Demo',
    slug: 'oficina-demo',
    plan: 'pro',
    status: 'active',
    expires_at: null,
    feature_flags: { triage: true, public_triage: true, diagnostics: true, portal: true, whatsapp: false, inventory: false, financial: false, ai: false },
    limits: { max_users: 15, max_orders_month: 600, max_storage_mb: 5120 },
    settings: {}
  }
};

/** Deixa as promessas encadeadas (login → me, refresh → nova tentativa) avançarem. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('núcleo do frontend', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let api: Api;

  beforeEach(() => {
    localStorage.removeItem('teste.sessao');
    TestBed.configureTestingModule({
      providers: [
        provideExperimentalZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: SESSION_KEY, useValue: 'teste.sessao' }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    api = TestBed.inject(Api);
  });

  afterEach(() => http.verify());

  it('traduz erros da API em mensagem para o usuário', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Sem conexão');
    expect(errorMessage(new HttpErrorResponse({ status: 400, error: { message: ['Campo A.', 'Campo B.'] } }))).toBe('Campo A. Campo B.');
    expect(errorMessage(new HttpErrorResponse({ status: 409, error: { message: 'Transição não permitida.' } }))).toBe('Transição não permitida.');
  });

  it('envia o JWT nas chamadas autenticadas e nunca nas anônimas', async () => {
    const login = auth.login('dono@demo.local', 'senha');
    http.expectOne('/api/v1/auth/login').flush({ access_token: 'jwt-1', refresh_token: 'r-1', expires_in: 3600 });
    await tick();
    const me = http.expectOne('/api/v1/auth/me');
    expect(me.request.headers.get('Authorization')).toBe('Bearer jwt-1');
    me.flush(ME);
    await login;
    expect(auth.hasRole('receptionist')).toBeTrue();
    expect(auth.hasFeature('triage')).toBeTrue();
    expect(auth.hasFeature('inventory')).toBeFalse();

    const portal = api.get('/portal/abc/order', undefined, anonymous());
    const request = http.expectOne('/api/v1/portal/abc/order');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
    await portal;
  });

  it('renova a sessão uma vez em 401 e repete a chamada', async () => {
    localStorage.setItem('teste.sessao', JSON.stringify({ access_token: 'velho', refresh_token: 'r-1' }));
    auth.tokens.set({ access_token: 'velho', refresh_token: 'r-1' });
    const call = api.get<{ ok: boolean }>('/customers');
    http.expectOne('/api/v1/customers').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush({ access_token: 'novo', refresh_token: 'r-2', expires_in: 3600 });
    await tick();
    const retry = http.expectOne('/api/v1/customers');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer novo');
    retry.flush({ ok: true });
    expect(await call).toEqual({ ok: true });
  });

  it('leva à tela de bloqueio quando a oficina está suspensa, sem toast', async () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const toast = TestBed.inject(ToastService);
    const call = api.get('/dashboard/summary').catch((error: unknown) => error);
    http.expectOne('/api/v1/dashboard/summary').flush({ code: 'TENANT_SUSPENDED', message: 'Suspensa' }, { status: 403, statusText: 'Forbidden' });
    await call;
    expect(navigate).toHaveBeenCalledWith(['/bloqueado'], { queryParams: { motivo: 'TENANT_SUSPENDED' } });
    expect(toast.items()).toEqual([]);
  });
});
