import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService, ToastService } from '@front/core';
import type { AdminTenantRow, TenantUser } from '@pitstop/shared-types';
import { me, mount } from '../../../web/src/testing/harness';
import { LoginPage, ShellComponent, superAdminGuard } from './app';
import { AuditPage, EmailSettingsPage, MetricsPage, NewTenantPage, TenantDetailPage, TenantsPage } from './pages';

const ADMIN = { ...me(), email: 'admin@pitstop.app', is_super_admin: true, membership: null, tenant: null };
const OWNER: TenantUser = {
  id: 'm-1',
  tenant_id: 't-1',
  user_id: 'u-1',
  role: 'owner',
  full_name: 'Dona Carla',
  email: 'dono@demo.local',
  is_active: true,
  created_at: ''
};

const tenant = (overrides: Partial<AdminTenantRow> = {}): AdminTenantRow => ({
  id: 't-1',
  name: 'Oficina Demo',
  slug: 'oficina-demo',
  document: '12345678000199',
  contact_name: null,
  contact_email: null,
  contact_phone: '71999990000',
  status: 'active',
  plan: 'pro',
  is_trial: false,
  expires_at: '2026-11-15T15:00:00Z',
  suspended_at: null,
  feature_flags: { inventory: true },
  limits: { max_users: 20 },
  settings: {},
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  users_count: 3,
  orders_this_month: 12,
  expiring_soon: true,
  ...overrides
});

/** Monta a página já com um super admin logado. */
async function mountAdmin<T>(component: Parameters<typeof mount<T>>[0], inputs: Record<string, unknown> = {}) {
  const page = await mount(component, { anonymous: true, inputs });
  const auth = TestBed.inject(AuthService);
  auth.tokens.set({ access_token: 'jwt-admin' });
  auth.me.set(ADMIN);
  return page;
}

describe('painel super admin', () => {
  it('só super admins entram: conta de oficina é recusada no login e barrada pelo guard', async () => {
    const page = await mount(LoginPage, { anonymous: true });
    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    page.component.email = 'dono@demo.local';
    page.component.password = 'senha';
    let submitting = page.component.submit();
    await page.respond('POST', '/auth/login', { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    await page.respond('GET', '/auth/me', me('owner'));
    await page.respond('POST', '/auth/logout', {});
    await submitting;
    expect(page.text()).toContain('Esta conta não tem acesso ao painel administrativo.');
    expect(navigate).not.toHaveBeenCalled();
    const guard = () => TestBed.runInInjectionContext(() => superAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(guard()).toBeInstanceOf(UrlTree);

    submitting = page.component.submit();
    await page.respond('POST', '/auth/login', { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    await page.respond('GET', '/auth/me', ADMIN);
    await submitting;
    expect(navigate).toHaveBeenCalledWith(['/tenants']);
    expect(guard()).toBeTrue();

    const shell = await mountAdmin(ShellComponent);
    await shell.settle();
    expect(shell.text()).toContain('admin@pitstop.app');
  });

  it('lista oficinas com situação, plano e alerta de expiração em menos de 7 dias', async () => {
    const page = await mountAdmin(TenantsPage);
    await page.respond('GET', '/admin/tenants', {
      data: [tenant(), tenant({ id: 't-2', name: 'Auto Center', slug: 'auto-center', status: 'suspended', expiring_soon: false })],
      total: 2,
      page: 1,
      pageSize: 20
    });
    expect(page.text()).toContain('Oficina Demo');
    expect(page.text()).toContain('Expira em menos de 7 dias');
    expect(page.text()).toContain('Suspensa');
    expect((page.fixture.nativeElement as HTMLElement).querySelectorAll('tr.row-warn').length).toBe(1);

    page.component.status = 'suspended';
    const loading = page.component.load(1);
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/admin/tenants');
    expect(request.request.params.get('status')).toBe('suspended');
    request.flush({ data: [], total: 0, page: 1, pageSize: 20 });
    await loading;
  });

  it('wizard de nova oficina: sugere o slug, mostra os limites do plano e envia só o preenchido', async () => {
    const page = await mountAdmin(NewTenantPage);
    page.component.draft.name = 'Oficina São João & Filhos';
    page.component.suggestSlug();
    expect(page.component.draft.slug).toBe('oficina-sao-joao-filhos');
    page.component.slugTouched = true;
    page.component.draft.slug = 'sao-joao';
    page.component.suggestSlug();
    expect(page.component.draft.slug).toBe('sao-joao');

    page.component.draft.plan = 'enterprise';
    expect(page.component.limits().max_users).toBe(100);
    Object.assign(page.component.draft, { owner_name: 'João', owner_email: 'joao@oficina.com', expires_at: '2027-01-31' });
    await page.component.next();
    await page.component.next();
    await page.component.next();
    expect(page.component.step()).toBe(3);
    await page.settle();
    expect(page.text()).toContain('Convite por e-mail');

    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    const creating = page.component.next();
    const sent = await page.respond('POST', '/admin/tenants', { ...tenant({ id: 't-9' }), owner_invited: true });
    await creating;
    expect(sent).toEqual({
      name: 'Oficina São João & Filhos',
      slug: 'sao-joao',
      plan: 'enterprise',
      is_trial: false,
      expires_at: '2027-01-31',
      owner_name: 'João',
      owner_email: 'joao@oficina.com'
    });
    expect(navigate).toHaveBeenCalledWith(['/tenants', 't-9']);
    expect(TestBed.inject(ToastService).items().at(-1)?.text).toContain('convite');
  });

  it('detalhe: flags efetivas do plano + ajustes, limites, cadastro e renovação', async () => {
    const page = await mountAdmin(TenantDetailPage, { id: 't-1' });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    expect(page.component.effectiveFlags()).toEqual(jasmine.objectContaining({ triage: true, inventory: true, ai: false }));
    expect(page.component.limits).toEqual({ max_users: 20, max_orders_month: 600, max_storage_mb: 5120 });
    expect(page.component.form.expires_at).toBe('2026-11-15');
    expect(page.text()).toContain('Dona Carla');
    expect(page.text()).toContain('Renove a data de expiração');

    const flagging = page.component.setFlag('whatsapp', true);
    expect(await page.respond('PATCH', '/admin/tenants/t-1', tenant())).toEqual({ feature_flags: { whatsapp: true } });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    await flagging;

    page.component.limits = { max_users: 30, max_orders_month: 900, max_storage_mb: 5120 };
    const limiting = page.component.saveLimits();
    expect(await page.respond('PATCH', '/admin/tenants/t-1', tenant())).toEqual({ limits: { max_users: 30, max_orders_month: 900, max_storage_mb: 5120 } });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    await limiting;

    page.component.form.expires_at = '';
    const saving = page.component.saveProfile();
    expect(await page.respond('PATCH', '/admin/tenants/t-1', tenant())).toEqual(
      jasmine.objectContaining({ name: 'Oficina Demo', plan: 'pro', expires_at: null })
    );
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    await saving;
  });

  it('suspender exige o slug digitado; reativar devolve o acesso', async () => {
    const page = await mountAdmin(TenantDetailPage, { id: 't-1' });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    const button = () =>
      Array.from((page.fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((element) => element.textContent?.trim() === 'Suspender oficina');
    expect(button()?.disabled).toBeTrue();

    page.component.confirmSlug = 'oficina-demo';
    page.component.suspendReason = ' inadimplência ';
    const suspending = page.component.suspend();
    expect(await page.respond('POST', '/admin/tenants/t-1/suspend', tenant())).toEqual({ confirm_slug: 'oficina-demo', reason: 'inadimplência' });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant({ status: 'suspended', suspended_at: '2026-11-11T00:00:00Z' }), users: [OWNER] });
    await suspending;
    expect(page.text()).toContain('Reativar oficina');
    expect(page.component.confirmSlug).toBe('');

    const reactivating = page.component.reactivate();
    await page.respond('POST', '/admin/tenants/t-1/reactivate', tenant());
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    await reactivating;
    expect(page.text()).toContain('Suspender oficina');
  });

  it('sessão de suporte exige motivo e abre o app da oficina com o token no fragmento', async () => {
    const page = await mountAdmin(TenantDetailPage, { id: 't-1' });
    await page.respond('GET', '/admin/tenants/t-1', { ...tenant(), users: [OWNER] });
    const tab = { location: { href: '' }, close: jasmine.createSpy('close') };
    spyOn(window, 'open').and.returnValue(tab as unknown as Window);

    page.component.supportReason = ' chamado 123: orçamento não envia ';
    let opening = page.component.impersonate();
    expect(
      await page.respond('POST', '/admin/tenants/t-1/impersonate', {
        access_token: 'tok en',
        expires_in: 900,
        tenant_slug: 'oficina-demo',
        app_url: 'https://app.pitstop.test/'
      })
    ).toEqual({
      reason: 'chamado 123: orçamento não envia'
    });
    await opening;
    expect(tab.location.href).toBe('https://app.pitstop.test/suporte#token=tok%20en');
    expect(tab.location.href).not.toContain('?');

    page.component.supportReason = 'outro chamado';
    opening = page.component.impersonate().catch(() => undefined);
    await page.respond('POST', '/admin/tenants/t-1/impersonate', { message: 'Oficina não encontrada.' }, 404);
    await opening;
    expect(tab.close).toHaveBeenCalled();
  });

  it('métricas globais e auditoria filtrável por oficina', async () => {
    const metrics = await mountAdmin(MetricsPage);
    await metrics.respond('GET', '/admin/metrics', {
      tenants_active: 4,
      tenants_trial: 1,
      tenants_suspended: 0,
      tenants_expiring_7d: 1,
      orders_this_month: 80,
      active_users: 17,
      growth: [
        { month: '2026-10', tenants: 3, orders: 40 },
        { month: '2026-11', tenants: 4, orders: 80 }
      ]
    });
    expect(metrics.text()).toContain('4 oficinas ativas');
    expect(metrics.component.height(40)).toBe(50);
    expect(metrics.component.chartLabel()).toBe('Ordens por mês: 10/2026 40, 11/2026 80');

    const audit = await mountAdmin(AuditPage, { tenantId: 't-1' });
    const request = audit.http.expectOne((candidate) => candidate.url === '/api/v1/admin/audit');
    expect(request.request.params.get('tenant_id')).toBe('t-1');
    request.flush({
      data: [
        {
          id: 'a-1',
          tenant_id: 't-1',
          tenant_slug: 'oficina-demo',
          super_admin_email: 'admin@pitstop.app',
          action: 'tenant.suspended',
          payload: { reason: 'inadimplência' },
          created_at: '2026-11-11T09:00:00Z'
        },
        {
          id: 'a-2',
          tenant_id: null,
          tenant_slug: null,
          super_admin_email: 'admin@pitstop.app',
          action: 'catalog.reloaded',
          payload: {},
          created_at: '2026-11-11T08:00:00Z'
        }
      ],
      total: 2,
      page: 1,
      pageSize: 20
    });
    await audit.settle();
    expect(audit.text()).toContain('Oficina suspensa');
    expect(audit.text()).toContain('inadimplência');
    expect(audit.text()).toContain('Catálogo recarregado');
  });

  it('configura o e-mail da plataforma com Gmail e senha de app, testa o envio e remove', async () => {
    const empty = { configured: false, user: null, from_name: null, updated_at: null };
    const ready = { configured: true, user: 'pitstop@gmail.com', from_name: 'PitStop', updated_at: '2026-11-11T12:00:00Z' };
    const page = await mountAdmin(EmailSettingsPage);
    await page.respond('GET', '/admin/email-settings', empty);
    expect(page.text()).toContain('Ainda não configurado');
    expect(page.text()).not.toContain('Enviar um e-mail de teste');

    page.component.draft = { user: ' pitstop@gmail.com ', from_name: ' ', app_password: 'abcd efgh ijkl mnop' };
    let saving = page.component.save();
    expect(await page.respond('PUT', '/admin/email-settings', ready)).toEqual({ user: 'pitstop@gmail.com', app_password: 'abcd efgh ijkl mnop' });
    await saving;
    await page.settle();
    expect(page.text()).toContain('os e-mails saem de pitstop@gmail.com');
    // a senha nunca volta para a tela
    expect(page.component.draft.app_password).toBe('');

    page.component.draft.from_name = 'Oficinas';
    saving = page.component.save();
    expect(await page.respond('PUT', '/admin/email-settings', ready)).toEqual({ user: 'pitstop@gmail.com', from_name: 'Oficinas' });
    await saving;

    let testing = page.component.test();
    expect(await page.respond('POST', '/admin/email-settings/test', {}, 204)).toEqual({});
    await testing;
    expect(TestBed.inject(ToastService).items().at(-1)?.text).toContain('teste enviado');
    page.component.testTo = ' outro@teste.com ';
    testing = page.component.test().catch(() => undefined);
    expect(await page.respond('POST', '/admin/email-settings/test', { message: 'E-mail não enviado: o Gmail recusou o login.' }, 502)).toEqual({
      to: 'outro@teste.com'
    });
    await testing;
    expect(page.component.testing()).toBeFalse();

    spyOn(window, 'confirm').and.returnValues(false, true);
    await page.component.remove();
    const removing = page.component.remove();
    await page.respond('DELETE', '/admin/email-settings', { ...empty, user: 'pitstop@gmail.com' });
    await removing;
    await page.settle();
    expect(page.text()).toContain('não pôde ser lida');
  });
});
