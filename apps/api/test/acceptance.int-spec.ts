/**
 * Teste de aceite do MVP — percorre, pela API HTTP real e contra um Postgres real com RLS,
 * o checklist da seção 18 da especificação. Não existe código de IA no repositório:
 * todo o fluxo roda apenas com o motor determinístico.
 */
import type { DiagnosticResult, PortalOrderResponse, ServiceOrder } from '@pitstop/shared-types';
import { Harness, TestTenant } from './harness';

describe('Aceite do MVP (seção 18)', () => {
  let h: Harness;
  let shop: TestTenant;
  let reception: { id: string; token: string };
  let mechanic: { id: string; token: string };
  let customerId: string;
  let vehicleId: string;
  let order: ServiceOrder;
  let portalToken: string;

  beforeAll(async () => {
    h = await Harness.start();
    shop = await h.createTenant();
  });
  afterAll(() => h.stop());

  it('1. cria usuários com papéis distintos e cada um faz login', async () => {
    reception = await h.createUser(shop, 'receptionist');
    mechanic = await h.createUser(shop, 'mechanic');
    const roles = [];
    for (const token of [shop.ownerToken, reception.token, mechanic.token]) {
      const me = await h.api('get', '/auth/me', token).expect(200);
      expect(me.body.tenant.id).toBe(shop.id);
      roles.push(me.body.membership.role);
    }
    expect(roles).toEqual(['owner', 'receptionist', 'mechanic']);
  });

  it('2. cadastra dez clientes com veículos e busca por telefone e por placa', async () => {
    for (let index = 0; index < 10; index += 1) {
      const customer = await h
        .api('post', '/customers', reception.token)
        .send({ name: `Cliente ${index}`, phone: `(71) 9${String(8000 + index)}-00${String(index).padStart(2, '0')}` })
        .expect(201);
      const vehicle = await h
        .api('post', '/vehicles', reception.token)
        .send({ customer_id: customer.body.id, plate: `abc-1d${String(index).padStart(2, '0')}`, brand: 'Ford', model: 'Ka', year: 2015 + index })
        .expect(201);
      if (index === 3) {
        customerId = customer.body.id;
        vehicleId = vehicle.body.id;
      }
    }
    const total = await h.api('get', '/customers/count', reception.token).expect(200);
    expect(total.body.total).toBe(10);

    const byPhone = await h.api('get', '/customers?q=98003', reception.token).expect(200);
    expect(byPhone.body.data.map((c: { name: string }) => c.name)).toEqual(['Cliente 3']);
    expect(byPhone.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });

    const byPlate = await h.api('get', '/vehicles/by-plate/ABC1D03', reception.token).expect(200);
    expect(byPlate.body).toMatchObject({ id: vehicleId, plate: 'ABC1D03', customer_name: 'Cliente 3' });
    const search = await h.api('get', '/vehicles?q=abc-1d0', reception.token).expect(200);
    expect(search.body.total).toBe(10);
  });

  it('3. triagem completa → OS → painel de sugestões preenchido', async () => {
    const catalog = await h.api('get', '/triage/catalog', reception.token).expect(200);
    expect(catalog.body).toHaveLength(6);
    expect(catalog.body.flatMap((category: { symptoms: unknown[] }) => category.symptoms).length).toBeGreaterThanOrEqual(30);
    // o catálogo entregue à recepção não carrega causas/pesos: isso é insumo do motor, não da triagem
    expect(JSON.stringify(catalog.body)).not.toContain('probable_causes');

    const triage = await h
      .api('post', '/triage/sessions', reception.token)
      .send({
        customer_id: customerId,
        vehicle_id: vehicleId,
        reported_symptoms: [
          { symptom_code: 'brake_noise_when_braking', answers: { when: 'Sempre que freia', axle: 'Dianteira', last_service_km: 42000, lixo: 'descartado' } },
          { symptom_code: 'engine_rough_idle', answers: { ac: true } }
        ],
        free_form_notes: 'Cliente relata que piorou depois da chuva.'
      })
      .expect(201);
    expect(triage.body.status).toBe('pending');
    expect(triage.body.reported_symptoms[0].answers).toEqual({ when: 'Sempre que freia', axle: 'Dianteira', last_service_km: 42000 });

    const converted = await h.api('post', `/triage/sessions/${triage.body.id}/convert`, reception.token).expect(201);
    order = converted.body;
    expect(order).toMatchObject({ status: 'draft', order_number: 1, triage_session_id: triage.body.id, mechanic_suggestions_snapshot: null });
    expect((await h.api('get', `/triage/sessions/${triage.body.id}`, reception.token)).body).toMatchObject({
      status: 'converted',
      service_order_id: order.id
    });
    await h.api('post', `/triage/sessions/${triage.body.id}/convert`, reception.token).expect(409);

    // o mecânico assume e inicia o diagnóstico: o snapshot das sugestões é tirado aqui
    await h.api('patch', `/service-orders/${order.id}`, mechanic.token).send({ assigned_mechanic_id: mechanic.id }).expect(200);
    const started = await h.api('post', `/service-orders/${order.id}/status`, mechanic.token).send({ status: 'diagnosis' }).expect(200);
    const snapshot: DiagnosticResult = started.body.mechanic_suggestions_snapshot;
    expect(snapshot.suggestions.map((s) => s.symptom_code)).toEqual(['brake_noise_when_braking', 'engine_rough_idle']);
    for (const suggestion of snapshot.suggestions) {
      expect(suggestion.causes.length).toBeGreaterThan(0);
      expect(suggestion.checks.length).toBeGreaterThan(0);
      expect(suggestion.parts.length).toBeGreaterThan(0);
    }
    expect(snapshot.suggestions[0].causes[0]).toMatchObject({ description: 'Pastilhas de freio desgastadas', origin: 'global', final_score: 0.425 });

    // snapshot é estável: reler a OS devolve exatamente o mesmo conteúdo
    const again = await h.api('get', `/service-orders/${order.id}`, mechanic.token).expect(200);
    expect(JSON.stringify(again.body.mechanic_suggestions_snapshot)).toBe(JSON.stringify(snapshot));
  });

  it('4. ignora as sugestões: diagnóstico manual e orçamento do zero', async () => {
    await h
      .api('patch', `/service-orders/${order.id}`, mechanic.token)
      .send({
        mechanic_diagnosis: 'Nada do sugerido: mangueira de vácuo solta. Reencaixada e testada.',
        confirmed_causes: [{ symptom_code: 'engine_rough_idle', cause_description: 'Mangueira de vácuo solta' }]
      })
      .expect(200);
    await h
      .api('post', `/service-orders/${order.id}/items`, mechanic.token)
      .send({ type: 'service', description: 'Diagnóstico e reaperto de mangueiras', quantity: 1, unit_price: 150 })
      .expect(201);
    const withItems = await h
      .api('post', `/service-orders/${order.id}/items`, mechanic.token)
      .send({ type: 'part', description: 'Abraçadeira de mangueira', quantity: 2, unit_price: 12.5 })
      .expect(201);
    expect(withItems.body.total_amount).toBe(175);
    expect(withItems.body.items.map((item: { total: number }) => item.total)).toEqual([150, 25]);
  });

  it('5. envia o orçamento por link; o cliente acessa o portal e aprova', async () => {
    const quote = await h.api('post', `/service-orders/${order.id}/quotes`, reception.token).expect(201);
    expect(quote.body).toMatchObject({ status: 'draft', version: 1, total_amount: 175 });
    expect(quote.body.items).toHaveLength(2);

    const sent = await h.api('post', `/quotes/${quote.body.id}/send`, reception.token).expect(200);
    expect(sent.body.portal_url).toMatch(/^https:\/\/app\.pitstop\.test\/portal\/[0-9a-f-]{36}$/);
    expect(sent.body.message).toContain(sent.body.portal_url);
    expect(sent.body.whatsapp_url).toContain('https://wa.me/5571980030003');
    portalToken = sent.body.portal_url.split('/').pop();

    // o banco guarda apenas o hash do token
    const stored = await h.db.admin((db) =>
      db.many<{ token_hash: string }>('select token_hash from public.customer_access_tokens where service_order_id = $1', [order.id])
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((row) => row.token_hash !== portalToken && row.token_hash.length === 64)).toBe(true);

    expect((await h.api('get', `/service-orders/${order.id}`, reception.token)).body.status).toBe('awaiting_approval');

    // portal: sem login; primeiro o consentimento LGPD, depois o pedido
    const intro = await h.api('get', `/portal/${portalToken}`).expect(200);
    expect(intro.body).toMatchObject({ consent_required: true });
    const blocked = await h.api('get', `/portal/${portalToken}/order`).expect(403);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');
    await h.api('post', `/portal/${portalToken}/consent`).expect(204);

    const portal = await h.api('get', `/portal/${portalToken}/order`).expect(200);
    const view: PortalOrderResponse = portal.body;
    expect(view.order).toMatchObject({ number: 1, status: 'awaiting_approval' });
    expect(view.vehicle).toMatchObject({ plate: 'ABC1D03', brand: 'Ford' });
    expect(view.quote).toMatchObject({ total_amount: 175, can_respond: true });
    expect(view.reported_symptoms[0]).toMatchObject({ name: 'Chiado agudo ao frear' });

    const approved = await h.api('post', `/portal/${portalToken}/quotes/${view.quote!.id}/approve`).expect(200);
    expect(approved.body.order.status).toBe('approved');
    expect(approved.body.quote).toMatchObject({ status: 'approved', can_respond: false });
    // responder duas vezes não é possível
    await h.api('post', `/portal/${portalToken}/quotes/${view.quote!.id}/reject`).send({}).expect(409);
  });

  it('6. acompanha a OS de approved até delivered com a timeline atualizada', async () => {
    for (const status of ['in_progress', 'completed', 'delivered'] as const) {
      const actor = status === 'delivered' ? reception.token : mechanic.token;
      const response = await h.api('post', `/service-orders/${order.id}/status`, actor).send({ status }).expect(200);
      expect(response.body.status).toBe(status);
      const portal = await h.api('get', `/portal/${portalToken}/order`).expect(200);
      expect(portal.body.order.status).toBe(status);
      expect(portal.body.timeline.at(-1).status).toBe(status);
    }
    const final = await h.api('get', `/service-orders/${order.id}`, shop.ownerToken).expect(200);
    expect(final.body.history.map((entry: { to_status: string }) => entry.to_status)).toEqual([
      'draft',
      'diagnosis',
      'awaiting_approval',
      'approved',
      'in_progress',
      'completed',
      'delivered'
    ]);
    expect(final.body.history.every((entry: { changed_by_name: string; created_at: string }) => entry.changed_by_name && entry.created_at)).toBe(true);
    expect(final.body.history[3]).toMatchObject({ actor_type: 'customer' });
    expect(final.body.allowed_transitions).toEqual([]);

    // a base de conhecimento da oficina aprendeu com o que o mecânico registrou
    const stats = await h.api('get', '/diagnostics/shop-stats/engine_rough_idle', mechanic.token).expect(200);
    expect(stats.body).toEqual([
      expect.objectContaining({ cause_description: 'Mangueira de vácuo solta', vehicle_brand: 'FORD', occurrences: 1, avg_price: 175 })
    ]);
    const next = await h.api('get', '/diagnostics/suggest/engine_rough_idle?brand=Ford', mechanic.token).expect(200);
    expect(next.body.suggestions[0].causes[0]).toMatchObject({ description: 'Mangueira de vácuo solta', origin: 'shop', shop_occurrences: 1 });
  });

  it('7. consulta o histórico completo de ordens pela tela do veículo', async () => {
    const second = await h.api('post', '/service-orders', reception.token).send({ customer_id: customerId, vehicle_id: vehicleId }).expect(201);
    expect(second.body.order_number).toBe(2);
    const vehicle = await h.api('get', `/vehicles/${vehicleId}`, reception.token).expect(200);
    expect(vehicle.body.orders.map((o: { order_number: number; status: string }) => [o.order_number, o.status])).toEqual([
      [2, 'draft'],
      [1, 'delivered']
    ]);
  });

  it('8. suspender o tenant derruba todos os usuários na hora; reativar devolve o acesso', async () => {
    await h.api('post', `/admin/tenants/${shop.id}/suspend`, h.adminToken).send({ confirm_slug: 'slug-errado' }).expect(400);
    await h.api('post', `/admin/tenants/${shop.id}/suspend`, h.adminToken).send({ confirm_slug: shop.slug, reason: 'teste de aceite' }).expect(200);

    // os mesmos tokens, ainda dentro da validade, param de funcionar imediatamente
    for (const token of [shop.ownerToken, reception.token, mechanic.token]) {
      const denied = await h.api('get', '/customers', token).expect(403);
      expect(denied.body.code).toBe('TENANT_SUSPENDED');
    }
    await h.api('get', `/portal/${portalToken}/order`).expect(404);
    await h.api('get', `/triage/public/${shop.slug}`).expect(404);
    // os dados continuam lá
    const kept = await h.db.admin((db) => db.one<{ n: number }>('select count(*)::int as n from public.customers where tenant_id = $1', [shop.id]));
    expect(kept.n).toBe(10);

    await h.api('post', `/admin/tenants/${shop.id}/reactivate`, h.adminToken).expect(200);
    for (const token of [shop.ownerToken, reception.token, mechanic.token]) await h.api('get', '/customers', token).expect(200);
    await h.api('get', `/portal/${portalToken}/order`).expect(200);
  });
});
