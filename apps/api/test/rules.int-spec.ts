/** Regras de negócio e de segurança fora do caminho feliz: workflow, portal, RBAC, limites e painel admin. */
import { Harness, TestTenant, unique } from './harness';

describe('Regras de workflow, portal, RBAC e admin', () => {
  let h: Harness;
  let shop: TestTenant;
  let reception: { id: string; token: string };
  let mechanic: { id: string; token: string };
  let otherMechanic: { id: string; token: string };
  let plateSeq = 0;

  const nextPlate = () => `RUL${Math.floor(plateSeq / 100)}A${String((plateSeq += 1) % 100).padStart(2, '0')}`;
  const status = (orderId: string, to: string, token = shop.ownerToken) => h.api('post', `/service-orders/${orderId}/status`, token).send({ status: to });

  async function newOrder(symptoms = [{ symptom_code: 'brake_grinding', answers: {} }]) {
    const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, nextPlate());
    const order = await h
      .api('post', '/service-orders', reception.token)
      .send({ customer_id: customer.id, vehicle_id: vehicle.id, reported_symptoms: symptoms })
      .expect(201);
    return order.body as { id: string; order_number: number };
  }

  /** Leva uma OS até "aguardando aprovação" e devolve o token do portal. */
  async function orderAwaitingApproval() {
    const order = await newOrder();
    await status(order.id, 'diagnosis').expect(200);
    await h
      .api('post', `/service-orders/${order.id}/items`, shop.ownerToken)
      .send({ type: 'service', description: 'Troca de pastilhas', quantity: 1, unit_price: 200 })
      .expect(201);
    const quote = await h.api('post', `/service-orders/${order.id}/quotes`, reception.token).expect(201);
    const sent = await h.api('post', `/quotes/${quote.body.id}/send`, reception.token).expect(200);
    const token = sent.body.portal_url.split('/').pop() as string;
    await h.api('post', `/portal/${token}/consent`).expect(204);
    return { order, quoteId: quote.body.id as string, token };
  }

  beforeAll(async () => {
    h = await Harness.start();
    shop = await h.createTenant();
    reception = await h.createUser(shop, 'receptionist');
    mechanic = await h.createUser(shop, 'mechanic');
    otherMechanic = await h.createUser(shop, 'mechanic');
  });
  afterAll(() => h.stop());

  describe('workflow da OS', () => {
    it('rejeita transições fora da matriz', async () => {
      const order = await newOrder();
      for (const target of ['in_progress', 'completed', 'delivered']) {
        const response = await status(order.id, target).expect(409);
        expect(response.body.message).toContain('Transição não permitida');
      }
      await status(order.id, 'diagnosis').expect(200);
      await status(order.id, 'in_progress').expect(409);
      await status(order.id, 'delivered').expect(409);
    });

    it('approved/awaiting_approval/rejected só acontecem pelo fluxo de orçamento', async () => {
      const order = await newOrder();
      await status(order.id, 'diagnosis').expect(200);
      for (const target of ['awaiting_approval', 'approved', 'rejected']) await status(order.id, target).expect(400);
      const untouched = await h.api('get', `/service-orders/${order.id}`, shop.ownerToken).expect(200);
      expect(untouched.body.status).toBe('diagnosis');
      expect(untouched.body.allowed_transitions).toEqual(['cancelled']);
    });

    it('não envia orçamento vazio nem de OS que ainda não entrou em diagnóstico', async () => {
      const order = await newOrder();
      await h.api('post', `/service-orders/${order.id}/quotes`, reception.token).expect(409);
      await status(order.id, 'diagnosis').expect(200);
      const quote = await h.api('post', `/service-orders/${order.id}/quotes`, reception.token).expect(201);
      await h.api('post', `/quotes/${quote.body.id}/send`, reception.token).expect(400);
      expect((await h.api('get', `/service-orders/${order.id}`, shop.ownerToken)).body.status).toBe('diagnosis');
    });

    it('trava os itens depois que o orçamento é enviado', async () => {
      const { order } = await orderAwaitingApproval();
      await h
        .api('post', `/service-orders/${order.id}/items`, shop.ownerToken)
        .send({ type: 'part', description: 'Item fora do orçamento', quantity: 1, unit_price: 999 })
        .expect(409);
    });

    it('recusa → volta ao diagnóstico → novo orçamento versão 2 invalida o link anterior', async () => {
      const { order, quoteId, token } = await orderAwaitingApproval();
      const rejected = await h.api('post', `/portal/${token}/quotes/${quoteId}/reject`).send({ reason: 'Achei caro' }).expect(200);
      expect(rejected.body.order.status).toBe('rejected');
      expect((await h.api('get', `/quotes/${quoteId}`, reception.token)).body).toMatchObject({
        status: 'rejected',
        response_notes: 'Achei caro',
        responded_via: 'portal'
      });

      const second = await h.api('post', `/service-orders/${order.id}/quotes`, reception.token).expect(201);
      expect(second.body.version).toBe(2);
      await h
        .api('put', `/quotes/${second.body.id}/items`, reception.token)
        .send({ items: [{ type: 'service', description: 'Troca de pastilhas (desconto)', quantity: 1, unit_price: 160 }] })
        .expect(200);
      const resent = await h.api('post', `/quotes/${second.body.id}/send`, reception.token).expect(200);
      const newToken = resent.body.portal_url.split('/').pop();
      expect(resent.body.quote.total_amount).toBe(160);

      await h.api('get', `/portal/${token}/order`).expect(404);
      await h.api('post', `/portal/${newToken}/consent`).expect(204);
      const approved = await h.api('post', `/portal/${newToken}/quotes/${second.body.id}/approve`).expect(200);
      expect(approved.body.order).toMatchObject({ status: 'approved', total_amount: 160 });

      const final = await h.api('get', `/service-orders/${order.id}`, shop.ownerToken).expect(200);
      expect(final.body.items.map((item: { description: string }) => item.description)).toEqual(['Troca de pastilhas (desconto)']);
      expect(final.body.history.map((entry: { to_status: string }) => entry.to_status)).toEqual([
        'draft',
        'diagnosis',
        'awaiting_approval',
        'rejected',
        'diagnosis',
        'awaiting_approval',
        'approved'
      ]);
    });

    it('a oficina pode registrar a aprovação feita no balcão', async () => {
      const { order, quoteId } = await orderAwaitingApproval();
      await h.api('post', `/quotes/${quoteId}/approve`, mechanic.token).send({}).expect(403);
      await h.api('post', `/quotes/${quoteId}/approve`, reception.token).send({ notes: 'Aprovou por telefone' }).expect(200);
      const loaded = await h.api('get', `/service-orders/${order.id}`, shop.ownerToken).expect(200);
      expect(loaded.body.status).toBe('approved');
      expect(loaded.body.history.at(-1)).toMatchObject({ actor_type: 'staff', to_status: 'approved' });
    });

    it('recalcular sugestões é explícito e OS encerrada não aceita mais alterações', async () => {
      const order = await newOrder();
      await status(order.id, 'diagnosis').expect(200);
      const first = (await h.api('get', `/service-orders/${order.id}`, shop.ownerToken)).body;
      const partOf = (body: { mechanic_suggestions_snapshot: { suggestions: Array<{ parts: Array<{ name: string; shop_price: number | null }> }> } }) =>
        body.mechanic_suggestions_snapshot.suggestions[0].parts.find((part) => part.name === 'Disco de freio dianteiro');
      expect(partOf(first)).toMatchObject({ shop_price: null });

      // a oficina cadastra o preço da peça depois: o snapshot da OS NÃO muda sozinho…
      await h.api('post', '/catalog/parts', shop.ownerToken).send({ name: 'disco de freio dianteiro', sku: 'DF-22', default_price: 249.9 }).expect(201);
      const unchanged = (await h.api('get', `/service-orders/${order.id}`, shop.ownerToken)).body;
      expect(JSON.stringify(unchanged.mechanic_suggestions_snapshot)).toBe(JSON.stringify(first.mechanic_suggestions_snapshot));
      // …só quando o mecânico pede o recálculo
      const recomputed = await h.api('post', `/service-orders/${order.id}/recompute-suggestions`, shop.ownerToken).expect(200);
      expect(partOf(recomputed.body)).toMatchObject({ shop_price: 249.9, shop_sku: 'DF-22' });

      await status(order.id, 'cancelled').expect(200);
      await h.api('patch', `/service-orders/${order.id}`, shop.ownerToken).send({ mechanic_diagnosis: 'tarde demais' }).expect(409);
      await h.api('post', `/service-orders/${order.id}/recompute-suggestions`, shop.ownerToken).expect(409);
    });

    it('numera as OS em sequência mesmo com aberturas simultâneas', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, nextPlate());
      const before = (await h.api('get', '/service-orders?pageSize=1', shop.ownerToken)).body.total;
      const created = await Promise.all(
        Array.from({ length: 8 }, () => h.api('post', '/service-orders', reception.token).send({ customer_id: customer.id, vehicle_id: vehicle.id }))
      );
      expect(created.map((response) => response.status)).toEqual(Array(8).fill(201));
      const numbers = created.map((response) => response.body.order_number).sort((x, y) => x - y);
      expect(numbers).toEqual(Array.from({ length: 8 }, (_, index) => before + 1 + index));
    });
  });

  describe('portal do cliente', () => {
    it('token inexistente, malformado ou revogado: mesma resposta, sem revelar nada', async () => {
      const { order, token } = await orderAwaitingApproval();
      const missing = await h.api('get', '/portal/3f2b8c1e-7a4d-4e9b-9c53-0a1b2c3d4e5f/order').expect(404);
      const malformed = await h.api('get', "/portal/'%20or%201=1--/order").expect(404);
      expect(malformed.body.message).toBe(missing.body.message);
      expect(malformed.body.path).not.toContain('or%201');

      const links = await h.api('get', `/service-orders/${order.id}/access-links`, reception.token).expect(200);
      expect(JSON.stringify(links.body)).not.toContain('token_hash');
      await h.api('delete', `/access-links/${links.body[0].id}`, reception.token).expect(204);
      const revoked = await h.api('get', `/portal/${token}/order`).expect(404);
      expect(revoked.body.message).toBe(missing.body.message);
    });

    it('token expirado deixa de valer', async () => {
      const { order, token } = await orderAwaitingApproval();
      await h.api('get', `/portal/${token}/order`).expect(200);
      await h.db.admin((db) =>
        db.exec(`update public.customer_access_tokens set expires_at = now() - interval '1 minute' where service_order_id = $1`, [order.id])
      );
      await h.api('get', `/portal/${token}/order`).expect(404);
    });

    it('o token de um pedido não age sobre o orçamento de outro', async () => {
      const first = await orderAwaitingApproval();
      const second = await orderAwaitingApproval();
      await h.api('post', `/portal/${first.token}/quotes/${second.quoteId}/approve`).expect(404);
      expect((await h.api('get', `/quotes/${second.quoteId}`, reception.token)).body.status).toBe('sent');
    });

    it('link de acompanhamento vê o pedido mas não aprova', async () => {
      const { order, quoteId } = await orderAwaitingApproval();
      const link = await h.api('post', `/service-orders/${order.id}/access-links`, reception.token).expect(201);
      const viewToken = link.body.portal_url.split('/').pop();
      await h.api('post', `/portal/${viewToken}/consent`).expect(204);
      const view = await h.api('get', `/portal/${viewToken}/order`).expect(200);
      expect(view.body.quote).toMatchObject({ can_respond: false });
      await h.api('post', `/portal/${viewToken}/quotes/${quoteId}/approve`).expect(404);
    });

    it('a resposta do portal nunca contém dados internos', async () => {
      const { order, token } = await orderAwaitingApproval();
      await h
        .api('patch', `/service-orders/${order.id}`, shop.ownerToken)
        .send({ mechanic_diagnosis: 'SEGREDO-DIAGNOSTICO', confirmed_causes: [{ symptom_code: 'brake_grinding', cause_description: 'SEGREDO-CAUSA' }] })
        .expect(200);
      await h.api('post', `/service-orders/${order.id}/notes`, shop.ownerToken).send({ body: 'SEGREDO-NOTA-INTERNA' }).expect(201);
      await h.api('post', `/service-orders/${order.id}/notes`, shop.ownerToken).send({ body: 'Peça chega amanhã.', visible_to_customer: true }).expect(201);

      const order2 = await h.api('get', `/portal/${token}/order`).expect(200);
      const history = await h.api('get', `/portal/${token}/history`).expect(200);
      const raw = JSON.stringify([order2.body, history.body]);
      for (const leak of [
        'SEGREDO',
        'mechanic_diagnosis',
        'mechanic_suggestions_snapshot',
        'confirmed_causes',
        'final_score',
        'tenant_id',
        'customer_id',
        'changed_by',
        'unit_cost'
      ]) {
        expect(raw).not.toContain(leak);
      }
      expect(order2.body.shop_messages).toEqual([expect.objectContaining({ body: 'Peça chega amanhã.' })]);
      expect(Object.keys(order2.body).sort()).toEqual([
        'consent_required',
        'customer_notes',
        'order',
        'privacy_policy_version',
        'quote',
        'reported_symptoms',
        'shop',
        'shop_messages',
        'timeline',
        'vehicle'
      ]);
    });

    it('o histórico do portal mostra só serviços concluídos do mesmo veículo', async () => {
      const { token } = await orderAwaitingApproval();
      await orderAwaitingApproval();
      const history = await h.api('get', `/portal/${token}/history`).expect(200);
      expect(history.body).toEqual([]);
    });

    it('registra o consentimento LGPD uma única vez, com versão da política', async () => {
      const { order } = await orderAwaitingApproval();
      const log = await h.db.admin((db) =>
        db.many<{ policy_version: string }>('select policy_version from public.customer_consent_log where service_order_id = $1', [order.id])
      );
      expect(log).toEqual([{ policy_version: '2026-11' }]);
    });
  });

  describe('triagem pública', () => {
    it('cliente preenche pelo link; a oficina vincula e converte em OS', async () => {
      const intro = await h.api('get', `/triage/public/${shop.slug}`).expect(200);
      expect(intro.body.catalog).toHaveLength(6);
      await h
        .api('post', `/triage/public/${shop.slug}/sessions`)
        .send({
          contact: { name: 'Joana Prado', phone: '(71) 97777-1234', plate: 'jkl-4m56', vehicle: 'Fiat Argo 2021' },
          reported_symptoms: [{ symptom_code: 'cooling_overheating', answers: { when: 'No trânsito parado' } }],
          free_form_notes: 'A luz vermelha acendeu ontem.'
        })
        .expect(201);
      await h
        .api('post', `/triage/public/${shop.slug}/sessions`)
        .send({ contact: { name: 'X', phone: '1' }, reported_symptoms: [] })
        .expect(400);
      await h
        .api('post', '/triage/public/oficina-que-nao-existe/sessions')
        .send({ contact: { name: 'Joana', phone: '71977771234' }, reported_symptoms: [{ symptom_code: 'cooling_overheating' }] })
        .expect(404);

      const pending = await h.api('get', '/triage/sessions?status=pending', reception.token).expect(200);
      const session = pending.body.data.find((item: { source: string }) => item.source === 'public');
      expect(session.contact).toMatchObject({ name: 'Joana Prado', phone: '71977771234', plate: 'JKL4M56' });
      await h.api('post', `/triage/sessions/${session.id}/convert`, reception.token).expect(400);

      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, 'JKL4M56', { brand: 'Fiat', model: 'Argo' });
      await h.api('patch', `/triage/sessions/${session.id}`, reception.token).send({ customer_id: customer.id, vehicle_id: vehicle.id }).expect(200);
      const order = await h.api('post', `/triage/sessions/${session.id}/convert`, reception.token).expect(201);
      expect(order.body.reported_symptoms).toEqual([{ symptom_code: 'cooling_overheating', answers: { when: 'No trânsito parado' } }]);
    });
  });

  describe('autenticação e RBAC', () => {
    it('exige token válido', async () => {
      await h.api('get', '/customers').expect(401);
      await h.api('get', '/customers', 'token.invalido.aqui').expect(401);
      await h.api('post', '/auth/login').send({ email: shop.ownerEmail, password: 'senha-errada' }).expect(401);
      const error = await h.api('get', '/customers').expect(401);
      expect(Object.keys(error.body).sort()).toEqual(['error', 'message', 'path', 'statusCode', 'timestamp']);
    });

    it('refresh emite nova sessão; refresh token não serve como access token', async () => {
      const login = await h.api('post', '/auth/login').send({ email: shop.ownerEmail, password: 'senha-forte-123' }).expect(200);
      await h.api('get', '/auth/me', login.body.refresh_token).expect(401);
      const refreshed = await h.api('post', '/auth/refresh').send({ refresh_token: login.body.refresh_token }).expect(200);
      await h.api('get', '/auth/me', refreshed.body.access_token).expect(200);
    });

    it('valida payloads e recusa campos desconhecidos', async () => {
      await h.api('post', '/customers', reception.token).send({ name: 'A' }).expect(400);
      await h.api('post', '/customers', reception.token).send({ name: 'Válido', tenant_id: shop.id }).expect(400);
      await h.api('post', '/vehicles', reception.token).send({ customer_id: 'nao-e-uuid', plate: 'ABC1234' }).expect(400);
      await h.api('get', '/customers/nao-e-uuid', reception.token).expect(400);
      await h
        .api('post', '/triage/sessions', reception.token)
        .send({ reported_symptoms: [{ symptom_code: 'sintoma_inventado' }] })
        .expect(400);
    });

    it('mecânico não cadastra clientes nem gerencia usuários; recepção não gerencia usuários', async () => {
      await h.api('post', '/customers', mechanic.token).send({ name: 'Não pode' }).expect(403);
      await h.api('get', '/users', mechanic.token).expect(403);
      await h.api('get', '/users', reception.token).expect(403);
      await h.api('post', '/catalog/parts', reception.token).send({ name: 'Peça', default_price: 10 }).expect(403);
      await h.api('get', '/customers', mechanic.token).expect(200);
    });

    it('mecânico vê só as próprias OS — até a oficina liberar a fila', async () => {
      const mine = await newOrder();
      const theirs = await newOrder();
      await h.api('patch', `/service-orders/${mine.id}`, reception.token).send({ assigned_mechanic_id: mechanic.id }).expect(200);
      await h.api('patch', `/service-orders/${theirs.id}`, reception.token).send({ assigned_mechanic_id: otherMechanic.id }).expect(200);

      const board = await h.api('get', '/service-orders/board', mechanic.token).expect(200);
      expect(board.body.map((order: { id: string }) => order.id)).toEqual([mine.id]);
      await h.api('get', `/service-orders/${theirs.id}`, mechanic.token).expect(404);
      await status(theirs.id, 'diagnosis', mechanic.token).expect(404);
      await h.api('patch', `/service-orders/${mine.id}`, mechanic.token).send({ assigned_mechanic_id: otherMechanic.id }).expect(403);

      await h.api('patch', '/tenant/settings', reception.token).send({ mechanics_see_all_orders: true }).expect(403);
      await h.api('patch', '/tenant/settings', shop.ownerToken).send({ mechanics_see_all_orders: true }).expect(200);
      await h.api('get', `/service-orders/${theirs.id}`, mechanic.token).expect(200);
      await h.api('patch', '/tenant/settings', shop.ownerToken).send({ mechanics_see_all_orders: false }).expect(200);
    });

    it('usuário desativado perde o acesso na hora e a oficina nunca fica sem proprietário', async () => {
      const temp = await h.createUser(shop, 'receptionist');
      await h.api('patch', `/users/${temp.id}`, shop.ownerToken).send({ is_active: false }).expect(200);
      const denied = await h.api('get', '/customers', temp.token).expect(403);
      expect(denied.body.code).toBe('USER_DISABLED');

      const users = await h.api('get', '/users', shop.ownerToken).expect(200);
      const owner = users.body.find((user: { role: string }) => user.role === 'owner');
      await h.api('patch', `/users/${owner.id}`, shop.ownerToken).send({ role: 'manager' }).expect(400);
      await h.api('delete', `/users/${owner.id}`, shop.ownerToken).expect(400);
    });

    it('LGPD: exporta e anonimiza um cliente, preservando o histórico de serviço', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, nextPlate());
      const order = await h.api('post', '/service-orders', reception.token).send({ customer_id: customer.id, vehicle_id: vehicle.id }).expect(201);
      await h.api('get', `/customers/${customer.id}/export`, reception.token).expect(403);
      const exported = await h.api('get', `/customers/${customer.id}/export`, shop.ownerToken).expect(200);
      expect(exported.body).toMatchObject({ customer: { name: customer.name }, vehicles: [{ plate: vehicle.plate }] });

      await h.api('post', `/customers/${customer.id}/anonymize`, shop.ownerToken).send({ confirm: true }).expect(400);
      await status(order.body.id, 'cancelled').expect(200);
      await h.api('post', `/customers/${customer.id}/anonymize`, shop.ownerToken).send({}).expect(400);
      const anonymized = await h.api('post', `/customers/${customer.id}/anonymize`, shop.ownerToken).send({ confirm: true }).expect(200);
      expect(anonymized.body).toMatchObject({ name: 'Cliente anonimizado', phone: null, email: null });
      expect(anonymized.body.anonymized_at).toBeTruthy();
      const after = await h.api('get', `/vehicles/${vehicle.id}`, shop.ownerToken).expect(200);
      expect(after.body.plate).toMatch(/^ANON/);
      expect(after.body.orders).toHaveLength(1);
    });
  });

  describe('planos, limites e feature flags', () => {
    it('respeita o limite de usuários e de OS por mês do plano', async () => {
      const small = await h.createTenant();
      await h
        .api('patch', `/admin/tenants/${small.id}`, h.adminToken)
        .send({ limits: { max_users: 2, max_orders_month: 1 } })
        .expect(200);
      await h.createUser(small, 'mechanic');
      const over = await h
        .api('post', '/users', small.ownerToken)
        .send({ email: `${unique('x')}@oficina.test`, full_name: 'Excedente', role: 'mechanic', password: 'senha-forte-123' })
        .expect(403);
      expect(over.body.code).toBe('LIMIT_REACHED');

      const { customer, vehicle } = await h.createCustomerWithVehicle(small.ownerToken, 'LIM1T01');
      await h.api('post', '/service-orders', small.ownerToken).send({ customer_id: customer.id, vehicle_id: vehicle.id }).expect(201);
      const blocked = await h.api('post', '/service-orders', small.ownerToken).send({ customer_id: customer.id, vehicle_id: vehicle.id }).expect(403);
      expect(blocked.body.code).toBe('LIMIT_REACHED');
    });

    it('módulo desligado por feature flag some para o tenant — e a OS segue funcionando sem o motor', async () => {
      const bare = await h.createTenant();
      await h
        .api('patch', `/admin/tenants/${bare.id}`, h.adminToken)
        .send({ feature_flags: { diagnostics: false, triage: false, portal: false } })
        .expect(200);
      for (const path of ['/triage/catalog', '/diagnostics/suggest/brake_grinding']) {
        const off = await h.api('get', path, bare.ownerToken).expect(403);
        expect(off.body.code).toBe('FEATURE_DISABLED');
      }
      await h.api('get', `/triage/public/${bare.slug}`).expect(403);

      const { customer, vehicle } = await h.createCustomerWithVehicle(bare.ownerToken, 'FLG0F01');
      const order = await h
        .api('post', '/service-orders', bare.ownerToken)
        .send({ customer_id: customer.id, vehicle_id: vehicle.id, reported_symptoms: [{ symptom_code: 'brake_grinding' }] })
        .expect(201);
      const started = await status(order.body.id, 'diagnosis', bare.ownerToken).expect(200);
      expect(started.body.mechanic_suggestions_snapshot).toBeNull();
      await h
        .api('post', `/service-orders/${order.body.id}/items`, bare.ownerToken)
        .send({ type: 'service', description: 'Serviço manual', quantity: 1, unit_price: 80 })
        .expect(201);
      const quote = await h.api('post', `/service-orders/${order.body.id}/quotes`, bare.ownerToken).expect(201);
      const sent = await h.api('post', `/quotes/${quote.body.id}/send`, bare.ownerToken).expect(200);
      await h.api('get', `/portal/${sent.body.portal_url.split('/').pop()}`).expect(404);
      await h.api('post', `/quotes/${quote.body.id}/approve`, bare.ownerToken).send({}).expect(200);
      for (const next of ['in_progress', 'completed', 'delivered']) await status(order.body.id, next, bare.ownerToken).expect(200);
    });

    it('licença vencida bloqueia o tenant; renovar a validade libera', async () => {
      const lapsed = await h.createTenant({ expires_at: new Date(Date.now() + 86_400_000).toISOString() });
      await h.api('get', '/customers', lapsed.ownerToken).expect(200);
      await h
        .api('patch', `/admin/tenants/${lapsed.id}`, h.adminToken)
        .send({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .expect(200);
      const denied = await h.api('get', '/customers', lapsed.ownerToken).expect(403);
      expect(denied.body.code).toBe('TENANT_EXPIRED');
      await h.api('patch', `/admin/tenants/${lapsed.id}`, h.adminToken).send({ expires_at: null }).expect(200);
      await h.api('get', '/customers', lapsed.ownerToken).expect(200);
    });
  });

  describe('rate limiting', () => {
    beforeAll(() => (process.env.THROTTLE_DISABLED = 'false'));
    afterAll(() => (process.env.THROTTLE_DISABLED = 'true'));

    it('login: no máximo 5 tentativas por minuto por IP', async () => {
      const attempts = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        attempts.push((await h.api('post', '/auth/login').send({ email: 'ninguem@oficina.test', password: 'errada' })).status);
      }
      expect(attempts).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it('portal: 30 requisições por minuto por token, sem afetar outros tokens', async () => {
      process.env.THROTTLE_DISABLED = 'true';
      const first = await orderAwaitingApproval();
      const second = await orderAwaitingApproval();
      process.env.THROTTLE_DISABLED = 'false';
      const statuses = [];
      for (let call = 0; call < 31; call += 1) statuses.push((await h.api('get', `/portal/${first.token}`)).status);
      expect(statuses.slice(0, 30).every((code) => code === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
      await h.api('get', `/portal/${second.token}`).expect(200);
    });
  });

  describe('painel super admin', () => {
    it('é inacessível a usuários de oficina, inclusive proprietários', async () => {
      for (const path of ['/admin/tenants', '/admin/metrics', '/admin/audit']) await h.api('get', path, shop.ownerToken).expect(403);
      await h.api('post', '/admin/tenants', shop.ownerToken).send({}).expect(403);
      await h.api('get', '/admin/tenants').expect(401);
      // e o super admin, por sua vez, não tem acesso operacional aos dados das oficinas
      await h.api('get', '/customers', h.adminToken).expect(403);
    });

    it('provisiona tenant com flags e limites padrão do plano e audita a criação', async () => {
      const created = await h.createTenant({ plan: 'basic' });
      const me = await h.api('get', '/auth/me', created.ownerToken).expect(200);
      expect(me.body.tenant).toMatchObject({ plan: 'basic', limits: { max_users: 5, max_orders_month: 150 } });
      expect(me.body.tenant.feature_flags).toMatchObject({ triage: true, diagnostics: true, portal: true, ai: false, inventory: false });

      const detail = await h.api('get', `/admin/tenants/${created.id}`, h.adminToken).expect(200);
      expect(detail.body).toMatchObject({ users_count: 1, orders_this_month: 0, expiring_soon: false });
      expect(detail.body.users[0]).toMatchObject({ role: 'owner', email: created.ownerEmail });

      await h
        .api('post', '/admin/tenants', h.adminToken)
        .send({ name: 'Duplicada', slug: created.slug, plan: 'basic', owner_email: `${unique('d')}@oficina.test`, owner_name: 'Outra' })
        .expect(409);
      const audit = await h.api('get', `/admin/audit?tenant_id=${created.id}`, h.adminToken).expect(200);
      expect(audit.body.data).toEqual([expect.objectContaining({ action: 'tenant.created', super_admin_email: h.adminEmail, tenant_slug: created.slug })]);
    });

    it('impersonation gera acesso temporário de owner e fica registrada com o motivo', async () => {
      const target = await h.createTenant();
      await h.api('post', `/admin/tenants/${target.id}/impersonate`, h.adminToken).send({ reason: 'x' }).expect(400);
      const session = await h
        .api('post', `/admin/tenants/${target.id}/impersonate`, h.adminToken)
        .send({ reason: 'Chamado #482: cliente não consegue enviar orçamento' })
        .expect(200);
      expect(session.body.expires_in).toBe(900);
      expect(session.body.app_url).toBe('http://localhost:4200');

      const me = await h.api('get', '/auth/me', session.body.access_token).expect(200);
      expect(me.body).toMatchObject({ impersonated_by: h.adminEmail, is_super_admin: false, tenant: { id: target.id }, membership: { role: 'owner' } });
      const { customer, vehicle } = await h.createCustomerWithVehicle(session.body.access_token, 'IMP0S01');
      const order = await h.api('post', '/service-orders', session.body.access_token).send({ customer_id: customer.id, vehicle_id: vehicle.id }).expect(201);
      expect(order.body.history[0]).toMatchObject({ actor_type: 'support', changed_by_name: 'Suporte PitStop' });
      // o token de suporte não abre o painel admin nem outro tenant
      await h.api('get', '/admin/tenants', session.body.access_token).expect(403);
      expect((await h.api('get', '/customers', session.body.access_token)).body.total).toBe(1);

      const audit = await h.api('get', `/admin/audit?tenant_id=${target.id}`, h.adminToken).expect(200);
      expect(audit.body.data[0]).toMatchObject({ action: 'tenant.impersonated', payload: { reason: 'Chamado #482: cliente não consegue enviar orçamento' } });
    });

    it('lista tenants com alerta de expiração e expõe métricas globais', async () => {
      const soon = await h.createTenant({ expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), is_trial: true });
      const list = await h.api('get', `/admin/tenants?q=${soon.slug}`, h.adminToken).expect(200);
      expect(list.body.data).toEqual([expect.objectContaining({ id: soon.id, expiring_soon: true, is_trial: true })]);

      const metrics = await h.api('get', '/admin/metrics', h.adminToken).expect(200);
      expect(metrics.body.tenants_active).toBeGreaterThanOrEqual(2);
      expect(metrics.body.tenants_trial).toBeGreaterThanOrEqual(1);
      expect(metrics.body.tenants_expiring_7d).toBeGreaterThanOrEqual(1);
      expect(metrics.body.growth).toHaveLength(6);
      expect(metrics.body.growth.at(-1).orders).toBe(metrics.body.orders_this_month);
    });
  });
});
