/**
 * Aplica as migrations em um Postgres local/CI (docker-compose, testes).
 * Em um projeto Supabase real, use a CLI: `supabase db push` — ela lê a mesma pasta supabase/migrations.
 *
 *   tsx scripts/migrate.ts            aplica o que falta
 *   tsx scripts/migrate.ts --reset    recria tudo do zero (somente em host local)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

const ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');
const SHIM = join(ROOT, 'supabase/local/00_supabase_shim.sql');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

export async function migrate(databaseUrl: string, options: { reset?: boolean; quiet?: boolean } = {}): Promise<void> {
  const log = (message: string) => options.quiet || console.log(message);
  const host = new URL(databaseUrl).hostname;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (options.reset) {
      if (!LOCAL_HOSTS.has(host)) throw new Error(`--reset recusado: "${host}" não é um host local.`);
      await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists _pitstop cascade; create schema public;');
      log('banco zerado');
    }
    const { rows } = await client.query(`select to_regnamespace('auth') is not null as has_auth`);
    if (!rows[0].has_auth) {
      if (!LOCAL_HOSTS.has(host)) throw new Error('Schema "auth" ausente em host remoto: aplique as migrations pela CLI do Supabase.');
      await client.query(readFileSync(SHIM, 'utf8'));
      log('shim local do Supabase aplicado');
    }
    await client.query('create schema if not exists _pitstop; create table if not exists _pitstop.migrations (name text primary key, applied_at timestamptz not null default now())');
    const applied = new Set((await client.query('select name from _pitstop.migrations')).rows.map((row) => row.name));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('insert into _pitstop.migrations (name) values ($1)', [file]);
        await client.query('commit');
        log(`aplicada: ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Falha em ${file}: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL.');
    process.exit(1);
  }
  migrate(url, { reset: process.argv.includes('--reset') }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
