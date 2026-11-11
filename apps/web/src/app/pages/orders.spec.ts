import type { Quote, SendQuoteResponse, ServiceOrderSummary } from '@pitstop/shared-types';
import { ToastService } from '@front/core';
import { TestBed } from '@angular/core/testing';
import { CATALOG, mount, order, type Page } from '../../testing/harness';
import { OrderDetailPage } from './order-detail.page';
import { NewOrderPage, OrdersBoardPage } from './orders-board.page';
import { QuotePage } from './quote.page';

const TEAM = [
  { id: 'member-9', full_name: 'Seu Jorge', role: 'mechanic' },
  { id: 'member-1', full_name: 'Rafa', role: 'receptionist' }
];

async function openOrder(overrides = {}, options: Parameters<typeof mount>[1] = {}): Promise<Page<OrderDetailPage>> {
  const page = await mount(OrderDetailPage, { inputs: { id: 'order-1' }, ...options });
  await page.respond('GET', '/triage/catalog', CATALOG);
  await page.respond('GET', '/users/assignable', TEAM);
  await page.respond('GET', '/service-orders/order-1', order(overrides));
  return page;
}

describe('detalhe da ordem de serviço', () => {
  it('abre na aba do momento da OS e mostra o relato com as perguntas respondidas', async () => {
    const page = await openOrder({ status: 'draft', allowed_transitions: ['diagnosis', 'cancelled'], mechanic_suggestions_snapshot: null });
    expect(page.component.tab()).toBe('symptoms');
    expect(page.text()).toContain('OS 7');
    expect(page.text()).toContain('Chiado ao frear');
    expect(page.text()).toContain('Quando acontece?');
    expect(page.text()).toContain('Piora na descida');
    expect(page.component.advances()).toEqual(['diagnosis']);

    await page.click('Iniciar diagnóstico');
    const sent = await page.respond('POST', '/service-orders/order-1/status', order());
    expect(sent).toEqual({ status: 'diagnosis', note: undefined });
    expect(page.component.tab()).toBe('diagnosis');
  });

  it('mostra as sugestões como apoio, em painel lateral, e deixa ignorar', async () => {
    const page = await openOrder();
    // em tela estreita o painel começa fechado; o teste parte do painel aberto, qualquer que seja a janela
    page.component.setSuggestionsHidden(false);
    await page.settle();
    expect(page.component.showSuggestions()).toBeTrue();
    const aside = (page.fixture.nativeElement as HTMLElement).querySelector('aside.suggestions');
    expect(aside?.textContent).toContain('Considere verificar: Pastilhas desgastadas.');
    expect(aside?.textContent).toContain('nada aqui é obrigatório');
    expect((page.fixture.nativeElement as HTMLElement).querySelector('dialog')).toBeNull();

    await page.click('Ignorar sugestões');
    expect((page.fixture.nativeElement as HTMLElement).querySelector('aside.suggestions')).toBeNull();
    expect(localStorage.getItem('pitstop.sugestoes.ocultas.order-1')).toBe('1');
    await page.click('Mostrar sugestões');
    expect(page.component.showSuggestions()).toBeTrue();
  });

  it('sem o módulo de diagnóstico a OS funciona igual, só sem o painel', async () => {
    const page = await openOrder({}, { flags: { diagnostics: false } });
    expect(page.component.hasSuggestions()).toBeFalse();
    expect(page.text()).toContain('Diagnóstico do mecânico');
  });

  it('salva o diagnóstico e as causas confirmadas (das sugestões ou escritas à mão)', async () => {
    const page = await openOrder();
    page.component.toggleCause('brake_noise', 'Pastilhas desgastadas');
    let sent = await page.respond(
      'PATCH',
      '/service-orders/order-1',
      order({ confirmed_causes: [{ symptom_code: 'brake_noise', cause_description: 'Pastilhas desgastadas' }] })
    );
    expect(sent).toEqual({ mechanic_diagnosis: '', confirmed_causes: [{ symptom_code: 'brake_noise', cause_description: 'Pastilhas desgastadas' }] });
    expect(page.component.isConfirmed('brake_noise', 'Pastilhas desgastadas')).toBeTrue();

    page.component.newCause = { symptom_code: 'brake_noise', cause_description: '  Disco empenado ' };
    page.component.addCustomCause();
    sent = await page.respond('PATCH', '/service-orders/order-1', order());
    expect((sent as { confirmed_causes: unknown[] }).confirmed_causes.length).toBe(2);

    page.component.causes.set([{ symptom_code: 'brake_noise', cause_description: 'Pastilhas desgastadas' }]);
    page.component.removeCause(0);
    await page.respond('PATCH', '/service-orders/order-1', order());
    expect(page.component.causes()).toEqual([]);
  });

  it('registra o diagnóstico com aviso e notas com visibilidade escolhida', async () => {
    const page = await openOrder();
    page.component.diagnosis = 'Pastilhas no fim';
    const saving = page.component.saveDiagnosis();
    await page.respond('PATCH', '/service-orders/order-1', order({ mechanic_diagnosis: 'Pastilhas no fim' }));
    await saving;
    expect(TestBed.inject(ToastService).items().at(-1)?.text).toBe('Diagnóstico salvo');

    page.component.note = { body: ' Peça chega amanhã ', visible: true };
    const noting = page.component.addNote();
    const sent = await page.respond(
      'POST',
      '/service-orders/order-1/notes',
      order({ notes: [{ id: 'n-1', author_name: 'Rafa', body: 'Peça chega amanhã', visible_to_customer: true, created_at: '2026-11-10T13:00:00Z' }] })
    );
    await noting;
    expect(sent).toEqual({ body: 'Peça chega amanhã', visible_to_customer: true });
    expect(page.text()).toContain('Visível ao cliente');

    const recomputing = page.component.recompute();
    await page.respond('POST', '/service-orders/order-1/recompute-suggestions', order());
    await recomputing;
  });

  it('monta itens, inclusive a partir de uma peça sugerida, e envia o orçamento', async () => {
    const page = await openOrder();
    page.component.tab.set('quote');
    await page.settle();
    await page.respond('GET', '/catalog/services', [
      { id: 's-1', name: 'Troca de pastilhas', description: null, default_price: 120, duration_minutes: 60, is_active: true }
    ]);
    await page.respond('GET', '/catalog/parts', []);

    const part = order().mechanic_suggestions_snapshot!.suggestions[0].parts[0];
    const adding = page.component.addPart(part);
    const item = { id: 'i-1', type: 'part' as const, description: 'Jogo de pastilhas', quantity: 1, unit_price: 189.9, total: 189.9, sort_order: 1 };
    const sentItem = await page.respond('POST', '/service-orders/order-1/items', order({ items: [item], total_amount: 189.9 }));
    await adding;
    expect(sentItem).toEqual({ type: 'part', description: 'Jogo de pastilhas', quantity: 1, unit_price: 189.9 });
    expect(page.text()).toContain('R$ 189,90');

    const removing = page.component.removeItem(0);
    await page.respond('DELETE', '/service-orders/order-1/items/i-1', order({ items: [] }));
    await removing;
    await page.component.removeItem(5);

    page.component.order.set(order({ items: [item] }));
    const sending = page.component.sendQuote();
    const quote: Quote = {
      id: 'q-1',
      service_order_id: 'order-1',
      version: 1,
      total_amount: 189.9,
      status: 'draft',
      sent_at: null,
      responded_at: null,
      responded_via: null,
      expires_at: null,
      response_notes: null,
      created_at: '2026-11-10T13:00:00Z'
    };
    await page.respond('POST', '/service-orders/order-1/quotes', quote);
    const result: SendQuoteResponse = {
      quote: { ...quote, status: 'sent' },
      portal_url: 'https://app.pitstop.test/portal/abc',
      message: 'Olá, Marina!',
      whatsapp_url: 'https://wa.me/5571988887777?text=oi',
      expires_at: '2026-12-10T13:00:00Z'
    };
    await page.respond('POST', '/quotes/q-1/send', result);
    await page.respond(
      'GET',
      '/service-orders/order-1',
      order({
        status: 'awaiting_approval',
        items: [item],
        quotes: [{ ...quote, status: 'sent', sent_at: '2026-11-10T13:00:00Z' }],
        allowed_transitions: ['cancelled']
      })
    );
    await sending;
    expect(page.component.tab()).toBe('quote');
    expect(page.text()).toContain('Orçamento enviado para aprovação');
    expect((page.fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[aria-label="Link de aprovação"]')?.value).toBe(
      'https://app.pitstop.test/portal/abc'
    );
    expect(page.text()).toContain('Abrir no WhatsApp');
    expect(page.text()).toContain('Registrar aprovação');
    expect(page.component.itemsEditable()).toBeFalse();
  });

  it('a oficina registra a resposta dada no balcão e gera link só de acompanhamento', async () => {
    const quote: Quote = {
      id: 'q-1',
      service_order_id: 'order-1',
      version: 1,
      total_amount: 100,
      status: 'sent',
      sent_at: '2026-11-10T13:00:00Z',
      responded_at: null,
      responded_via: null,
      expires_at: null,
      response_notes: null,
      created_at: '2026-11-10T13:00:00Z'
    };
    const page = await openOrder({ status: 'awaiting_approval', quotes: [quote], allowed_transitions: ['cancelled'] });
    expect(page.component.tab()).toBe('quote');
    await page.respond('GET', '/catalog/services', []).catch(() => undefined);

    spyOn(window, 'prompt').and.returnValues(null, 'por telefone');
    await page.component.respond(quote, 'approve');
    page.http.expectNone('/api/v1/quotes/q-1/approve');
    const responding = page.component.respond(quote, 'approve');
    const sent = await page.respond('POST', '/quotes/q-1/approve', { ...quote, status: 'approved' });
    await page.respond('GET', '/service-orders/order-1', order({ status: 'approved', allowed_transitions: ['in_progress', 'cancelled'] }));
    await responding;
    expect(sent).toEqual({ notes: 'por telefone' });
    expect(page.component.advances()).toEqual(['in_progress']);

    const linking = page.component.issueTracking();
    await page.respond('POST', '/service-orders/order-1/access-links', {
      portal_url: 'https://app.pitstop.test/portal/xyz',
      expires_at: '2026-12-10T00:00:00Z'
    });
    await linking;
    expect(page.component.trackingUrl()).toBe('https://app.pitstop.test/portal/xyz');
  });

  it('atribui mecânico, cancela com motivo e trava a OS encerrada', async () => {
    const page = await openOrder();
    const assigning = page.component.assign('member-9');
    const sent = await page.respond('PATCH', '/service-orders/order-1', order({ assigned_mechanic_id: 'member-9', assigned_mechanic_name: 'Seu Jorge' }));
    await assigning;
    expect(sent).toEqual({ assigned_mechanic_id: 'member-9' });

    spyOn(window, 'prompt').and.returnValues(null, ' cliente desistiu ');
    await page.component.cancel();
    const cancelling = page.component.cancel();
    const body = await page.respond('POST', '/service-orders/order-1/status', order({ status: 'cancelled', allowed_transitions: [] }));
    await cancelling;
    expect(body).toEqual({ status: 'cancelled', note: 'cliente desistiu' });
    expect(page.component.closed()).toBeTrue();
    expect(page.component.canCancel()).toBeFalse();
    expect(page.text()).not.toContain('Salvar diagnóstico');
  });

  it('mecânico não atribui a outros, mas pode assumir uma OS livre; timeline lista o histórico', async () => {
    const page = await openOrder({ status: 'approved', allowed_transitions: ['in_progress', 'cancelled'] }, { role: 'mechanic' });
    expect(page.component.canAssign).toBeFalse();
    expect(page.component.canCancel()).toBeFalse();
    expect(page.component.canSend()).toBeFalse();
    expect(page.component.tab()).toBe('timeline');
    expect(page.text()).toContain('Assumir esta OS');
    expect(page.text()).toContain('Rascunho');
    expect(page.component.symptomName('desconhecido')).toBe('desconhecido');
    expect(page.component.percent(0.426)).toBe('43%');
    expect(page.component.checkMeta({ name: 'x', tools: ['Paquímetro'], estimated_minutes: 15, shop_price: null, shop_duration_minutes: null })).toBe(
      '15 min, Paquímetro'
    );
  });
});

describe('quadro de ordens', () => {
  const summary = (id: string, status: ServiceOrderSummary['status']): ServiceOrderSummary => ({
    id,
    order_number: Number(id.slice(-1)),
    status,
    customer_id: 'cust-1',
    customer_name: 'Marina Souza',
    vehicle_id: 'veh-1',
    vehicle_plate: 'PIT1A23',
    vehicle_label: 'Ford Ka 2019',
    assigned_mechanic_id: null,
    assigned_mechanic_name: null,
    total_amount: 120,
    opened_at: '2026-11-10T12:00:00Z',
    updated_at: '2026-11-10T12:00:00Z'
  });
  const dropOn = (item: ServiceOrderSummary, to: ServiceOrderSummary['status']) => ({ item: { data: item }, container: { data: to } }) as never;

  async function openBoard() {
    const page = await mount(OrdersBoardPage);
    await page.respond('GET', '/service-orders/board', [summary('o-1', 'draft'), summary('o-2', 'in_progress')]);
    await page.respond('GET', '/users/assignable', TEAM);
    return page;
  }

  it('distribui as OS nas colunas do fluxo e lista só mecânicos no filtro', async () => {
    const page = await openBoard();
    const columns = page.component.columns();
    expect(columns.map((column) => column.status)).toEqual([
      'draft',
      'diagnosis',
      'awaiting_approval',
      'rejected',
      'approved',
      'in_progress',
      'completed',
      'delivered'
    ]);
    expect(columns.find((column) => column.status === 'draft')?.orders.length).toBe(1);
    expect(page.component.mechanics().map((member) => member.full_name)).toEqual(['Seu Jorge']);
    expect(page.text()).toContain('Marina Souza');
  });

  it('arrastar muda o status pelo backend; se ele recusar, o quadro volta ao estado real', async () => {
    const page = await openBoard();
    const [draft] = page.component.orders();
    const moving = page.component.drop(dropOn(draft, 'diagnosis'));
    expect(page.component.orders()[0].status).toBe('diagnosis');
    expect(await page.respond('POST', '/service-orders/o-1/status', {})).toEqual({ status: 'diagnosis' });
    await moving;

    const failing = page.component.drop(dropOn(summary('o-2', 'in_progress'), 'completed'));
    await page.respond('POST', '/service-orders/o-2/status', { message: 'Transição não permitida.' }, 409);
    await page.respond('GET', '/service-orders/board', [summary('o-2', 'in_progress')]);
    await failing;
    expect(page.component.orders().map((item) => item.status)).toEqual(['in_progress']);
  });

  it('não tenta transições inválidas nem as que dependem do orçamento', async () => {
    const page = await openBoard();
    const toast = TestBed.inject(ToastService);
    await page.component.drop(dropOn(summary('o-1', 'draft'), 'draft'));
    await page.component.drop(dropOn(summary('o-1', 'draft'), 'approved'));
    expect(toast.items().at(-1)?.text).toContain('depende do orçamento');
    await page.component.drop(dropOn(summary('o-1', 'draft'), 'delivered'));
    expect(toast.items().at(-1)?.text).toContain('não pode ir direto');
    page.http.expectNone((request) => request.method === 'POST');
  });

  it('abre OS sem triagem para o veículo escolhido', async () => {
    const page = await mount(NewOrderPage);
    await page.respond('GET', '/users/assignable', TEAM);
    await page.component.create();
    page.component.vehicle.set({
      id: 'veh-1',
      customer_id: 'cust-1',
      plate: 'PIT1A23',
      brand: 'Ford',
      model: 'Ka',
      year: 2019,
      color: null,
      vin: null,
      fuel_type: null,
      current_mileage: null,
      notes: null,
      created_at: '',
      updated_at: '',
      customer_name: 'Marina Souza'
    });
    page.component.notes = ' revisão ';
    page.component.mechanicId = 'member-9';
    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    const creating = page.component.create();
    const sent = await page.respond('POST', '/service-orders', order());
    await creating;
    expect(sent).toEqual({ customer_id: 'cust-1', vehicle_id: 'veh-1', free_form_notes: 'revisão', assigned_mechanic_id: 'member-9' });
    expect(navigate).toHaveBeenCalledWith(['/service-orders', 'order-1']);
  });
});

describe('página do orçamento', () => {
  const quote: Quote = {
    id: 'q-1',
    service_order_id: 'order-1',
    version: 2,
    total_amount: 120,
    status: 'draft',
    sent_at: null,
    responded_at: null,
    responded_via: null,
    expires_at: null,
    response_notes: null,
    created_at: '2026-11-10T13:00:00Z',
    items: [{ id: 'qi-1', type: 'service', description: 'Troca de pastilhas', quantity: 1, unit_price: 120, total: 120, sort_order: 1 }]
  };

  it('rascunho é editável por substituição da lista; enviado fica congelado e aceita resposta manual', async () => {
    const page = await mount(QuotePage, { inputs: { id: 'q-1' } });
    await page.respond('GET', '/quotes/q-1', quote);
    await page.respond('GET', '/catalog/services', []);
    await page.respond('GET', '/catalog/parts', []);
    expect(page.component.isDraft()).toBeTrue();
    expect(page.text()).toContain('Orçamento, versão 2');

    const adding = page.component.add({ type: 'part', description: 'Jogo de pastilhas', quantity: 1, unit_price: 189.9 });
    const sent = (await page.respond('PUT', '/quotes/q-1/items', quote)) as { items: unknown[] };
    await adding;
    expect(sent.items).toEqual([
      { type: 'service', description: 'Troca de pastilhas', quantity: 1, unit_price: 120 },
      { type: 'part', description: 'Jogo de pastilhas', quantity: 1, unit_price: 189.9 }
    ]);
    const removing = page.component.remove(0);
    expect(((await page.respond('PUT', '/quotes/q-1/items', quote)) as { items: unknown[] }).items).toEqual([]);
    await removing;

    const sending = page.component.send();
    await page.respond('POST', '/quotes/q-1/send', {
      quote: { ...quote, status: 'sent' },
      portal_url: 'https://app.pitstop.test/portal/abc',
      message: 'Olá',
      whatsapp_url: null,
      expires_at: '2026-12-10T00:00:00Z'
    });
    await sending;
    expect(page.component.isDraft()).toBeFalse();
    expect(page.component.tone()).toBe('wait');
    expect(page.text()).toContain('Orçamento enviado para aprovação');

    spyOn(window, 'prompt').and.returnValues(null, '');
    await page.component.respond('reject');
    const responding = page.component.respond('reject');
    expect(await page.respond('POST', '/quotes/q-1/reject', { ...quote, status: 'rejected' })).toEqual({ notes: undefined });
    await responding;
    expect(page.component.tone()).toBe('stop');
  });
});
