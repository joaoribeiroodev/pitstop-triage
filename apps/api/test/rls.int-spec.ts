/**
 * Bateria obrigatória de isolamento. Roda SQL cru no papel `authenticated` com as claims de um tenant —
 * exatamente o que aconteceria com um bug na aplicação ou um acesso direto ao banco com um JWT válido.
 */
import type { Db } from '../src/database/database.service';
import { Harness, TestTenant } from './harness';

/** Insere ao menos uma linha em TODA tabela de negócio para o tenant informado. */
async function seedGraph(db: Db, tenantId: string, plate: string): Promise<void> {
  const customer = await db.one<{ id: string }>(`insert into public.customers (tenant_id, name, phone) values ($1, 'Fulano', '71999990000') returning id`, [
    tenantId
  ]);
  const vehicle = await db.one<{ id: string }>(`insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, $3) returning id`, [
    tenantId,
    customer.id,
    plate
  ]);
  const triage = await db.one<{ id: string }>(`insert into public.triage_sessions (tenant_id, customer_id, vehicle_id) values ($1, $2, $3) returning id`, [
    tenantId,
    customer.id,
    vehicle.id
  ]);
  const order = await db.one<{ id: string }>(
    `insert into public.service_orders (tenant_id, order_number, customer_id, vehicle_id, triage_session_id, mechanic_diagnosis)
     values ($1, 1, $2, $3, $4, 'diagnóstico interno') returning id`,
    [tenantId, customer.id, vehicle.id, triage.id]
  );
  await db.exec(
    `insert into public.service_order_items (tenant_id, service_order_id, type, description, unit_price) values ($1, $2, 'service', 'Serviço', 100)`,
    [tenantId, order.id]
  );
  await db.exec(`insert into public.service_order_status_history (tenant_id, service_order_id, to_status) values ($1, $2, 'draft')`, [tenantId, order.id]);
  await db.exec(`insert into public.service_order_notes (tenant_id, service_order_id, body) values ($1, $2, 'nota interna')`, [tenantId, order.id]);
  const quote = await db.one<{ id: string }>(`insert into public.quotes (tenant_id, service_order_id) values ($1, $2) returning id`, [tenantId, order.id]);
  await db.exec(`insert into public.quote_items (tenant_id, quote_id, type, description, unit_price) values ($1, $2, 'part', 'Peça', 50)`, [
    tenantId,
    quote.id
  ]);
  const token = await db.one<{ id: string }>(
    `insert into public.customer_access_tokens (tenant_id, token_hash, service_order_id, quote_id, purposes, expires_at)
     values ($1, $2, $3, $4, '{view_order}', now() + interval '1 day') returning id`,
    [tenantId, `hash-${tenantId}`, order.id, quote.id]
  );
  await db.exec(`insert into public.customer_consent_log (tenant_id, access_token_id, service_order_id, policy_version) values ($1, $2, $3, 'v1')`, [
    tenantId,
    token.id,
    order.id
  ]);
  await db.exec(`insert into public.shop_symptom_stats (tenant_id, symptom_code, cause_description, occurrences) values ($1, 'brake_grinding', 'Causa', 3)`, [
    tenantId
  ]);
  await db.exec(`insert into public.shop_services_catalog (tenant_id, name, default_price) values ($1, 'Alinhamento', 90)`, [tenantId]);
  await db.exec(`insert into public.shop_parts_catalog (tenant_id, name, default_price) values ($1, 'Filtro', 30)`, [tenantId]);
  const item = await db.one<{ id: string }>(`insert into public.inventory_items (tenant_id, name) values ($1, 'Óleo') returning id`, [tenantId]);
  await db.exec(`insert into public.stock_movements (tenant_id, inventory_item_id, type, quantity) values ($1, $2, 'in', 5)`, [tenantId, item.id]);
  await db.exec(`insert into public.financial_entries (tenant_id, type, description, amount) values ($1, 'receivable', 'OS 1', 100)`, [tenantId]);
  await db.exec(
    `insert into public.appointments (tenant_id, title, starts_at, ends_at, customer_id) values ($1, 'Revisão', now(), now() + interval '1 hour', $2)`,
    [tenantId, customer.id]
  );
  await db.exec(
    `insert into public.notification_log (tenant_id, service_order_id, event, channel, status) values ($1, $2, 'status_update', 'whatsapp_link', 'sent')`,
    [tenantId, order.id]
  );
}

describe('RLS — isolamento entre tenants no banco', () => {
  let h: Harness;
  let a: TestTenant;
  let b: TestTenant;
  let tenantTables: string[];
  const asTenant = <T>(tenant: TestTenant, work: (db: Db) => Promise<T>) =>
    h.db.tenant({ tenantId: tenant.id, userId: '00000000-0000-4000-8000-000000000001', role: 'owner' }, work);

  beforeAll(async () => {
    h = await Harness.start();
    a = await h.createTenant();
    b = await h.createTenant();
    await h.db.admin(async (db) => {
      await seedGraph(db, a.id, 'AAA1A11');
      await seedGraph(db, b.id, 'BBB2B22');
      tenantTables = (
        await db.many<{ table_name: string }>(
          `select table_name from information_schema.columns
            where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenant_audit_log'
            order by table_name`
        )
      ).map((row) => row.table_name);
    });
  });
  afterAll(() => h.stop());

  it('toda tabela com tenant_id tem RLS ligado e as quatro políticas', async () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(20);
    const rows = await h.db.admin((db) =>
      db.many<{ name: string; rls: boolean; commands: string[] }>(
        `select c.relname as name, c.relrowsecurity as rls,
                coalesce((select array_agg(distinct p.cmd order by p.cmd) from pg_policies p
                           where p.schemaname = 'public' and p.tablename = c.relname), '{}')::text[] as commands
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = any($1)`,
        [tenantTables]
      )
    );
    expect(rows).toHaveLength(tenantTables.length);
    for (const row of rows) {
      expect([row.name, row.rls]).toEqual([row.name, true]);
      expect([row.name, row.commands]).toEqual([row.name, ['DELETE', 'INSERT', 'SELECT', 'UPDATE']]);
    }
  });

  it('nenhuma tabela pública fica sem RLS', async () => {
    const open = await h.db.admin((db) =>
      db.many(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
      )
    );
    expect(open).toEqual([]);
  });

  it('SELECT: o tenant A enxerga as próprias linhas e zero linhas do tenant B', async () => {
    for (const table of tenantTables) {
      const counts = await asTenant(a, (db) =>
        db.one<{ own: number; foreign_rows: number }>(
          `select count(*) filter (where tenant_id = $1)::int as own,
                  count(*) filter (where tenant_id <> $1)::int as foreign_rows
             from public.${table}`,
          [a.id]
        )
      );
      expect([table, counts.foreign_rows]).toEqual([table, 0]);
      expect([table, counts.own > 0]).toEqual([table, true]);
      const direct = await asTenant(a, (db) => db.many(`select 1 from public.${table} where tenant_id = $1`, [b.id]));
      expect([table, direct.length]).toEqual([table, 0]);
    }
  });

  it('UPDATE e DELETE: zero linhas do tenant B são afetadas', async () => {
    for (const table of tenantTables) {
      const before = await h.db.admin((db) => db.one<{ n: number }>(`select count(*)::int as n from public.${table} where tenant_id = $1`, [b.id]));
      const updated = await asTenant(a, (db) => db.exec(`update public.${table} set created_at = created_at where tenant_id = $1`, [b.id]));
      const deleted = await asTenant(a, (db) => db.exec(`delete from public.${table} where tenant_id = $1`, [b.id]));
      const after = await h.db.admin((db) => db.one<{ n: number }>(`select count(*)::int as n from public.${table} where tenant_id = $1`, [b.id]));
      expect([table, updated, deleted, after.n]).toEqual([table, 0, 0, before.n]);
    }
  });

  it('INSERT: o tenant A não consegue gravar linhas em nome do tenant B', async () => {
    await expect(asTenant(a, (db) => db.exec(`insert into public.customers (tenant_id, name) values ($1, 'Intruso')`, [b.id]))).rejects.toMatchObject({
      code: '42501'
    });
    await expect(asTenant(a, (db) => db.exec(`insert into public.shop_parts_catalog (tenant_id, name) values ($1, 'Peça')`, [b.id]))).rejects.toMatchObject({
      code: '42501'
    });
    // nem "mudar o dono" de uma linha própria para o outro tenant
    await expect(asTenant(a, (db) => db.exec(`update public.customers set tenant_id = $1`, [b.id]))).rejects.toMatchObject({ code: '42501' });
  });

  it('FK composta: não dá para pendurar um veículo próprio em um cliente de outro tenant', async () => {
    const foreignCustomer = await h.db.admin((db) => db.one<{ id: string }>('select id from public.customers where tenant_id = $1 limit 1', [b.id]));
    await expect(
      asTenant(a, (db) => db.exec(`insert into public.vehicles (tenant_id, customer_id, plate) values ($1, $2, 'XYZ9Z99')`, [a.id, foreignCustomer.id]))
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('tenants: o usuário lê apenas o próprio tenant e não consegue alterá-lo', async () => {
    const visible = await asTenant(a, (db) => db.many<{ id: string }>('select id from public.tenants'));
    expect(visible.map((row) => row.id)).toEqual([a.id]);
    await expect(asTenant(a, (db) => db.exec(`update public.tenants set plan = 'enterprise'`))).rejects.toMatchObject({ code: '42501' });
  });

  it('tenant_users: quem não é owner não consegue se promover direto no banco', async () => {
    const asMechanic = <T>(work: (db: Db) => Promise<T>) =>
      h.db.tenant({ tenantId: a.id, userId: '00000000-0000-4000-8000-000000000002', role: 'mechanic' }, work);
    expect(await asMechanic((db) => db.exec(`update public.tenant_users set role = 'owner'`))).toBe(0);
    expect(await asMechanic((db) => db.exec(`delete from public.tenant_users`))).toBe(0);
  });

  it('tabelas administrativas são inacessíveis a qualquer usuário de tenant', async () => {
    for (const table of ['super_admins', 'tenant_audit_log', 'fipe_cache']) {
      await expect(asTenant(a, (db) => db.many(`select * from public.${table}`))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('catálogo global: leitura liberada, escrita bloqueada', async () => {
    const symptoms = await asTenant(a, (db) => db.one<{ n: number }>('select count(*)::int as n from public.symptoms'));
    expect(symptoms.n).toBeGreaterThanOrEqual(30);
    await expect(asTenant(a, (db) => db.exec(`update public.symptoms set name = 'adulterado'`))).rejects.toMatchObject({ code: '42501' });
  });

  it('JWT sem tenant_id não enxerga nada; papel anon não tem acesso algum', async () => {
    const orphan = await h.db.admin(async (db) => {
      await db.exec(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","app_metadata":{}}', true)`);
      await db.exec('set local role authenticated');
      return db.many('select 1 from public.customers');
    });
    expect(orphan).toEqual([]);
    await expect(
      h.db.admin(async (db) => {
        await db.exec('set local role anon');
        return db.many('select 1 from public.customers');
      })
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('mesmo sem filtro de tenant na query, a API só devolve dados do próprio tenant', async () => {
    const list = await h.api('get', '/customers', a.ownerToken).expect(200);
    expect(list.body.total).toBe(1);
    const foreign = await h.db.admin((db) => db.one<{ id: string }>('select id from public.customers where tenant_id = $1 limit 1', [b.id]));
    await h.api('get', `/customers/${foreign.id}`, a.ownerToken).expect(404);
    await h.api('patch', `/customers/${foreign.id}`, a.ownerToken).send({ name: 'Sequestrado' }).expect(404);
    await h.api('delete', `/customers/${foreign.id}`, a.ownerToken).expect(404);
  });

  it('tenant_audit_log é append-only até para o backend', async () => {
    await expect(h.db.admin((db) => db.exec('update public.tenant_audit_log set action = $1', ['adulterado']))).rejects.toThrow(/append-only/);
    await expect(h.db.admin((db) => db.exec('delete from public.tenant_audit_log'))).rejects.toThrow(/append-only/);
  });
});
