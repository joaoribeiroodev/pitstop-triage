/** E-mail da plataforma (Gmail + senha de app), convites e redefinição de senha, validade da oficina e tabela FIPE. */
import { createTransport } from 'nodemailer';
import { Harness, TestTenant } from './harness';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Plataforma: e-mail, convites, validade e FIPE', () => {
  let h: Harness;
  let shop: TestTenant;
  const sendMail = jest.fn();
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  const lastMail = () => sendMail.mock.calls.at(-1)?.[0] as Json;
  const linkIn = (mail: Json) => String(mail.text).match(/definir-senha\/([0-9a-f-]{36})/)![1];
  const login = (email: string, password: string) => h.api('post', '/auth/login').send({ email, password });

  beforeAll(async () => {
    h = await Harness.start();
    shop = await h.createTenant();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: '1' });
    (createTransport as jest.Mock).mockReset().mockReturnValue({ sendMail, close: jest.fn() });
    fetchMock.mockReset();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await h.stop();
  });

  describe('sem e-mail configurado', () => {
    it('convite exige senha e a recuperação de senha avisa que não está disponível', async () => {
      const settings = await h.api('get', '/admin/email-settings', h.adminToken).expect(200);
      expect(settings.body).toEqual({ configured: false, user: null, from_name: null, updated_at: null });
      await h.api('get', '/admin/email-settings', shop.ownerToken).expect(403);

      const invite = await h.api('post', '/users', shop.ownerToken).send({ email: 'mec@semmail.test', full_name: 'Sem Mail', role: 'mechanic' }).expect(400);
      expect(invite.body.message).toContain('Defina uma senha');
      await h
        .api('post', '/admin/tenants', h.adminToken)
        .send({ name: 'Sem Mail', slug: 'sem-mail', plan: 'basic', owner_email: 'dono@semmail.test', owner_name: 'Dono' })
        .expect(400);
      expect(await h.db.admin((db) => db.many(`select 1 from public.tenants where slug = 'sem-mail'`))).toEqual([]);

      await h.api('post', '/auth/password-reset').send({ email: shop.ownerEmail }).expect(503);
      await h.api('post', '/admin/email-settings/test', h.adminToken).send({}).expect(400);
      await h.api('put', '/admin/email-settings', h.adminToken).send({ user: 'oficina@gmail.com' }).expect(400);
    });
  });

  describe('e-mail da plataforma', () => {
    it('salva a conta Gmail com a senha de app cifrada e nunca a devolve', async () => {
      await h.api('put', '/admin/email-settings', h.adminToken).send({ user: 'não é e-mail', app_password: 'abcd efgh ijkl mnop' }).expect(400);
      const saved = await h
        .api('put', '/admin/email-settings', h.adminToken)
        .send({ user: 'PitStop.Envio@Gmail.com', app_password: 'abcd efgh ijkl mnop' })
        .expect(200);
      expect(saved.body).toMatchObject({ configured: true, user: 'pitstop.envio@gmail.com', from_name: 'PitStop' });
      expect(JSON.stringify(saved.body)).not.toContain('abcd');

      const stored = await h.db.admin((db) => db.one<{ value: Json }>(`select value from public.platform_settings where key = 'smtp'`));
      expect(JSON.stringify(stored.value)).not.toMatch(/abcd|efgh|mnop/);
      expect(stored.value.secret.split('.')).toHaveLength(3);

      // trocar só o nome mantém a senha
      const renamed = await h
        .api('put', '/admin/email-settings', h.adminToken)
        .send({ user: 'pitstop.envio@gmail.com', from_name: ' Oficinas PitStop ' })
        .expect(200);
      expect(renamed.body.from_name).toBe('Oficinas PitStop');

      await h.api('post', '/admin/email-settings/test', h.adminToken).send({ to: 'x' }).expect(400);
      await h.api('post', '/admin/email-settings/test', h.adminToken).send({}).expect(204);
      expect((createTransport as jest.Mock).mock.calls.at(-1)[0]).toMatchObject({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: 'pitstop.envio@gmail.com', pass: 'abcdefghijklmnop' }
      });
      expect(lastMail()).toMatchObject({
        to: h.adminEmail,
        from: { name: 'Oficinas PitStop', address: 'pitstop.envio@gmail.com' },
        subject: 'Teste de e-mail do PitStop'
      });
      await h.api('post', '/admin/email-settings/test', h.adminToken).send({ to: 'Outro@Teste.com' }).expect(204);
      expect(lastMail().to).toBe('outro@teste.com');

      const trail = await h.api('get', '/admin/audit', h.adminToken).expect(200);
      expect(JSON.stringify(trail.body)).toContain('platform.email_updated');
      expect(JSON.stringify(trail.body)).not.toContain('abcd');
    });

    it('explica quando o Gmail recusa o login ou está fora do ar', async () => {
      sendMail.mockRejectedValueOnce(Object.assign(new Error('Invalid login: 535 senha: abcdefghijklmnop'), { code: 'EAUTH', responseCode: 535 }));
      const denied = await h.api('post', '/admin/email-settings/test', h.adminToken).send({}).expect(502);
      expect(denied.body.message).toContain('recusou o login');
      expect(JSON.stringify(denied.body)).not.toContain('abcdefgh');
      sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
      const down = await h.api('post', '/admin/email-settings/test', h.adminToken).send({}).expect(502);
      expect(down.body.message).toContain('Tente de novo');
    });
  });

  describe('convite e redefinição de senha', () => {
    let memberId: string;

    it('membro sem senha recebe o convite, define a senha pelo link e entra', async () => {
      const created = await h
        .api('post', '/users', shop.ownerToken)
        .send({ email: 'Mecanico@Convite.test', full_name: 'Jorge Silva', role: 'mechanic' })
        .expect(201);
      expect(created.body.invited).toBe(true);
      memberId = created.body.id;
      const mail = lastMail();
      expect(mail).toMatchObject({ to: 'mecanico@convite.test' });
      expect(mail.subject).toContain(`Oficina ${shop.slug}`);
      expect(mail.text).toContain('Olá, Jorge!');
      expect(mail.html).toContain('Criar minha senha');
      const token = linkIn(mail);
      expect(mail.text).toContain(`https://app.pitstop.test/definir-senha/${token}`);

      // só o hash vai ao banco
      const rows = await h.db.admin((db) => db.many<{ token_hash: string }>('select token_hash from public.account_links'));
      expect(rows.every((row) => row.token_hash !== token && row.token_hash.length === 64)).toBe(true);

      await h.api('get', '/auth/links/nao-e-uuid').expect(400);
      await h.api('get', '/auth/links/00000000-0000-4000-8000-000000000000').expect(410);
      expect((await h.api('get', `/auth/links/${token}`).expect(200)).body).toEqual({ email: 'mecanico@convite.test', purpose: 'invite' });
      await h.api('post', `/auth/links/${token}`).send({ password: 'curta' }).expect(400);
      expect((await h.api('post', `/auth/links/${token}`).send({ password: 'senha-do-jorge-1' }).expect(200)).body).toEqual({ email: 'mecanico@convite.test' });
      // uso único
      await h.api('post', `/auth/links/${token}`).send({ password: 'outra-senha-123' }).expect(410);
      await login('mecanico@convite.test', 'senha-do-jorge-1').expect(200);
    });

    it('reenviar o convite aposenta o link anterior; link vencido não vale', async () => {
      await h.api('post', `/users/${memberId}/invite`, shop.ownerToken).expect(204);
      const first = linkIn(lastMail());
      await h.api('post', `/users/${memberId}/invite`, shop.ownerToken).expect(204);
      const second = linkIn(lastMail());
      await h.api('get', `/auth/links/${first}`).expect(410);
      await h.api('get', `/auth/links/${second}`).expect(200);
      await h.db.admin((db) => db.exec(`update public.account_links set expires_at = now() - interval '1 minute' where used_at is null`));
      await h.api('get', `/auth/links/${second}`).expect(410);
      await h.api('post', `/users/00000000-0000-4000-8000-000000000000/invite`, shop.ownerToken).expect(404);
    });

    it('se o e-mail falha, o cadastro avisa e o convite pode ser reenviado', async () => {
      sendMail.mockRejectedValueOnce(Object.assign(new Error('fora'), { code: 'ECONNECTION' }));
      await h.api('post', '/users', shop.ownerToken).send({ email: 'falhou@convite.test', full_name: 'Falhou Envio', role: 'receptionist' }).expect(502);
      const users = await h.api('get', '/users', shop.ownerToken).expect(200);
      const pending = users.body.find((user: Json) => user.email === 'falhou@convite.test');
      expect(pending).toBeDefined();
      await h.api('post', `/users/${pending.id}/invite`, shop.ownerToken).expect(204);
      expect(lastMail().to).toBe('falhou@convite.test');
    });

    it('oficina criada sem senha convida o proprietário; se o e-mail falha, nada fica pela metade', async () => {
      const body = { name: 'Oficina Convidada', slug: 'oficina-convidada', plan: 'basic', owner_email: 'dona@convidada.test', owner_name: 'Ana Dona' };
      sendMail.mockRejectedValueOnce(Object.assign(new Error('fora'), { code: 'ECONNECTION' }));
      await h.api('post', '/admin/tenants', h.adminToken).send(body).expect(502);
      expect(await h.db.admin((db) => db.many(`select 1 from public.tenants where slug = 'oficina-convidada'`))).toEqual([]);

      const created = await h.api('post', '/admin/tenants', h.adminToken).send(body).expect(201);
      expect(created.body.owner_invited).toBe(true);
      expect(lastMail().subject).toContain('Oficina Convidada');
      await h
        .api('post', `/auth/links/${linkIn(lastMail())}`)
        .send({ password: 'senha-da-ana-123' })
        .expect(200);
      const session = await login('dona@convidada.test', 'senha-da-ana-123').expect(200);
      const me = await h.api('get', '/auth/me', session.body.access_token).expect(200);
      expect(me.body).toMatchObject({ membership: { role: 'owner' }, tenant: { slug: 'oficina-convidada' } });
    });

    it('"esqueci minha senha" responde igual para qualquer e-mail e só envia para contas reais', async () => {
      sendMail.mockClear();
      await h.api('post', '/auth/password-reset').send({ email: 'ninguem@lugar.test' }).expect(204);
      expect(sendMail).not.toHaveBeenCalled();
      await h.api('post', '/auth/password-reset').send({ email: 'sem-arroba' }).expect(400);

      await h
        .api('post', '/auth/password-reset')
        .send({ email: ` ${shop.ownerEmail.toUpperCase()} ` })
        .expect(400);
      await h.api('post', '/auth/password-reset').send({ email: shop.ownerEmail.toUpperCase() }).expect(204);
      const mail = lastMail();
      expect(mail).toMatchObject({ to: shop.ownerEmail, subject: 'Redefinição de senha do PitStop' });
      const token = linkIn(mail);
      expect((await h.api('get', `/auth/links/${token}`).expect(200)).body.purpose).toBe('reset');
      await h.api('post', `/auth/links/${token}`).send({ password: 'senha-nova-do-dono' }).expect(200);
      await login(shop.ownerEmail, 'senha-nova-do-dono').expect(200);

      // super admin também recupera a senha; falha de envio não muda a resposta
      await h.api('post', '/auth/password-reset').send({ email: h.adminEmail }).expect(204);
      expect(lastMail().to).toBe(h.adminEmail);
      sendMail.mockRejectedValueOnce(new Error('fora'));
      await h.api('post', '/auth/password-reset').send({ email: shop.ownerEmail }).expect(204);
    });

    it('remover a configuração volta a exigir senha no cadastro', async () => {
      // senha de app ilegível (por exemplo, APP_JWT_SECRET trocado) conta como não configurado
      await h.db.admin((db) => db.exec(`update public.platform_settings set value = jsonb_set(value, '{secret}', '"x.y.z"') where key = 'smtp'`));
      expect((await h.api('get', '/admin/email-settings', h.adminToken).expect(200)).body).toMatchObject({
        configured: false,
        user: 'pitstop.envio@gmail.com'
      });
      const cleared = await h.api('delete', '/admin/email-settings', h.adminToken).expect(200);
      expect(cleared.body.configured).toBe(false);
      await h.api('post', '/users', shop.ownerToken).send({ email: 'x@semmail.test', full_name: 'Sem Mail', role: 'mechanic' }).expect(400);
    });
  });

  describe('validade da oficina', () => {
    it('"expira em" vale até o fim daquele dia no fuso da plataforma', async () => {
      const updated = await h.api('patch', `/admin/tenants/${shop.id}`, h.adminToken).send({ expires_at: '2031-11-13' }).expect(200);
      // 23:59:59 de 13/11 em Brasília = 02:59:59Z do dia 14
      expect(updated.body.expires_at).toBe('2031-11-14T02:59:59.000Z');
      const exact = await h.api('patch', `/admin/tenants/${shop.id}`, h.adminToken).send({ expires_at: '2031-11-13T12:00:00.000Z' }).expect(200);
      expect(exact.body.expires_at).toBe('2031-11-13T12:00:00.000Z');
      const none = await h.api('patch', `/admin/tenants/${shop.id}`, h.adminToken).send({ expires_at: null }).expect(200);
      expect(none.body.expires_at).toBeNull();

      const created = await h
        .api('post', '/admin/tenants', h.adminToken)
        .send({
          name: 'Trial',
          slug: 'oficina-trial',
          plan: 'basic',
          is_trial: true,
          expires_at: '2031-01-31',
          owner_email: 'dono@trial.test',
          owner_name: 'Dono',
          owner_password: 'senha-forte-123'
        })
        .expect(201);
      expect(created.body.expires_at).toBe('2031-02-01T02:59:59.000Z');
    });
  });

  describe('tabela FIPE', () => {
    const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

    it('lista marcas, modelos e anos com cache; valida os parâmetros', async () => {
      fetchMock.mockResolvedValueOnce(
        json([
          { code: 22, name: 'Ford' },
          { code: '59', name: 'VW - VolksWagen' },
          { code: null, name: 'lixo' }
        ])
      );
      const brands = await h.api('get', '/fipe/cars/brands', shop.ownerToken).expect(200);
      expect(brands.body).toEqual([
        { code: '22', name: 'Ford' },
        { code: '59', name: 'VW - VolksWagen' }
      ]);
      expect(fetchMock.mock.calls[0][0]).toBe('https://fipe.parallelum.com.br/api/v2/cars/brands');
      // segunda consulta vem do cache, sem chamar a API
      await h.api('get', '/fipe/cars/brands', shop.ownerToken).expect(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(json([{ code: '1234', name: 'Ka 1.0' }]));
      expect((await h.api('get', '/fipe/cars/brands/22/models', shop.ownerToken).expect(200)).body).toEqual([{ code: '1234', name: 'Ka 1.0' }]);
      fetchMock.mockResolvedValueOnce(json([{ code: '2019-1', name: '2019 Gasolina' }]));
      expect((await h.api('get', '/fipe/cars/brands/22/models/1234/years', shop.ownerToken).expect(200)).body).toEqual([
        { code: '2019-1', name: '2019 Gasolina' }
      ]);

      await h.api('get', '/fipe/avioes/brands', shop.ownerToken).expect(400);
      await h.api('get', '/fipe/cars/brands/22%3Bdrop/models', shop.ownerToken).expect(400);
      await h.api('get', '/fipe/cars/brands').expect(401);
    });

    it('devolve o preço de referência normalizado', async () => {
      fetchMock.mockResolvedValueOnce(
        json({
          price: 'R$ 16.421,00',
          brand: 'Ford',
          model: 'Ka 1.0',
          modelYear: 2019,
          fuel: 'Gasolina',
          codeFipe: '003325-1',
          referenceMonth: 'novembro de 2026'
        })
      );
      const price = await h.api('get', '/fipe/cars/brands/22/models/1234/years/2019-1', shop.ownerToken).expect(200);
      expect(price.body).toEqual({
        brand: 'Ford',
        model: 'Ka 1.0',
        year: 2019,
        fuel: 'Gasolina',
        fipe_code: '003325-1',
        price: 16421,
        reference_month: 'novembro de 2026'
      });

      fetchMock.mockResolvedValueOnce(json({ price: 'sob consulta', brand: ' ', modelYear: 32000 }));
      const zero = await h.api('get', '/fipe/motorcycles/brands/1/models/2/years/32000-1', shop.ownerToken).expect(200);
      expect(zero.body).toMatchObject({ brand: null, year: 32000 > 2200 ? null : 32000, price: null });
    });

    it('API fora do ar: usa o cache vencido se houver; senão, 503 amigável', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));
      const down = await h.api('get', '/fipe/trucks/brands', shop.ownerToken).expect(503);
      expect(down.body.message).toContain('Preencha os dados manualmente');
      fetchMock.mockResolvedValue(json({ error: 'limite' }, false, 429));
      await h.api('get', '/fipe/trucks/brands', shop.ownerToken).expect(503);
      fetchMock.mockResolvedValue(json({ error: 'formato inesperado' }));
      await h.api('get', '/fipe/trucks/brands', shop.ownerToken).expect(503);

      await h.db.admin((db) => db.exec(`update public.fipe_cache set fetched_at = now() - interval '90 days' where plate = 'fipe:cars/brands'`));
      fetchMock.mockRejectedValue(new Error('timeout'));
      expect((await h.api('get', '/fipe/cars/brands', shop.ownerToken).expect(200)).body).toHaveLength(2);
    });
  });
});
