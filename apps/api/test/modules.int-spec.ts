/** Módulos de apoio: catálogo da oficina, dashboard por papel, veículos e a consulta externa de placa. */
import { Harness, TestTenant } from './harness';

describe('Catálogo, dashboard e veículos', () => {
  let h: Harness;
  let shop: TestTenant;
  let reception: { id: string; token: string };
  let mechanic: { id: string; token: string };
  const realFetch = global.fetch;

  beforeAll(async () => {
    process.env.FIPE_PLATE_API_URL = 'https://placas.test/consulta/{plate}';
    process.env.DPO_CONTACT_EMAIL = ' dpo@pitstop.test ';
    h = await Harness.start();
    shop = await h.createTenant();
    reception = await h.createUser(shop, 'receptionist');
    mechanic = await h.createUser(shop, 'mechanic');
  });

  afterAll(async () => {
    delete process.env.FIPE_PLATE_API_URL;
    delete process.env.DPO_CONTACT_EMAIL;
    global.fetch = realFetch;
    await h.stop();
  });

  describe('catálogo de serviços e peças', () => {
    it('gestão cadastra, altera, desativa e exclui; os demais só consultam', async () => {
      await h.api('post', '/catalog/services', reception.token).send({ name: 'Alinhamento', default_price: 90 }).expect(403);

      const service = await h
        .api('post', '/catalog/services', shop.ownerToken)
        .send({ name: '  Alinhamento  ', description: '', default_price: 90, duration_minutes: 40 })
        .expect(201);
      expect(service.body).toMatchObject({ name: 'Alinhamento', description: null, default_price: 90, duration_minutes: 40, is_active: true });

      const updated = await h
        .api('patch', `/catalog/services/${service.body.id}`, shop.ownerToken)
        .send({ default_price: 110.5, is_active: false })
        .expect(200);
      expect(updated.body).toMatchObject({ default_price: 110.5, is_active: false });

      const part = await h.api('post', '/catalog/parts', shop.ownerToken).send({ name: 'Filtro de óleo', sku: 'FO-1', default_price: 35 }).expect(201);
      await h.api('patch', `/catalog/parts/${part.body.id}`, shop.ownerToken).send({ sku: 'FO-2' }).expect(200);

      const seen = await h.api('get', '/catalog/services', mechanic.token).expect(200);
      expect(seen.body.map((row: { name: string }) => row.name)).toContain('Alinhamento');
      const parts = await h.api('get', '/catalog/parts', mechanic.token).expect(200);
      expect(parts.body).toEqual([expect.objectContaining({ name: 'Filtro de óleo', sku: 'FO-2' })]);

      await h.api('delete', `/catalog/services/${service.body.id}`, shop.ownerToken).expect(204);
      await h.api('delete', `/catalog/parts/${part.body.id}`, shop.ownerToken).expect(204);
      await h.api('delete', `/catalog/parts/${part.body.id}`, shop.ownerToken).expect(404);
      await h.api('patch', `/catalog/services/${service.body.id}`, shop.ownerToken).send({ name: 'Sumiu' }).expect(404);
    });

    it('valida preço e nome', async () => {
      await h.api('post', '/catalog/parts', shop.ownerToken).send({ name: 'X', default_price: 10 }).expect(400);
      await h.api('post', '/catalog/parts', shop.ownerToken).send({ name: 'Pastilha', default_price: -1 }).expect(400);
    });
  });

  describe('veículos', () => {
    it('busca por placa em qualquer formato, edita e mantém o histórico', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, 'MOD1A11');
      expect((await h.api('get', '/vehicles/by-plate/mod-1a11', mechanic.token).expect(200)).body.id).toBe(vehicle.id);
      await h.api('get', '/vehicles/by-plate/ZZZ9Z99', mechanic.token).expect(404);

      const list = await h.api('get', '/vehicles', reception.token).query({ q: 'MOD1' }).expect(200);
      expect(list.body.data).toEqual([expect.objectContaining({ plate: 'MOD1A11', customer_name: customer.name })]);
      expect((await h.api('get', '/vehicles/count', reception.token).expect(200)).body).toEqual({ total: 1 });

      const updated = await h
        .api('patch', `/vehicles/${vehicle.id}`, reception.token)
        .send({ color: 'Prata', vin: '9bwzzz377vt004251', current_mileage: 70500, notes: '' })
        .expect(200);
      expect(updated.body).toMatchObject({ color: 'Prata', vin: '9BWZZZ377VT004251', current_mileage: 70500, notes: null });

      await h.api('post', '/vehicles', reception.token).send({ customer_id: customer.id, plate: '12' }).expect(400);
      await h.api('delete', `/vehicles/${vehicle.id}`, reception.token).expect(403);

      const detail = await h.api('get', `/vehicles/${vehicle.id}`, mechanic.token).expect(200);
      expect(detail.body.orders).toEqual([]);
    });

    it('consulta externa de placa: usa o provedor, guarda em cache e nunca bloqueia o cadastro', async () => {
      const calls: string[] = [];
      global.fetch = jest.fn(async (url: unknown) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ marca: 'Ford', modelo: 'Ka', ano: 2019, cor: 'Prata' }), { status: 200 });
      }) as typeof fetch;

      const first = await h.api('get', '/vehicles/lookup/fip-1a23', reception.token).expect(200);
      expect(first.body).toMatchObject({ plate: 'FIP1A23', cached: false });
      expect(calls).toEqual(['https://placas.test/consulta/FIP1A23']);

      const second = await h.api('get', '/vehicles/lookup/FIP1A23', reception.token).expect(200);
      expect(second.body).toMatchObject({ plate: 'FIP1A23', cached: true });
      expect(calls).toHaveLength(1);

      global.fetch = jest.fn(async () => new Response('fora do ar', { status: 502 })) as typeof fetch;
      const down = await h.api('get', '/vehicles/lookup/FIP9Z99', reception.token).expect(503);
      expect(down.body.message).toMatch(/manualmente/);

      global.fetch = jest.fn(async () => {
        throw new Error('timeout');
      }) as typeof fetch;
      await h.api('get', '/vehicles/lookup/FIP8Z88', reception.token).expect(503);
      await h.api('get', '/vehicles/lookup/123', reception.token).expect(400);
    });
  });

  describe('sessão', () => {
    it('logout exige sessão e responde 204; /me devolve tenant e papel', async () => {
      await h.api('post', '/auth/logout').expect(401);
      await h.api('post', '/auth/logout', reception.token).expect(204);
      const me = await h.api('get', '/auth/me', reception.token).expect(200);
      expect(me.body).toMatchObject({ is_super_admin: false, membership: { role: 'receptionist' }, tenant: { id: shop.id, slug: shop.slug } });
    });
  });

  describe('política de privacidade', () => {
    it('expõe versão e contato do encarregado sem exigir login', async () => {
      const info = await h.api('get', '/privacy').expect(200);
      expect(info.body).toEqual({ policy_version: '2026-11', dpo_email: 'dpo@pitstop.test' });
    });
  });

  describe('dashboard', () => {
    it('mostra a cada papel o que pede ação dele', async () => {
      const { customer, vehicle } = await h.createCustomerWithVehicle(reception.token, 'MOD2B22');
      const open = (assigned?: string) =>
        h
          .api('post', '/service-orders', reception.token)
          .send({ customer_id: customer.id, vehicle_id: vehicle.id, assigned_mechanic_id: assigned })
          .expect(201);
      const mine = (await open(mechanic.id)).body;
      const free = (await open()).body;
      const other = await h.createUser(shop, 'mechanic');
      const theirs = (await open(other.id)).body;

      const forReception = (await h.api('get', '/dashboard/summary', reception.token).expect(200)).body;
      expect(forReception.opened_today).toBeGreaterThanOrEqual(3);
      // primeiros passos: já há equipe e OS aberta; o catálogo foi esvaziado no teste anterior
      expect(forReception.onboarding).toEqual({ team: true, catalog: false, first_order: true });
      expect(forReception.needs_action.map((order: { id: string }) => order.id)).toEqual(expect.arrayContaining([mine.id, free.id, theirs.id]));

      // fila restrita (padrão): o mecânico conta só as próprias, mas enxerga as livres para poder assumir
      const forMechanic = (await h.api('get', '/dashboard/summary', mechanic.token).expect(200)).body;
      expect(forMechanic.opened_today).toBe(1);
      const ids = forMechanic.needs_action.map((order: { id: string }) => order.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      expect(forMechanic).toEqual(expect.objectContaining({ awaiting_approval: 0, in_progress: 0, pending_triage: 0 }));
    });
  });
});
