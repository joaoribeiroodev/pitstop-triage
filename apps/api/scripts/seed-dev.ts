/**
 * Dados de demonstração para desenvolvimento local (AUTH_PROVIDER=local).
 * Cria um super admin e uma oficina com proprietário, recepcionista e mecânico.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER, AuthProvider } from '../src/auth/providers/auth-provider';
import { ENV, Env } from '../src/config/env';
import { DatabaseService } from '../src/database/database.service';

const PASSWORD = process.env.SEED_PASSWORD ?? 'pitstop-dev-123';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const env = app.get<Env>(ENV);
  if (env.authProvider !== 'local') throw new Error('seed:dev só roda com AUTH_PROVIDER=local.');
  const db = app.get(DatabaseService);
  const auth = app.get<AuthProvider>(AUTH_PROVIDER);

  await auth.createUser({ email: 'admin@pitstop.local', password: PASSWORD, appMetadata: { is_super_admin: true } });
  await db.admin((d) => d.exec(`insert into public.super_admins (email) values ('admin@pitstop.local') on conflict do nothing`));

  const tenant = await db.admin((d) =>
    d.one<{ id: string }>(
      `insert into public.tenants (name, slug, plan, contact_phone, document)
       values ('Oficina Demo', 'oficina-demo', 'pro', '71999990000', '12345678000199')
       on conflict (slug) do update set name = excluded.name returning id`
    )
  );
  const team = [
    { email: 'dono@demo.local', name: 'Dona Carla (proprietária)', role: 'owner' },
    { email: 'recepcao@demo.local', name: 'Rafa (recepção)', role: 'receptionist' },
    { email: 'mecanico@demo.local', name: 'Seu Jorge (mecânico)', role: 'mechanic' }
  ];
  for (const member of team) {
    const user = await auth.createUser({ email: member.email, password: PASSWORD, appMetadata: { tenant_id: tenant.id, role: member.role } });
    await db.admin((d) =>
      d.exec(
        `insert into public.tenant_users (tenant_id, user_id, role, full_name, email) values ($1, $2, $3, $4, $5)
         on conflict (user_id) do nothing`,
        [tenant.id, user.id, member.role, member.name, member.email]
      )
    );
  }
  await db.admin(async (d) => {
    const customer = await d.maybeOne<{ id: string }>(`select id from public.customers where tenant_id = $1 limit 1`, [tenant.id]);
    if (customer) return;
    const created = await d.one<{ id: string }>(
      `insert into public.customers (tenant_id, name, phone, email) values ($1, 'Marina Souza', '71988887777', 'marina@exemplo.com') returning id`,
      [tenant.id]
    );
    await d.exec(
      `insert into public.vehicles (tenant_id, customer_id, plate, brand, model, year, color, fuel_type, current_mileage)
       values ($1, $2, 'PIT1A23', 'Ford', 'Ka', 2019, 'Prata', 'Flex', 68000)`,
      [tenant.id, created.id]
    );
    await d.exec(
      `insert into public.shop_parts_catalog (tenant_id, name, sku, default_price) values
         ($1, 'Jogo de pastilhas de freio dianteiras', 'PF-1001', 189.90), ($1, 'Disco de freio dianteiro', 'DF-2002', 249.00)`,
      [tenant.id]
    );
    await d.exec(
      `insert into public.shop_services_catalog (tenant_id, name, default_price, duration_minutes) values
         ($1, 'Troca de pastilhas dianteiras', 120.00, 60), ($1, 'Medir espessura das pastilhas', 0, 15)`,
      [tenant.id]
    );
  });

  console.log(`\nSeed concluído. Senha de todos os usuários: ${PASSWORD}`);
  console.log('  painel admin → admin@pitstop.local');
  console.log('  oficina      → dono@demo.local | recepcao@demo.local | mecanico@demo.local');
  console.log('  triagem pública → /triagem/oficina-demo\n');
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
