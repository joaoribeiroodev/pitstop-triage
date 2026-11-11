import { Client } from 'pg';
import { migrate } from '../scripts/migrate';
import './env';

/** Recria o banco de testes do zero e aplica as migrations reais antes da suíte de integração. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL as string);
  const database = url.pathname.slice(1);
  if (!/test/.test(database)) throw new Error(`Banco "${database}" não parece ser de teste; abortando.`);
  const maintenance = new URL(url.toString());
  maintenance.pathname = '/postgres';
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  await client.query(`drop database if exists ${database} with (force)`);
  await client.query(`create database ${database}`);
  await client.end();
  await migrate(url.toString(), { quiet: true });
}
