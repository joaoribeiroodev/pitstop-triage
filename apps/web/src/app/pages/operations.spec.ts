import { TestBed } from '@angular/core/testing';
import { ToastService } from '@front/core';
import type { Appointment, FinancialEntry, FinancialSummary, InventoryItem, ReportsOverview } from '@pitstop/shared-types';
import { me, mount, order } from '../../testing/harness';
import { ItemsEditorComponent } from '../ui/items-editor.component';
import { NotifyCustomerComponent } from '../ui/notify.component';
import { ShellComponent } from '../ui/shell.component';
import { FinancialPage } from './financial.page';
import { InventoryPage } from './inventory.page';
import { OrderDetailPage } from './order-detail.page';
import { ReportsPage } from './reports.page';
import { localDay } from '@front/format';
import { SchedulePage } from './schedule.page';
import { NotificationsSettingsPage, SettingsPage } from './settings.page';

const ITEM: InventoryItem = {
  id: 'inv-1',
  sku: 'PD-01',
  name: 'Pastilha dianteira',
  location: 'A3',
  quantity_on_hand: 2,
  minimum_quantity: 4,
  unit_cost: 60,
  unit_price: 120,
  is_active: true,
  low_stock: true,
  created_at: '',
  updated_at: ''
};
const toast = () => TestBed.inject(ToastService).items().at(-1)?.text;

describe('estoque', () => {
  it('mostra saldo, alerta de reposição e valor em estoque; gestão cadastra e movimenta', async () => {
    const page = await mount(InventoryPage, { role: 'owner', flags: { inventory: true } });
    await page.respond('GET', '/inventory/items', [ITEM, { ...ITEM, id: 'inv-2', name: 'Óleo 5W30', low_stock: false, is_active: false }]);
    expect(page.text()).toContain('Pastilha dianteira');
    expect(page.text()).toContain('Repor');
    expect(page.text()).toContain('PD-01 · A3');
    expect([page.component.activeCount(), page.component.lowCount(), page.component.stockValue()]).toEqual([1, 1, 120]);

    await page.click('Novo item');
    page.component.draft = { name: ' Filtro de óleo ', sku: ' FO-1 ', location: '', quantity_on_hand: 5, minimum_quantity: 2, unit_cost: 20, unit_price: 45 };
    const creating = page.component.create();
    expect(await page.respond('POST', '/inventory/items', ITEM)).toEqual({
      name: 'Filtro de óleo',
      sku: 'FO-1',
      location: undefined,
      quantity_on_hand: 5,
      minimum_quantity: 2,
      unit_cost: 20,
      unit_price: 45
    });
    await page.respond('GET', '/inventory/items', [ITEM]);
    await creating;
    expect(toast()).toContain('cadastrado');

    await page.click('Histórico');
    await page.respond('GET', '/inventory/items/inv-1', {
      ...ITEM,
      movements: [
        {
          id: 'm-1',
          inventory_item_id: 'inv-1',
          type: 'out',
          quantity: 2,
          reason: 'Baixa automática da OS 7',
          service_order_id: 'order-1',
          order_number: 7,
          created_at: '2026-11-10T12:00:00Z'
        }
      ]
    });
    expect(page.text()).toContain('OS 7');
    expect(page.text()).toContain('−2');

    await page.click('Movimentar');
    expect(page.text()).toContain('Quantidade');
    page.component.movement = { type: 'adjustment', quantity: 9, reason: ' Inventário ' };
    const moving = page.component.move(ITEM);
    expect(await page.respond('POST', '/inventory/items/inv-1/movements', ITEM)).toEqual({ type: 'adjustment', quantity: 9, reason: 'Inventário' });
    await page.respond('GET', '/inventory/items/inv-1', { ...ITEM, movements: [] });
    await page.respond('GET', '/inventory/items', [ITEM]);
    await moving;
    expect(page.text()).toContain('Nenhuma movimentação ainda.');
    await page.click('Histórico');
    expect(page.component.history()).toBeNull();
    page.component.startMove(ITEM);
    page.component.startMove(ITEM);
    expect(page.component.moving()).toBeNull();

    const toggling = page.component.toggle(ITEM);
    expect(await page.respond('PATCH', '/inventory/items/inv-1', ITEM)).toEqual({ is_active: false });
    await page.respond('GET', '/inventory/items', []);
    await toggling;
    expect(page.text()).toContain('Nenhum item no estoque');

    page.component.q = ' pastilha ';
    page.component.lowOnly = true;
    const searching = page.component.load();
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/inventory/items');
    expect([request.request.params.get('q'), request.request.params.get('low')]).toEqual(['pastilha', 'true']);
    request.flush([]);
    await searching;
    await page.settle();
    expect(page.text()).toContain('Nenhum item encontrado com esse filtro.');
  });

  it('quem não é da gestão só consulta', async () => {
    const page = await mount(InventoryPage, { role: 'mechanic', flags: { inventory: true } });
    await page.respond('GET', '/inventory/items', [ITEM]);
    expect(page.component.canEdit).toBeFalse();
    expect(page.text()).not.toContain('Movimentar');
    expect(page.text()).toContain('Histórico');
  });

  it('no orçamento, a peça escolhida do estoque leva o vínculo e avisa quando falta saldo', async () => {
    const page = await mount(ItemsEditorComponent, {
      flags: { inventory: true },
      inputs: { editable: true, items: [{ id: 'i-1', type: 'part', description: 'Pastilha', quantity: 1, unit_price: 120, inventory_item_id: 'inv-1' }] }
    });
    await page.respond('GET', '/catalog/services', []);
    await page.respond('GET', '/catalog/parts', []);
    await page.respond('GET', '/inventory/items', [ITEM, { ...ITEM, id: 'inv-9', is_active: false }]);
    expect(page.text()).toContain('Estoque');
    expect(page.component.stock().map((item) => item.id)).toEqual(['inv-1']);

    const added: unknown[] = [];
    page.component.added.subscribe((item) => added.push(item));
    page.component.pick = 'e:inv-1';
    page.component.applyPick();
    page.component.draft.quantity = 3;
    await page.settle();
    page.fixture.componentRef.changeDetectorRef.markForCheck();
    await page.settle();
    expect(page.text()).toContain('Ligado ao estoque: Pastilha dianteira');
    page.component.add();
    // trocar para mão de obra desfaz o vínculo
    page.component.pick = 'e:inv-1';
    page.component.applyPick();
    page.component.draft.type = 'service';
    page.component.add();
    expect(added).toEqual([
      { type: 'part', description: 'Pastilha dianteira', quantity: 3, unit_price: 120, inventory_item_id: 'inv-1' },
      { type: 'service', description: 'Pastilha dianteira', quantity: 1, unit_price: 120 }
    ]);
    expect(page.component.linked()).toBeNull();
  });
});

describe('financeiro', () => {
  const SUMMARY: FinancialSummary = {
    receivable_open: 320,
    receivable_overdue: 0,
    payable_open: 500,
    payable_overdue: 500,
    received_this_month: 90,
    paid_this_month: 0
  };
  const ENTRY: FinancialEntry = {
    id: 'f-1',
    type: 'receivable',
    description: 'OS 7 — PIT1A23',
    counterparty: 'Marina Souza',
    amount: 320,
    due_date: '2026-11-10',
    paid_at: null,
    notes: null,
    service_order_id: 'order-1',
    order_number: 7,
    overdue: false,
    created_at: ''
  };

  async function open() {
    const page = await mount(FinancialPage, { role: 'owner', flags: { financial: true } });
    await page.respond('GET', '/financial/summary', SUMMARY);
    await page.respond('GET', '/financial/entries', [
      ENTRY,
      { ...ENTRY, id: 'f-2', description: 'Balcão', service_order_id: null, counterparty: null, overdue: true, due_date: null }
    ]);
    return page;
  }
  const reload = async (page: Awaited<ReturnType<typeof open>>, entries: FinancialEntry[] = [ENTRY]) => {
    await page.respond('GET', '/financial/summary', SUMMARY);
    await page.respond('GET', '/financial/entries', entries);
  };

  it('resume o caixa e lista as contas a receber vindas das OS', async () => {
    const page = await open();
    expect(page.text()).toContain('a receber');
    expect(page.text()).toContain('OS 7');
    expect(page.text()).toContain('Marina Souza');
    expect(page.text()).toContain('Em atraso');
    expect(page.text()).toContain('Sem cliente');

    await page.click('Recebi');
    expect(await page.respond('PATCH', '/financial/entries/f-1', ENTRY)).toEqual({ paid: true });
    await reload(page, [{ ...ENTRY, paid_at: '2026-11-11T10:00:00Z' }]);
    expect(toast()).toBe('Baixa registrada');
    expect(page.text()).toContain('Recebido em');

    await page.click('Reabrir');
    expect(await page.respond('PATCH', '/financial/entries/f-1', ENTRY)).toEqual({ paid: false });
    await reload(page);
    expect(toast()).toBe('Lançamento reaberto');
  });

  it('lança despesa, troca de aba e exclui com confirmação', async () => {
    const page = await open();
    await page.click('Novo lançamento');
    page.component.draft = { type: 'payable', description: ' Fornecedor ', amount: 500, due_date: '2026-12-01', counterparty: ' Auto Peças ' };
    const creating = page.component.create();
    expect(await page.respond('POST', '/financial/entries', ENTRY)).toEqual({
      type: 'payable',
      description: 'Fornecedor',
      amount: 500,
      due_date: '2026-12-01',
      counterparty: 'Auto Peças'
    });
    await reload(page, [
      { ...ENTRY, id: 'f-3', type: 'payable', description: 'Fornecedor', service_order_id: null, counterparty: null, paid_at: '2026-11-11T10:00:00Z' }
    ]);
    await creating;
    expect(page.component.type()).toBe('payable');
    expect(page.text()).toContain('Sem fornecedor');
    expect(page.text()).toContain('Pago em');

    await page.click('A receber');
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/financial/entries');
    expect([request.request.params.get('type'), request.request.params.get('status')]).toEqual(['receivable', 'open']);
    request.flush([]);
    await page.respond('GET', '/financial/summary', SUMMARY);
    expect(page.text()).toContain('Nenhum lançamento nesta situação.');

    spyOn(window, 'confirm').and.returnValues(false, true);
    await page.component.remove(ENTRY);
    const removing = page.component.remove(ENTRY);
    await page.respond('DELETE', '/financial/entries/f-1', {});
    await reload(page, []);
    await removing;
  });
});

describe('agenda', () => {
  const day = localDay(new Date());
  const APPOINTMENT: Appointment = {
    id: 'a-1',
    title: 'Revisão dos 40 mil',
    starts_at: new Date(`${day}T09:00:00`).toISOString(),
    ends_at: new Date(`${day}T11:00:00`).toISOString(),
    bay: 'Box 1',
    mechanic_id: 'member-9',
    mechanic_name: 'Seu Jorge',
    status: 'scheduled',
    notes: 'Trazer chave reserva',
    customer_id: 'cust-1',
    customer_name: 'Marina Souza',
    customer_phone: '71988887777',
    vehicle_id: 'veh-1',
    vehicle_plate: 'PIT1A23',
    vehicle_label: 'Ford Ka',
    service_order_id: null,
    created_at: ''
  };

  async function open(role: 'receptionist' | 'mechanic' = 'receptionist', list: Appointment[] = [APPOINTMENT]) {
    const page = await mount(SchedulePage, { role });
    TestBed.inject((await import('@front/core')).AuthService).me.update(
      (current) => current && { ...current, tenant: { ...current.tenant!, settings: { bays: ['Box 1', 'Box 2'] } } }
    );
    await page.respond('GET', '/users/assignable', [{ id: 'member-9', full_name: 'Seu Jorge', role: 'mechanic' }]);
    await page.respond('GET', '/appointments', list);
    return page;
  }

  it('mostra o dia com box, responsável, cliente e ações de status', async () => {
    const page = await open('receptionist', [
      APPOINTMENT,
      { ...APPOINTMENT, id: 'a-2', title: 'Freios', status: 'confirmed', notes: null, bay: null, mechanic_name: null, vehicle_plate: null, customer_name: null }
    ]);
    expect(page.text()).toContain('09:00');
    expect(page.text()).toContain('Box 1 · Seu Jorge');
    expect(page.text()).toContain('PIT1A23 Ford Ka');
    expect(page.text()).toContain('Trazer chave reserva');
    expect(page.text()).toContain('Sem box · Sem responsável');
    expect([page.component.active().length, page.component.confirmed()]).toEqual([2, 1]);
    expect(page.component.bays()).toEqual(['Box 1', 'Box 2']);

    await page.click('Confirmar');
    expect(await page.respond('PATCH', '/appointments/a-1', APPOINTMENT)).toEqual({ status: 'confirmed' });
    await page.respond('GET', '/appointments', [{ ...APPOINTMENT, status: 'cancelled' }]);
    expect(page.text()).toContain('Cancelado');
    expect(page.component.active()).toEqual([]);

    spyOn(window, 'confirm').and.returnValues(false, true);
    await page.click('Excluir');
    await page.click('Excluir');
    await page.respond('DELETE', '/appointments/a-1', {});
    await page.respond('GET', '/appointments', []);
    expect(page.text()).toContain('Nenhum agendamento neste dia.');
  });

  it('navega entre os dias consultando o intervalo local', async () => {
    const page = await open('mechanic', []);
    expect(page.component.canEdit).toBeFalse();
    expect(page.text()).not.toContain('Novo agendamento');
    page.component.setDay('');
    page.component.setDay('2031-03-10');
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/appointments');
    expect(request.request.params.get('from')).toBe(new Date('2031-03-10T00:00:00').toISOString());
    expect(request.request.params.get('to')).toBe(new Date('2031-03-11T00:00:00').toISOString());
    request.flush([]);
    await page.settle();
    await page.click('→');
    expect(page.component.day()).toBe('2031-03-11');
    await page.respond('GET', '/appointments', []);
    await page.click('←');
    await page.respond('GET', '/appointments', []);
    await page.click('Hoje');
    await page.respond('GET', '/appointments', []);
    expect(page.component.day()).toBe(page.component.today());
  });

  it('cria o agendamento com o veículo achado pela placa e mostra o conflito devolvido pela API', async () => {
    const page = await open('receptionist', []);
    await page.click('Novo agendamento');
    page.component.draft = { title: ' Revisão ', start: '10:00', end: '09:00', bay: 'Box 1', mechanic_id: 'member-9', plate: 'pit-1a23', notes: ' ' };
    await page.component.create();
    expect(page.component.error()).toContain('término');

    page.component.draft.plate = 'abc';
    await page.component.findVehicle();
    page.component.draft.plate = 'zzz9z99';
    const missing = page.component.findVehicle();
    await page.respond('GET', '/vehicles/by-plate/ZZZ9Z99', { message: 'não achei' }, 404);
    await missing;
    expect(page.component.plateMiss()).toBeTrue();
    page.component.draft.plate = 'pit-1a23';
    const finding = page.component.findVehicle();
    await page.respond('GET', '/vehicles/by-plate/PIT1A23', { id: 'veh-1', customer_id: 'cust-1', plate: 'PIT1A23', customer_name: 'Marina Souza' });
    await finding;
    expect(page.text()).toContain('PIT1A23 · Marina Souza');

    page.component.draft.end = '11:30';
    const clashing = page.component.create();
    const sent = await page.respond('POST', '/appointments', { message: 'O box Box 1 já está ocupado nesse horário (Freios).' }, 409);
    await clashing;
    expect(sent).toEqual({
      title: 'Revisão',
      starts_at: new Date(`${page.component.day()}T10:00:00`).toISOString(),
      ends_at: new Date(`${page.component.day()}T11:30:00`).toISOString(),
      bay: 'Box 1',
      mechanic_id: 'member-9',
      vehicle_id: 'veh-1',
      customer_id: 'cust-1',
      notes: undefined
    });
    expect(page.text()).toContain('já está ocupado');

    const creating = page.component.create();
    await page.respond('POST', '/appointments', APPOINTMENT);
    await page.respond('GET', '/appointments', [APPOINTMENT]);
    await creating;
    expect(toast()).toBe('Agendamento criado');
    expect(page.component.adding()).toBeFalse();
  });
});

describe('indicadores', () => {
  const REPORT: ReportsOverview = {
    from: '2026-08-14',
    to: '2026-11-11',
    orders_completed: 2,
    revenue: 420,
    average_ticket: 210,
    average_execution_minutes: 95,
    quotes: { sent: 3, approved: 2, rejected: 1, conversion_pct: 66.7 },
    top_services: [{ description: 'Pastilha dianteira', type: 'part', times: 1, revenue: 240 }],
    by_mechanic: [{ mechanic_name: 'Seu Jorge', orders: 2, revenue: 420 }],
    by_month: [
      { month: '2026-10', orders: 1, revenue: 105 },
      { month: '2026-11', orders: 1, revenue: 315 }
    ]
  };

  it('mostra faturamento, ticket médio, conversão e os rankings do período', async () => {
    const page = await mount(ReportsPage, { role: 'owner' });
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/reports/overview');
    expect(request.request.params.get('to')).toBe(localDay(new Date()));
    request.flush(REPORT);
    await page.settle();
    expect(page.text()).toContain('ticket médio');
    expect(page.text()).toContain('66.7%');
    expect(page.text()).toContain('3 orçamentos enviados: 2 aprovados e 1 recusados');
    expect(page.text()).toContain('Pastilha dianteira');
    expect(page.text()).toContain('Seu Jorge');
    expect([page.component.share(105), page.component.share(315)]).toEqual([33, 100]);
    expect(page.component.monthLabel('2026-11')).toMatch(/nov/);

    await page.click('30 dias');
    await page.respond('GET', '/reports/overview', {
      ...REPORT,
      orders_completed: 0,
      quotes: { sent: 1, approved: 0, rejected: 0, conversion_pct: null },
      by_month: []
    });
    expect(page.component.days()).toBe(30);
    expect(page.text()).toContain('Nenhuma OS foi concluída neste período');
    expect(page.text()).toContain('1 orçamento enviado');
    expect(page.component.share(0)).toBe(0);
  });
});

describe('avisos ao cliente', () => {
  const SETTINGS = {
    templates: { quote_pending: 'Orçamento pronto {link}', status_update: 'Texto da oficina {link}', vehicle_ready: 'Pode buscar {link}' },
    defaults: { quote_pending: 'Orçamento pronto {link}', status_update: 'Padrão de status {link}', vehicle_ready: 'Pode buscar {link}' },
    whatsapp_auto: false,
    api_configured: false
  };

  it('a gestão edita os textos; sem integração o envio automático fica indisponível', async () => {
    const page = await mount(NotificationsSettingsPage, { role: 'owner', flags: { whatsapp: true } });
    await page.respond('GET', '/notifications/settings', SETTINGS);
    expect(page.text()).toContain('{cliente}');
    expect(page.text()).toContain('ainda não está configurada');
    await page.click('Voltar ao texto padrão de "Novidade no serviço"');
    expect(page.component.texts.status_update).toBe('Padrão de status {link}');
    page.component.auto = true;
    const saving = page.component.save();
    expect(await page.respond('PATCH', '/notifications/settings', SETTINGS)).toEqual({ ...SETTINGS.defaults });
    await saving;
    expect(toast()).toBe('Avisos salvos');
  });

  it('com a integração configurada, liga o envio automático; os demais só leem', async () => {
    const page = await mount(NotificationsSettingsPage, { role: 'manager', flags: { whatsapp: true } });
    await page.respond('GET', '/notifications/settings', { ...SETTINGS, api_configured: true });
    expect(page.text()).toContain('a falha fica registrada');
    page.component.auto = true;
    const saving = page.component.save();
    expect(await page.respond('PATCH', '/notifications/settings', { ...SETTINGS, api_configured: true, whatsapp_auto: true })).toEqual({
      ...SETTINGS.templates,
      whatsapp_auto: true
    });
    await saving;
    expect(page.component.auto).toBeTrue();

    const reader = await mount(NotificationsSettingsPage, { flags: { whatsapp: true } });
    await reader.respond('GET', '/notifications/settings', SETTINGS);
    expect(reader.text()).toContain('Só a gestão da oficina altera estes textos.');
  });

  it('na OS, gera a mensagem pronta e mostra o histórico de avisos', async () => {
    const page = await mount(NotifyCustomerComponent, { flags: { whatsapp: true }, inputs: { orderId: 'order-1' } });
    await page.respond('GET', '/notifications/orders/order-1/history', { message: 'x' }, 500);
    expect(page.component.history()).toEqual([]);

    await page.click('Veículo pronto');
    expect(
      await page.respond('POST', '/notifications/orders/order-1/preview', {
        event: 'vehicle_ready',
        message: 'Seu Ford Ka está pronto',
        whatsapp_url: 'https://wa.me/5571988887777?text=oi'
      })
    ).toEqual({ event: 'vehicle_ready' });
    await page.respond('GET', '/notifications/orders/order-1/history', [
      {
        id: 'n-1',
        event: 'vehicle_ready',
        channel: 'whatsapp_api',
        recipient: '71988887777',
        status: 'failed',
        detail: 'HTTP 503',
        created_at: '2026-11-10T12:00:00Z'
      }
    ]);
    const element = page.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('textarea')?.value).toBe('Seu Ford Ka está pronto');
    expect(element.querySelector('a.btn-go')?.getAttribute('href')).toContain('wa.me/5571988887777');
    expect(page.text()).toContain('Veículo pronto, envio automático: falhou');
    expect(page.text()).toContain('HTTP 503');

    await page.click('Novidade no serviço');
    await page.respond('POST', '/notifications/orders/order-1/preview', { event: 'status_update', message: 'Novidade', whatsapp_url: null });
    await page.respond('GET', '/notifications/orders/order-1/history', []);
    expect(page.text()).toContain('não tem um celular válido');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
    await page.component.copy('Novidade');
    expect(toast()).toBe('Mensagem copiada');
  });

  it('a OS mostra o resumo por IA e o bloco de avisos quando os módulos estão ativos', async () => {
    const base = order();
    const page = await mount(OrderDetailPage, { flags: { whatsapp: true, ai: true }, inputs: { id: 'order-1' } });
    await page.respond('GET', '/triage/catalog', []);
    await page.respond('GET', '/users/assignable', []);
    await page.respond('GET', '/service-orders/order-1', {
      ...base,
      mechanic_suggestions_snapshot: { ...base.mechanic_suggestions_snapshot!, ai_note: 'Comece pelas pastilhas.' }
    });
    page.component.setSuggestionsHidden(false);
    await page.settle();
    expect(page.text()).toContain('Resumo por IA');
    expect(page.text()).toContain('Comece pelas pastilhas.');
    page.component.tab.set('quote');
    await page.settle();
    await page.respond('GET', '/catalog/services', []);
    await page.respond('GET', '/catalog/parts', []);
    await page.respond('GET', '/notifications/orders/order-1/history', []);
    expect(page.text()).toContain('Avisar o cliente');
  });
});

describe('navegação e ajustes dos módulos', () => {
  it('o menu mostra agenda, estoque, financeiro e indicadores conforme módulos e papel', async () => {
    const owner = await mount(ShellComponent, { role: 'owner', flags: { inventory: true, financial: true } });
    await owner.respond('GET', '/dashboard/summary', { pending_triage: 0 });
    for (const label of ['Agenda', 'Estoque', 'Financeiro', 'Indicadores']) expect(owner.text()).toContain(label);

    const mechanic = await mount(ShellComponent, { role: 'mechanic', flags: { inventory: true, financial: true, schedule: false } });
    await mechanic.respond('GET', '/dashboard/summary', { pending_triage: 0 });
    expect(mechanic.text()).toContain('Estoque');
    for (const label of ['Agenda', 'Financeiro', 'Indicadores']) expect(mechanic.text()).not.toContain(label);
  });

  it('ajustes oferecem os avisos ao cliente e os boxes da agenda', async () => {
    const page = await mount(SettingsPage, { role: 'owner', flags: { whatsapp: true } });
    expect(page.text()).toContain('Avisos ao cliente');
    expect(page.text()).toContain('Boxes da oficina');
    expect(me('owner').tenant?.feature_flags.schedule).toBeTrue();
  });
});
