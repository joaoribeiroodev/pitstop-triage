/** Fases 2 a 4: estoque, financeiro, agenda, indicadores, avisos ao cliente e a camada opcional de IA. */
import { Harness, TestTenant } from './harness';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Operação da oficina: estoque, financeiro, agenda, indicadores e avisos', () => {
  let h: Harness;
  let shop: TestTenant;
  let other: TestTenant;
  let starter: TestTenant;
  let reception: { id: string; token: string };
  let mechanic: { id: string; token: string };
  let memberId: string;
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  /** Leva uma OS do rascunho até "aprovada", com os itens informados passando pelo orçamento. */
  async function approvedOrder(plate: string, items: Json[]): Promise<Json> {
    const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, plate);
    const order = await h
      .api('post', '/service-orders', reception.token)
      .send({
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        reported_symptoms: [{ symptom_code: 'brake_noise_when_braking', answers: {} }],
        assigned_mechanic_id: memberId
      })
      .expect(201);
    await h.api('post', `/service-orders/${order.body.id}/status`, mechanic.token).send({ status: 'diagnosis' }).expect(200);
    for (const item of items) await h.api('post', `/service-orders/${order.body.id}/items`, mechanic.token).send(item).expect(201);
    const quote = await h.api('post', `/service-orders/${order.body.id}/quotes`, reception.token).expect(201);
    const sent = await h.api('post', `/quotes/${quote.body.id}/send`, reception.token).expect(200);
    await h.api('post', `/quotes/${quote.body.id}/approve`, reception.token).send({}).expect(200);
    return { ...order.body, customer, vehicle, quote: quote.body, sent: sent.body };
  }

  const finish = async (orderId: string) => {
    await h.api('post', `/service-orders/${orderId}/status`, mechanic.token).send({ status: 'in_progress' }).expect(200);
    return h.api('post', `/service-orders/${orderId}/status`, mechanic.token).send({ status: 'completed' }).expect(200);
  };

  beforeAll(async () => {
    process.env.WHATSAPP_API_TOKEN = 'token-de-teste';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '5550001';
    process.env.WHATSAPP_API_URL = 'https://graph.test/v21.0/';
    process.env.OPENAI_API_KEY = 'sk-teste';
    h = await Harness.start();
    shop = await h.createTenant();
    other = await h.createTenant();
    starter = await h.createTenant({ plan: 'basic' });
    reception = await h.createUser(shop, 'receptionist');
    mechanic = await h.createUser(shop, 'mechanic');
    memberId = mechanic.id;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({}) });
  });

  afterAll(async () => {
    for (const key of ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_API_URL', 'OPENAI_API_KEY']) delete process.env[key];
    global.fetch = realFetch;
    await h.stop();
  });

  describe('módulos por plano', () => {
    it('plano inicial não tem estoque, financeiro nem avisos; a agenda vale para todos', async () => {
      await h.api('get', '/inventory/items', starter.ownerToken).expect(403);
      await h.api('get', '/financial/summary', starter.ownerToken).expect(403);
      await h.api('get', '/notifications/settings', starter.ownerToken).expect(403);
      await h.api('get', '/appointments', starter.ownerToken).query({ from: '2030-01-01T00:00:00Z', to: '2030-01-02T00:00:00Z' }).expect(200);
    });
  });

  describe('estoque', () => {
    let pads: Json;

    it('gestão cadastra com saldo inicial, edita e movimenta; os demais só consultam', async () => {
      await h.api('post', '/inventory/items', reception.token).send({ name: 'Pastilha' }).expect(403);
      const created = await h
        .api('post', '/inventory/items', shop.ownerToken)
        .send({ name: ' Pastilha dianteira ', sku: 'PD-01', location: 'A3', quantity_on_hand: 4, minimum_quantity: 2, unit_cost: 60, unit_price: 120 })
        .expect(201);
      pads = created.body;
      expect(pads).toMatchObject({ name: 'Pastilha dianteira', sku: 'PD-01', quantity_on_hand: 4, low_stock: false, is_active: true });
      await h.api('post', '/inventory/items', shop.ownerToken).send({ name: 'Outra', sku: 'pd-01' }).expect(400);

      await h.api('post', `/inventory/items/${pads.id}/movements`, shop.ownerToken).send({ type: 'in', quantity: 0 }).expect(400);
      await h.api('post', `/inventory/items/${pads.id}/movements`, shop.ownerToken).send({ type: 'in', quantity: 6, reason: 'Compra' }).expect(201);
      await h.api('post', `/inventory/items/${pads.id}/movements`, shop.ownerToken).send({ type: 'out', quantity: 1 }).expect(201);
      const counted = await h.api('post', `/inventory/items/${pads.id}/movements`, shop.ownerToken).send({ type: 'adjustment', quantity: 5 }).expect(201);
      expect(counted.body.quantity_on_hand).toBe(5);

      const renamed = await h.api('patch', `/inventory/items/${pads.id}`, shop.ownerToken).send({ location: '', minimum_quantity: 5 }).expect(200);
      expect(renamed.body).toMatchObject({ location: null, low_stock: true });

      const detail = await h.api('get', `/inventory/items/${pads.id}`, mechanic.token).expect(200);
      expect(detail.body.movements.map((m: Json) => m.type)).toEqual(['adjustment', 'out', 'in', 'in']);
      expect(detail.body.movements[3].reason).toBe('Saldo inicial');

      expect((await h.api('get', '/inventory/items', mechanic.token).query({ q: 'pd-0' }).expect(200)).body).toHaveLength(1);
      expect((await h.api('get', '/inventory/items', mechanic.token).query({ low: 'true' }).expect(200)).body).toHaveLength(1);
      expect((await h.api('get', '/inventory/items', other.ownerToken).expect(200)).body).toEqual([]);
      await h.api('get', `/inventory/items/${pads.id}`, other.ownerToken).expect(404);
    });

    it('a peça ligada ao estoque sobrevive ao orçamento e dá baixa uma única vez na conclusão', async () => {
      const foreign = await h.api('post', '/inventory/items', other.ownerToken).send({ name: 'Peça de outra oficina' }).expect(201);
      const order = await approvedOrder('EST1A11', [
        { type: 'part', description: 'Pastilha dianteira', quantity: 2, unit_price: 120, inventory_item_id: pads.id },
        { type: 'service', description: 'Troca de pastilhas', quantity: 1, unit_price: 80, inventory_item_id: pads.id }
      ]);
      const loaded = await h.api('get', `/service-orders/${order.id}`, mechanic.token).expect(200);
      expect(loaded.body.items.map((item: Json) => item.inventory_item_id)).toEqual([pads.id, null]);

      // item de outra oficina não pode ser vinculado
      const draft = await h.createCustomerWithVehicle(reception.token, 'EST2B22');
      const second = await h
        .api('post', '/service-orders', reception.token)
        .send({ customer_id: draft.customer.id, vehicle_id: draft.vehicle.id, reported_symptoms: [] })
        .expect(201);
      await h
        .api('post', `/service-orders/${second.body.id}/items`, reception.token)
        .send({ type: 'part', description: 'Peça alheia', quantity: 1, unit_price: 1, inventory_item_id: foreign.body.id })
        .expect(400);
      const added = await h
        .api('post', `/service-orders/${second.body.id}/items`, reception.token)
        .send({ type: 'part', description: 'Pastilha', quantity: 1, unit_price: 1, inventory_item_id: pads.id })
        .expect(201);
      const itemId = added.body.items[0].id;
      const unlinked = await h.api('patch', `/service-orders/${second.body.id}/items/${itemId}`, reception.token).send({ type: 'service' }).expect(200);
      expect(unlinked.body.items[0].inventory_item_id).toBeNull();
      const relinked = await h
        .api('patch', `/service-orders/${second.body.id}/items/${itemId}`, reception.token)
        .send({ type: 'part', inventory_item_id: pads.id })
        .expect(200);
      expect(relinked.body.items[0].inventory_item_id).toBe(pads.id);

      await finish(order.id);
      const after = await h.api('get', `/inventory/items/${pads.id}`, shop.ownerToken).expect(200);
      expect(after.body.quantity_on_hand).toBe(3);
      expect(after.body.movements[0]).toMatchObject({ type: 'out', quantity: 2, service_order_id: order.id, order_number: order.order_number });
      expect(after.body.movements[0].reason).toContain('Baixa automática');
    });
  });

  describe('financeiro', () => {
    it('a OS concluída vira conta a receber; gestão lança, baixa, reabre e exclui', async () => {
      await h.api('get', '/financial/entries', reception.token).expect(403);
      const auto = await h.api('get', '/financial/entries', shop.ownerToken).query({ type: 'receivable' }).expect(200);
      expect(auto.body).toHaveLength(1);
      expect(auto.body[0]).toMatchObject({ amount: 320, counterparty: 'Cliente EST1A11', overdue: false, paid_at: null });
      expect(auto.body[0].description).toContain('EST1A11');

      const bill = await h
        .api('post', '/financial/entries', shop.ownerToken)
        .send({ type: 'payable', description: ' Fornecedor de peças ', amount: 500, counterparty: 'Auto Peças', due_date: '2020-01-10', notes: '' })
        .expect(201);
      expect(bill.body).toMatchObject({ description: 'Fornecedor de peças', overdue: true, notes: null, due_date: '2020-01-10' });
      expect((await h.api('get', '/financial/entries', shop.ownerToken).query({ status: 'overdue' }).expect(200)).body).toHaveLength(1);
      expect((await h.api('get', '/financial/entries', shop.ownerToken).query({ from: '2020-01-01', to: '2020-01-31' }).expect(200)).body).toHaveLength(1);

      let summary = await h.api('get', '/financial/summary', shop.ownerToken).expect(200);
      expect(summary.body).toMatchObject({ receivable_open: 320, payable_open: 500, payable_overdue: 500, received_this_month: 0 });

      const paid = await h.api('patch', `/financial/entries/${auto.body[0].id}`, shop.ownerToken).send({ paid: true }).expect(200);
      expect(paid.body.paid_at).not.toBeNull();
      summary = await h.api('get', '/financial/summary', shop.ownerToken).expect(200);
      expect(summary.body).toMatchObject({ receivable_open: 0, received_this_month: 320 });
      expect((await h.api('get', '/financial/entries', shop.ownerToken).query({ status: 'paid' }).expect(200)).body).toHaveLength(1);
      expect((await h.api('get', '/financial/entries', shop.ownerToken).query({ status: 'open' }).expect(200)).body).toHaveLength(1);

      const reopened = await h
        .api('patch', `/financial/entries/${bill.body.id}`, shop.ownerToken)
        .send({ paid: false, amount: 450, counterparty: '', notes: 'Negociado' })
        .expect(200);
      expect(reopened.body).toMatchObject({ amount: 450, counterparty: null, notes: 'Negociado', paid_at: null });

      await h.api('delete', `/financial/entries/${bill.body.id}`, shop.ownerToken).expect(204);
      await h.api('delete', `/financial/entries/${bill.body.id}`, shop.ownerToken).expect(404);
      await h.api('patch', `/financial/entries/${auto.body[0].id}`, other.ownerToken).send({ paid: false }).expect(404);
    });
  });

  describe('agenda', () => {
    const at = (hour: number, day = '2031-03-10') => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

    it('a oficina cadastra os boxes nas preferências', async () => {
      const saved = await h
        .api('patch', '/tenant/settings', shop.ownerToken)
        .send({ bays: [' Box 1 ', 'Box 2', 'Box 1', ''] })
        .expect(400);
      expect(saved.body.statusCode).toBe(400);
      const ok = await h
        .api('patch', '/tenant/settings', shop.ownerToken)
        .send({ bays: [' Box 1 ', 'Box 2', 'Box 1'] })
        .expect(200);
      expect(ok.body.settings.bays).toEqual(['Box 1', 'Box 2']);
    });

    it('agenda, lista por período e bloqueia conflito de box e de mecânico', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, 'AGE1A11');
      await h
        .api('post', '/appointments', mechanic.token)
        .send({ title: 'Revisão', starts_at: at(9), ends_at: at(10) })
        .expect(403);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Revisão', starts_at: at(10), ends_at: at(9) })
        .expect(400);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Longa', starts_at: at(9), ends_at: at(9, '2031-04-10') })
        .expect(400);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Revisão', starts_at: at(9), ends_at: at(10), customer_id: other.id })
        .expect(400);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Revisão', starts_at: at(9), ends_at: at(10), vehicle_id: other.id })
        .expect(400);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Revisão', starts_at: at(9), ends_at: at(10), mechanic_id: other.id })
        .expect(400);

      const first = await h
        .api('post', '/appointments', reception.token)
        .send({
          title: ' Revisão dos 40 mil ',
          starts_at: at(9),
          ends_at: at(11),
          bay: 'Box 1',
          mechanic_id: memberId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          notes: ''
        })
        .expect(201);
      expect(first.body).toMatchObject({
        title: 'Revisão dos 40 mil',
        bay: 'Box 1',
        status: 'scheduled',
        customer_name: customer.name,
        vehicle_plate: 'AGE1A11',
        vehicle_label: 'Ford Ka',
        notes: null
      });
      expect(first.body.mechanic_name).toContain('mechanic');

      const sameBay = await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Freios', starts_at: at(10), ends_at: at(12), bay: 'box 1' })
        .expect(409);
      expect(sameBay.body.message).toContain('Box 1');
      const sameMechanic = await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Freios', starts_at: at(10), ends_at: at(12), bay: 'Box 2', mechanic_id: memberId })
        .expect(409);
      expect(sameMechanic.body.message).toContain('já tem um agendamento');
      // encostado no fim do anterior não é conflito; sem box nem responsável também não
      const second = await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Freios', starts_at: at(11), ends_at: at(12), bay: 'Box 1', mechanic_id: memberId })
        .expect(201);
      await h
        .api('post', '/appointments', reception.token)
        .send({ title: 'Retorno', starts_at: at(9), ends_at: at(10) })
        .expect(201);

      await h
        .api('patch', `/appointments/${second.body.id}`, reception.token)
        .send({ starts_at: at(10) })
        .expect(409);
      // cancelar libera o horário
      const cancelled = await h.api('patch', `/appointments/${first.body.id}`, reception.token).send({ status: 'cancelled' }).expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      const moved = await h
        .api('patch', `/appointments/${second.body.id}`, reception.token)
        .send({ starts_at: at(10), title: ' Freios e discos ', bay: '', notes: 'Trazer chave reserva' })
        .expect(200);
      expect(moved.body).toMatchObject({ title: 'Freios e discos', bay: null, notes: 'Trazer chave reserva' });
      // reativar o primeiro esbarra no segundo (mesmo mecânico)
      await h.api('patch', `/appointments/${first.body.id}`, reception.token).send({ status: 'confirmed' }).expect(409);

      const day = await h
        .api('get', '/appointments', mechanic.token)
        .query({ from: at(0), to: at(23) })
        .expect(200);
      expect(day.body.map((row: Json) => row.title)).toEqual(['Revisão dos 40 mil', 'Retorno', 'Freios e discos']);
      expect(
        (
          await h
            .api('get', '/appointments', mechanic.token)
            .query({ from: at(12), to: at(23) })
            .expect(200)
        ).body
      ).toEqual([]);
      await h
        .api('get', '/appointments', mechanic.token)
        .query({ from: 'ontem', to: at(1) })
        .expect(400);
      expect(
        (
          await h
            .api('get', '/appointments', other.ownerToken)
            .query({ from: at(0), to: at(23) })
            .expect(200)
        ).body
      ).toEqual([]);

      await h.api('patch', `/appointments/${first.body.id}`, other.ownerToken).send({ title: 'Invasão' }).expect(404);
      await h.api('delete', `/appointments/${first.body.id}`, reception.token).expect(204);
      await h.api('delete', `/appointments/${first.body.id}`, reception.token).expect(404);
    });
  });

  describe('indicadores', () => {
    it('resume as OS concluídas do período; só a gestão vê', async () => {
      await h.api('get', '/reports/overview', reception.token).expect(403);
      const rejected = await approvedOrder('IND1A11', [{ type: 'service', description: 'troca de pastilhas', quantity: 1, unit_price: 100 }]);
      await finish(rejected.id);

      const report = await h.api('get', '/reports/overview', shop.ownerToken).expect(200);
      expect(report.body).toMatchObject({
        orders_completed: 2,
        revenue: 420,
        average_ticket: 210,
        quotes: { sent: 2, approved: 2, rejected: 0, conversion_pct: 100 }
      });
      expect(report.body.average_execution_minutes).toBeGreaterThanOrEqual(0);
      expect(report.body.top_services[0]).toMatchObject({ type: 'part', times: 1, revenue: 240 });
      expect(report.body.top_services[1]).toMatchObject({ type: 'service', times: 2, revenue: 180 });
      expect(report.body.by_mechanic).toEqual([expect.objectContaining({ orders: 2, revenue: 420 })]);
      expect(report.body.by_month).toHaveLength(1);

      const empty = await h.api('get', '/reports/overview', shop.ownerToken).query({ from: '2019-01-01', to: '2019-12-31' }).expect(200);
      expect(empty.body).toMatchObject({
        orders_completed: 0,
        revenue: 0,
        average_ticket: 0,
        average_execution_minutes: null,
        quotes: { conversion_pct: null },
        top_services: []
      });
      await h.api('get', '/reports/overview', shop.ownerToken).query({ from: '2024-02-01', to: '2024-01-01' }).expect(400);
      await h.api('get', '/reports/overview', shop.ownerToken).query({ from: '2010-01-01', to: '2024-01-01' }).expect(400);
      await h.api('get', '/reports/overview', shop.ownerToken).query({ from: '01/01/2024' }).expect(400);
    });
  });

  describe('avisos ao cliente', () => {
    let order: Json;
    const sentBodies = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://graph.test')).map(([, init]) => JSON.parse(init.body));

    it('a oficina personaliza os textos e o orçamento sai com o modelo dela', async () => {
      const initial = await h.api('get', '/notifications/settings', reception.token).expect(200);
      expect(initial.body).toMatchObject({ whatsapp_auto: false, api_configured: true });
      expect(initial.body.templates).toEqual(initial.body.defaults);

      await h.api('patch', '/notifications/settings', reception.token).send({ vehicle_ready: 'Pode vir buscar o carro!' }).expect(403);
      await h.api('patch', '/notifications/settings', shop.ownerToken).send({ vehicle_ready: 'curto' }).expect(400);
      const saved = await h
        .api('patch', '/notifications/settings', shop.ownerToken)
        .send({ quote_pending: 'Oi {cliente}, orçamento da OS {os} ({placa}): {total}. {link} — {oficina} {desconhecido}' })
        .expect(200);
      expect(saved.body.templates.status_update).toBe(saved.body.defaults.status_update);

      order = await approvedOrder('AVI1A11', [{ type: 'service', description: 'Alinhamento', quantity: 1, unit_price: 90 }]);
      expect(order.sent.message.replace(/\u00a0/g, ' ')).toBe(
        `Oi Cliente, orçamento da OS ${order.order_number} (AVI1A11): R$ 90,00. ${order.sent.portal_url} — Oficina ${shop.slug} {desconhecido}`
      );
      expect(decodeURIComponent(order.sent.whatsapp_url)).toContain(order.sent.message);
      // com o envio automático desligado, nada sai pela API
      expect(sentBodies()).toEqual([]);
    });

    it('gera a mensagem pronta com link de acompanhamento e registra no histórico', async () => {
      await h.api('post', `/notifications/orders/${order.id}/preview`, mechanic.token).send({ event: 'status_update' }).expect(403);
      await h.api('post', `/notifications/orders/${order.id}/preview`, reception.token).send({ event: 'outro' }).expect(400);
      await h.api('post', `/notifications/orders/${order.id}/preview`, other.ownerToken).send({ event: 'status_update' }).expect(404);

      const preview = await h.api('post', `/notifications/orders/${order.id}/preview`, reception.token).send({ event: 'status_update' }).expect(201);
      expect(preview.body.message).toMatch(
        /Novidade na OS \d+ do seu Ford Ka: aprovada\. Acompanhe por aqui: https:\/\/app\.pitstop\.test\/portal\/[0-9a-f-]{36}/
      );
      expect(preview.body.whatsapp_url).toContain('https://wa.me/5571988887777?text=');
      const token = preview.body.message.match(/portal\/([0-9a-f-]{36})/)[1];
      expect((await h.api('get', `/portal/${token}`).expect(200)).body).toMatchObject({ consent_required: true });

      // cliente sem telefone válido: a mensagem existe, o link do WhatsApp não
      await h.db.admin((db) => db.exec(`update public.customers set phone = '123' where id = $1`, [order.customer.id]));
      const noPhone = await h.api('post', `/notifications/orders/${order.id}/preview`, reception.token).send({ event: 'vehicle_ready' }).expect(201);
      expect(noPhone.body.whatsapp_url).toBeNull();
      await h.db.admin((db) => db.exec(`update public.customers set phone = '71988887777' where id = $1`, [order.customer.id]));

      const history = await h.api('get', `/notifications/orders/${order.id}/history`, mechanic.token).expect(200);
      expect(history.body.map((row: Json) => [row.event, row.channel, row.status])).toEqual([
        ['vehicle_ready', 'whatsapp_link', 'skipped'],
        ['status_update', 'whatsapp_link', 'sent']
      ]);
    });

    it('envio automático: dispara nas mudanças de status e uma falha nunca derruba a operação', async () => {
      const on = await h.api('patch', '/notifications/settings', shop.ownerToken).send({ whatsapp_auto: true }).expect(200);
      expect(on.body.whatsapp_auto).toBe(true);

      await h.api('post', `/service-orders/${order.id}/status`, mechanic.token).send({ status: 'in_progress' }).expect(200);
      const [started] = sentBodies();
      expect(started).toMatchObject({
        messaging_product: 'whatsapp',
        to: '5571988887777',
        type: 'template',
        template: { name: 'pitstop_status', language: { code: 'pt_BR' } }
      });
      expect(started.template.components[0].parameters.map((p: Json) => p.text).slice(0, 5)).toEqual([
        'Cliente',
        `Oficina ${shop.slug}`,
        'Ford Ka',
        'AVI1A11',
        'em execução'
      ]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.test/v21.0/5550001/messages');
      expect(init.headers.authorization).toBe('Bearer token-de-teste');

      // a API da Meta fora do ar: a conclusão acontece do mesmo jeito e a falha fica registrada
      fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'indisponível' });
      const done = await h.api('post', `/service-orders/${order.id}/status`, mechanic.token).send({ status: 'completed' }).expect(200);
      expect(done.body.status).toBe('completed');

      // erro de rede no envio do orçamento
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const next = await approvedOrder('AVI2B22', [{ type: 'service', description: 'Balanceamento', quantity: 1, unit_price: 60 }]);
      expect(next.sent.portal_url).toContain('/portal/');

      // cliente sem telefone: pula sem chamar a API
      fetchMock.mockClear();
      await h.db.admin((db) => db.exec(`update public.customers set phone = null where id = $1`, [next.customer.id]));
      await h.api('post', `/service-orders/${next.id}/status`, mechanic.token).send({ status: 'in_progress' }).expect(200);
      expect(sentBodies()).toEqual([]);

      const first = await h.api('get', `/notifications/orders/${order.id}/history`, reception.token).expect(200);
      expect(first.body.filter((row: Json) => row.channel === 'whatsapp_api').map((row: Json) => [row.event, row.status, row.detail])).toEqual([
        ['vehicle_ready', 'failed', 'HTTP 503 indisponível'],
        ['status_update', 'sent', null]
      ]);
      const second = await h.api('get', `/notifications/orders/${next.id}/history`, reception.token).expect(200);
      expect(second.body.map((row: Json) => [row.event, row.status, row.detail])).toEqual([
        ['status_update', 'skipped', 'Cliente sem telefone válido'],
        ['quote_pending', 'failed', 'ECONNRESET']
      ]);
    });

    it('se o registro do aviso falhar, a operação segue mesmo assim', async () => {
      const broken = await approvedOrder('AVI3C33', [{ type: 'service', description: 'Revisão', quantity: 1, unit_price: 60 }]);
      await h.db.admin((db) => db.exec('alter table public.notification_log rename to notification_log_off'));
      try {
        await h.api('post', `/service-orders/${broken.id}/status`, mechanic.token).send({ status: 'in_progress' }).expect(200);
      } finally {
        await h.db.admin((db) => db.exec('alter table public.notification_log_off rename to notification_log'));
      }
    });
  });

  describe('camada opcional de IA', () => {
    const suggest = (query: Json = {}) => h.api('get', '/diagnostics/suggest/brake_noise_when_braking', mechanic.token).query(query).expect(200);
    const ai = (content: unknown, ok = true) =>
      fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, text: async () => '', json: async () => ({ choices: [{ message: { content } }] }) });

    it('desligada para a oficina: o provedor nem é chamado', async () => {
      const result = await suggest();
      expect(result.body.ai_note).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ligada: acrescenta só o resumo, sem tocar nas sugestões; falha volta ao motor puro', async () => {
      await h
        .api('patch', `/admin/tenants/${shop.id}`, h.adminToken)
        .send({ feature_flags: { ai: true } })
        .expect(200);
      const plain = await h.api('get', '/diagnostics/suggest/sintoma_inexistente', mechanic.token).expect(200);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(plain.body.ai_note).toBeUndefined();

      ai('  Comece pelas pastilhas dianteiras.  ');
      const enhanced = await suggest({ brand: 'Ford' });
      expect(enhanced.body.ai_note).toBe('Comece pelas pastilhas dianteiras.');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      // nenhum dado de cliente segue para o provedor
      expect(init.body).not.toMatch(/Cliente|7198888/);

      ai('', true);
      const blank = await suggest();
      expect(blank.body.ai_note).toBeUndefined();
      ai('x', false);
      const failed = await suggest();
      expect(failed.body.ai_note).toBeUndefined();
      expect(failed.body.suggestions).toEqual(enhanced.body.suggestions);
    });

    it('o resumo entra no snapshot da OS ao iniciar o diagnóstico e ao recalcular', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, 'IAA1A11');
      const created = await h
        .api('post', '/service-orders', reception.token)
        .send({
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          reported_symptoms: [{ symptom_code: 'brake_noise_when_braking', answers: {} }],
          assigned_mechanic_id: memberId
        })
        .expect(201);
      ai('Verifique primeiro as pastilhas.');
      const started = await h.api('post', `/service-orders/${created.body.id}/status`, mechanic.token).send({ status: 'diagnosis' }).expect(200);
      expect(started.body.mechanic_suggestions_snapshot.ai_note).toBe('Verifique primeiro as pastilhas.');
      const stored = await h.api('get', `/service-orders/${created.body.id}`, mechanic.token).expect(200);
      expect(stored.body.mechanic_suggestions_snapshot.ai_note).toBe('Verifique primeiro as pastilhas.');

      // recalcular com o provedor fora do ar: o snapshot novo vem sem resumo e a operação conclui
      ai('x', false);
      const recomputed = await h.api('post', `/service-orders/${created.body.id}/recompute-suggestions`, mechanic.token).expect(200);
      expect(recomputed.body.mechanic_suggestions_snapshot.ai_note).toBeUndefined();
      expect(recomputed.body.mechanic_suggestions_snapshot.suggestions).toEqual(started.body.mechanic_suggestions_snapshot.suggestions);

      // falha ao gravar o resumo também não derruba nada
      ai('Resumo que não será gravado.');
      const spy = jest.spyOn(h.db, 'tenant');
      let calls = 0;
      spy.mockImplementation(function (this: unknown, ...args: unknown[]) {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('banco indisponível'));
        return (Object.getPrototypeOf(h.db).tenant as (...a: unknown[]) => Promise<unknown>).apply(h.db, args);
      } as never);
      try {
        const safe = await h.api('post', `/service-orders/${created.body.id}/recompute-suggestions`, mechanic.token).expect(200);
        expect(safe.body.mechanic_suggestions_snapshot.ai_note).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
