import { TestBed } from '@angular/core/testing';
import { AuthService, ToastService } from '@front/core';
import type { Customer, DashboardSummary, Vehicle } from '@pitstop/shared-types';
import { me, mount } from '../../testing/harness';
import { ItemsEditorComponent } from '../ui/items-editor.component';
import { ShellComponent } from '../ui/shell.component';
import { VehicleFormComponent } from '../ui/vehicle-form.component';
import { VehiclePickerComponent } from '../ui/vehicle-picker.component';
import { CustomerDetailPage, CustomersPage } from './customers.page';
import { DashboardPage } from './dashboard.page';
import { BlockedPage, LoginPage, SupportSessionPage } from './login.page';
import { CatalogPage, SettingsPage, UsersPage } from './settings.page';
import { VehicleDetailPage, VehiclesPage } from './vehicles.page';

const CUSTOMER: Customer = {
  id: 'cust-1',
  name: 'Marina Souza',
  phone: '71988887777',
  email: null,
  document: null,
  notes: null,
  anonymized_at: null,
  created_at: '',
  updated_at: '',
  vehicles_count: 1
};
const VEHICLE: Vehicle = {
  id: 'veh-1',
  customer_id: 'cust-1',
  plate: 'PIT1A23',
  brand: 'Ford',
  model: 'Ka',
  year: 2019,
  color: 'Prata',
  vin: null,
  fuel_type: 'Flex',
  current_mileage: 68000,
  notes: null,
  created_at: '',
  updated_at: '',
  customer_name: 'Marina Souza',
  customer_phone: '71988887777'
};
const SUMMARY: DashboardSummary = {
  opened_today: 2,
  awaiting_approval: 1,
  in_progress: 3,
  completed_this_week: 4,
  pending_triage: 2,
  needs_action: [],
  onboarding: { team: true, catalog: false, first_order: false }
};
const paged = <T>(data: T[]) => ({ data, total: data.length, page: 1, pageSize: 20 });

describe('entrada e sessão', () => {
  it('login leva ao painel, ou de volta à tela pedida; erro aparece na própria tela', async () => {
    const page = await mount(LoginPage, { anonymous: true, inputs: { voltar: '/service-orders/abc' } });
    const navigate = spyOn(page.router, 'navigateByUrl').and.resolveTo(true);
    page.component.email = ' recepcao@demo.local ';
    page.component.password = 'errada';
    let submitting = page.component.submit();
    await page.respond('POST', '/auth/login', { message: 'E-mail ou senha inválidos.' }, 401);
    await submitting;
    expect(page.text()).toContain('E-mail ou senha inválidos.');

    submitting = page.component.submit();
    expect(await page.respond('POST', '/auth/login', { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 })).toEqual({
      email: 'recepcao@demo.local',
      password: 'errada'
    });
    await page.respond('GET', '/auth/me', me());
    await submitting;
    expect(navigate).toHaveBeenCalledWith('/service-orders/abc');
  });

  it('conta sem oficina vai para a tela de bloqueio, que explica o motivo', async () => {
    const page = await mount(LoginPage, { anonymous: true });
    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    const submitting = page.component.submit();
    await page.respond('POST', '/auth/login', { access_token: 'jwt', refresh_token: 'r', expires_in: 3600 });
    await page.respond('GET', '/auth/me', { ...me(), tenant: null, membership: null });
    await submitting;
    expect(navigate).toHaveBeenCalledWith(['/bloqueado'], { queryParams: { motivo: 'NO_TENANT' } });

    const blocked = await mount(BlockedPage, { inputs: { motivo: 'TENANT_SUSPENDED' } });
    expect(blocked.text()).toContain('Acesso suspenso');
    const leave = spyOn(blocked.router, 'navigate').and.resolveTo(true);
    const leaving = blocked.component.leave();
    await blocked.respond('POST', '/auth/logout', {});
    await leaving;
    expect(leave).toHaveBeenCalledWith(['/login']);
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeFalse();
  });

  it('sessão de suporte sem token no link é recusada', async () => {
    const page = await mount(SupportSessionPage, { anonymous: true });
    expect(page.text()).toContain('Link de suporte inválido.');
  });

  it('casca: menu segue papel e módulos, mostra pendências de triagem e avisa em sessão de suporte', async () => {
    const page = await mount(ShellComponent);
    await page.respond('GET', '/dashboard/summary', SUMMARY);
    expect(page.text()).toContain('Oficina Demo');
    expect(page.text()).toContain('Triagem 2');
    expect(page.component.roleLabel()).toBe('Recepção');

    const auth = TestBed.inject(AuthService);
    auth.me.set({ ...me('owner', { triage: false }), impersonated_by: 'admin@pitstop.app' });
    await page.settle();
    expect(page.text()).not.toContain('Triagem');
    expect(page.text()).toContain('Sessão de suporte (admin@pitstop.app)');
  });

  it('painel: indicadores, aviso de triagens pendentes e lista vazia explicada', async () => {
    const page = await mount(DashboardPage);
    await page.respond('GET', '/dashboard/summary', SUMMARY);
    expect(page.text()).toContain('2 abertas hoje');
    expect(page.text()).toContain('2 triagens pendentes');
    expect(page.text()).toContain('Nada pendente por aqui.');
    // recepção não vê os primeiros passos: é tarefa da gestão
    expect(page.text()).not.toContain('Primeiros passos');

    const owner = await mount(DashboardPage, { role: 'owner' });
    await owner.respond('GET', '/dashboard/summary', SUMMARY);
    expect(owner.text()).toContain('Primeiros passos');
    expect((owner.fixture.nativeElement as HTMLElement).querySelectorAll('.onboard li.done').length).toBe(1);
    expect(owner.component.showOnboarding({ ...SUMMARY, onboarding: { team: true, catalog: true, first_order: true } })).toBeFalse();
  });
});

describe('clientes e veículos', () => {
  it('lista, busca e cadastra cliente', async () => {
    const page = await mount(CustomersPage);
    await page.respond('GET', '/customers', paged([CUSTOMER]));
    expect(page.text()).toContain('(71) 98888-7777');
    page.component.q = 'mar';
    const loading = page.component.load(1);
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/customers');
    expect(request.request.params.get('q')).toBe('mar');
    request.flush(paged([]));
    await loading;
    await page.settle();
    expect(page.text()).toContain('Nenhum cliente encontrado para essa busca.');

    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    page.component.draft = { name: 'João', phone: '', email: '' };
    const creating = page.component.create();
    expect(await page.respond('POST', '/customers', { ...CUSTOMER, id: 'cust-2' })).toEqual({ name: 'João', phone: undefined, email: undefined });
    await creating;
    expect(navigate).toHaveBeenCalledWith(['/customers', 'cust-2']);
  });

  it('ficha do cliente: edita, exporta e anonimiza (LGPD) só para o proprietário', async () => {
    const detail = { ...CUSTOMER, vehicles: [VEHICLE], orders: [] };
    const page = await mount(CustomerDetailPage, { role: 'owner', inputs: { id: 'cust-1' } });
    await page.respond('GET', '/customers/cust-1', detail);
    expect(page.text()).toContain('Privacidade (LGPD)');
    expect(page.text()).toContain('PIT 1A23');

    page.component.form.name = 'Marina S.';
    const saving = page.component.save();
    expect(await page.respond('PATCH', '/customers/cust-1', detail)).toEqual({ name: 'Marina S.', phone: '71988887777', document: '', notes: '' });
    await page.respond('GET', '/customers/cust-1', detail);
    await saving;

    spyOn(window, 'confirm').and.returnValues(false, true);
    await page.component.anonymize();
    const anonymizing = page.component.anonymize();
    expect(await page.respond('POST', '/customers/cust-1/anonymize', {})).toEqual({ confirm: true });
    await page.respond('GET', '/customers/cust-1', { ...detail, name: 'Cliente anonimizado', anonymized_at: '2026-11-10T12:00:00Z' });
    await anonymizing;
    expect(page.text()).toContain('Dados pessoais anonimizados');
    expect(page.text()).not.toContain('Privacidade (LGPD)');

    const exporting = page.component.exportData();
    await page.respond('GET', '/customers/cust-1/export', { customer: detail });
    await exporting;

    const added = page.component.vehicleSaved();
    await page.respond('GET', '/customers/cust-1', detail);
    await added;
  });

  it('veículos: lista e ficha com histórico de serviços', async () => {
    const list = await mount(VehiclesPage);
    await list.respond('GET', '/vehicles', paged([VEHICLE]));
    expect(list.text()).toContain('Marina Souza');

    const page = await mount(VehicleDetailPage, { inputs: { id: 'veh-1' } });
    await page.respond('GET', '/vehicles/veh-1', { ...VEHICLE, orders: [] });
    expect(page.text()).toContain('Primeira visita');
    expect(page.text()).toContain('Nova triagem');
    const saved = page.component.saved();
    await page.respond('GET', '/vehicles/veh-1', { ...VEHICLE, orders: [] });
    await saved;
  });

  it('cadastro de veículo: consulta de placa preenche, e a falha dela nunca impede salvar', async () => {
    const page = await mount(VehicleFormComponent, { inputs: { customerId: 'cust-1', initialPlate: 'ABC1D23' } });
    let looking = page.component.lookup();
    await page.respond('GET', '/vehicles/lookup/ABC1D23', { message: 'Consulta de placa indisponível no momento. Preencha os dados manualmente.' }, 503);
    await looking;
    expect(page.component.hint()).toContain('manualmente');
    expect(TestBed.inject(ToastService).items()).toEqual([]);

    looking = page.component.lookup();
    await page.respond('GET', '/vehicles/lookup/ABC1D23', { brand: 'Ford', model: 'Ka', year: 2019, color: 'Prata' });
    await looking;
    expect(page.component.form.brand).toBe('Ford');
    await page.component.lookup();

    let emitted: Vehicle | undefined;
    page.component.saved.subscribe((vehicle) => (emitted = vehicle));
    const saving = page.component.save();
    const sent = (await page.respond('POST', '/vehicles', VEHICLE)) as Record<string, unknown>;
    await saving;
    expect(sent).toEqual(jasmine.objectContaining({ customer_id: 'cust-1', plate: 'ABC1D23', brand: 'Ford', year: 2019 }));
    expect(emitted?.id).toBe('veh-1');

    const editing = await mount(VehicleFormComponent, { inputs: { vehicle: VEHICLE } });
    expect(editing.component.form.plate).toBe('PIT1A23');
    const updating = editing.component.save();
    await editing.respond('PATCH', '/vehicles/veh-1', VEHICLE);
    await updating;
  });

  it('seletor de veículo: busca por placa ou nome e cadastra cliente novo com a placa já preenchida', async () => {
    const page = await mount(VehiclePickerComponent);
    let picked: Vehicle | undefined;
    page.component.picked.subscribe((vehicle) => (picked = vehicle));
    await page.component.search();

    page.component.term = 'abc-1d23';
    let searching = page.component.search();
    await page.respond('GET', '/vehicles', paged([]));
    await page.respond('GET', '/customers', paged([]));
    await searching;
    expect(page.text()).toContain('Nada encontrado para “abc-1d23”');
    expect(page.component.plateGuess()).toBe('ABC1D23');

    page.component.startCreating();
    expect(page.component.draft).toEqual({ name: '', phone: '' });
    page.component.draft = { name: 'João', phone: '71999990000' };
    const creating = page.component.createCustomer();
    await page.respond('POST', '/customers', { ...CUSTOMER, id: 'cust-2', name: 'João' });
    await creating;
    expect(page.component.customer()?.vehicles).toEqual([]);
    page.component.pickFrom(page.component.customer()!, VEHICLE);
    expect(picked).toEqual(jasmine.objectContaining({ customer_id: 'cust-2', customer_name: 'João' }));

    page.component.term = 'Marina';
    searching = page.component.search();
    await page.respond('GET', '/vehicles', paged([VEHICLE]));
    await page.respond('GET', '/customers', paged([CUSTOMER]));
    await searching;
    expect(page.text()).toContain('Veículos encontrados');
    page.component.startCreating();
    expect(page.component.draft.name).toBe('Marina');
    page.component.term = '(71) 98888-7777';
    page.component.lastTerm.set('71988887777');
    page.component.startCreating();
    expect(page.component.draft.phone).toBe('71988887777');

    const opening = page.component.openCustomer('cust-1');
    await page.respond('GET', '/customers/cust-1', { ...CUSTOMER, vehicles: [VEHICLE] });
    await opening;
    expect(page.component.customer()?.vehicles.length).toBe(1);
  });
});

describe('ajustes e orçamento', () => {
  it('preferências só para o proprietário; salvar recarrega a sessão', async () => {
    const reception = await mount(SettingsPage);
    expect(reception.text()).not.toContain('Preferências da oficina');
    expect(reception.text()).toContain('Catálogo de serviços e peças');

    const page = await mount(SettingsPage, { role: 'owner' });
    expect(page.text()).toContain('Usuários');
    page.component.form = { mechanics_see_all_orders: true, portal_token_days: 15, bays: ' Box 1 \n\nElevador', timezone: 'America/Manaus' };
    const saving = page.component.save();
    expect(await page.respond('PATCH', '/tenant/settings', {})).toEqual({
      mechanics_see_all_orders: true,
      portal_token_days: 15,
      timezone: 'America/Manaus',
      bays: ['Box 1', 'Elevador']
    });
    expect(page.component.timezones[0].label).toMatch(/^São Paulo \(GMT-3\)$/);
    await page.respond('GET', '/auth/me', me('owner'));
    await saving;
  });

  it('usuários: cria com convite, muda papel e desativa', async () => {
    const user = {
      id: 'm-2',
      tenant_id: 'tenant-1',
      user_id: 'u-2',
      role: 'mechanic' as const,
      full_name: 'Seu Jorge',
      email: 'jorge@demo.local',
      is_active: true,
      created_at: ''
    };
    const page = await mount(UsersPage, { role: 'owner' });
    await page.respond('GET', '/users', [user]);
    expect(page.component.activeCount()).toBe(1);
    expect(page.text()).toContain('1 de 15 usuários ativos');

    page.component.draft = { full_name: 'Ana', email: 'ana@demo.local', role: 'receptionist', password: '' };
    const creating = page.component.create();
    expect(await page.respond('POST', '/users', { ...user, id: 'm-3', invited: true })).toEqual({
      full_name: 'Ana',
      email: 'ana@demo.local',
      role: 'receptionist'
    });
    await page.respond('GET', '/users', [user]);
    await creating;
    expect(TestBed.inject(ToastService).items().at(-1)?.text).toContain('convite');

    const updating = page.component.update(user, { is_active: false });
    expect(await page.respond('PATCH', '/users/m-2', {})).toEqual({ is_active: false });
    await page.respond('GET', '/users', [{ ...user, is_active: false }]);
    await updating;
    expect(page.text()).toContain('Desativado');
  });

  it('catálogo: serviços e peças com preço padrão, edição só para gestão', async () => {
    const service = { id: 's-1', name: 'Alinhamento', description: null, default_price: 90, duration_minutes: 40, is_active: true };
    const page = await mount(CatalogPage, { role: 'owner' });
    await page.respond('GET', '/catalog/services', [service]);
    expect(page.text()).toContain('Alinhamento');

    page.component.draft = { name: ' Balanceamento ', default_price: 60, duration_minutes: 30, sku: '' };
    const creating = page.component.create();
    expect(await page.respond('POST', '/catalog/services', service)).toEqual({ name: 'Balanceamento', default_price: 60, duration_minutes: 30 });
    await page.respond('GET', '/catalog/services', [service]);
    await creating;

    const pricing = page.component.setPrice(service, '110.456');
    expect(await page.respond('PATCH', '/catalog/services/s-1', service)).toEqual({ default_price: 110.46 });
    await page.respond('GET', '/catalog/services', [service]);
    await pricing;
    const invalid = page.component.setPrice(service, '-5');
    await page.respond('GET', '/catalog/services', [service]);
    await invalid;

    const toggling = page.component.toggle(service);
    expect(await page.respond('PATCH', '/catalog/services/s-1', service)).toEqual({ is_active: false });
    await page.respond('GET', '/catalog/services', [service]);
    await toggling;

    spyOn(window, 'confirm').and.returnValues(false, true);
    await page.component.remove(service);
    const removing = page.component.remove(service);
    await page.respond('DELETE', '/catalog/services/s-1', {});
    await page.respond('GET', '/catalog/services', []);
    await removing;

    page.component.setKind('parts');
    await page.respond('GET', '/catalog/parts', []);
    page.component.draft = { name: 'Filtro', default_price: 35, duration_minutes: null, sku: ' FO-1 ' };
    const part = page.component.create();
    expect(await page.respond('POST', '/catalog/parts', {})).toEqual({ name: 'Filtro', default_price: 35, sku: 'FO-1' });
    await page.respond('GET', '/catalog/parts', []);
    await part;

    const reception = await mount(CatalogPage);
    await reception.respond('GET', '/catalog/services', [service]);
    expect(reception.component.canEdit).toBeFalse();
  });

  it('itens do orçamento: soma o total e adiciona do catálogo ou à mão', async () => {
    const page = await mount(ItemsEditorComponent, {
      inputs: { editable: true, items: [{ id: 'i-1', type: 'service', description: 'Troca de pastilhas', quantity: 2, unit_price: 60 }] }
    });
    await page.respond('GET', '/catalog/services', [
      { id: 's-1', name: 'Alinhamento', description: null, default_price: 90, duration_minutes: 40, is_active: true }
    ]);
    await page.respond('GET', '/catalog/parts', [
      { id: 'p-1', name: 'Filtro', sku: null, default_price: 35, is_active: true },
      { id: 'p-2', name: 'Fora de linha', sku: null, default_price: 1, is_active: false }
    ]);
    expect(page.component.total()).toBe(120);
    expect(page.component.parts().map((part) => part.name)).toEqual(['Filtro']);

    const added: unknown[] = [];
    page.component.added.subscribe((item) => added.push(item));
    page.component.pick = 'p:p-1';
    page.component.applyPick();
    page.component.add();
    page.component.pick = 's:s-1';
    page.component.applyPick();
    page.component.draft.description = '  Alinhamento 3D ';
    page.component.add();
    expect(added).toEqual([
      { type: 'part', description: 'Filtro', quantity: 1, unit_price: 35 },
      { type: 'service', description: 'Alinhamento 3D', quantity: 1, unit_price: 90 }
    ]);

    const readonly = await mount(ItemsEditorComponent, { inputs: { items: [] } });
    readonly.http.expectNone((request) => request.url.includes('/catalog'));
    expect(readonly.text()).toContain('Nenhum item ainda.');
  });
});
