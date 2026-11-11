import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { ENV, Env } from '../config/env';

// numeric e bigint chegam como string no driver; o domínio trabalha com number.
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(20, (value) => Number(value));

export interface Db {
  many<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  maybeOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

export interface RlsIdentity {
  tenantId: string;
  userId: string;
  role: string;
}

function wrap(client: PoolClient): Db {
  return {
    async many<T>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
    async maybeOne<T>(sql: string, params: unknown[] = []) {
      return ((await client.query(sql, params)).rows[0] as T | undefined) ?? null;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const row = (await client.query(sql, params)).rows[0] as T | undefined;
      if (!row) throw new Error('Consulta deveria retornar uma linha e não retornou nenhuma');
      return row;
    },
    async exec(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rowCount ?? 0;
    }
  };
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10
    });
  }

  /**
   * Transação no papel `authenticated`, com as claims do tenant na sessão.
   * Toda consulta feita aqui passa pelas políticas de RLS: mesmo que um service
   * esqueça um filtro de tenant, o banco não devolve linhas de outra oficina.
   */
  async tenant<T>(identity: RlsIdentity, work: (db: Db) => Promise<T>): Promise<T> {
    const claims = JSON.stringify({
      sub: identity.userId,
      role: 'authenticated',
      app_metadata: { tenant_id: identity.tenantId, role: identity.role }
    });
    return this.transaction(async (client) => {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query('set local role authenticated');
      return work(wrap(client));
    });
  }

  /**
   * Transação privilegiada (equivalente ao service_role: ignora RLS).
   * Usada só onde não existe usuário de tenant: guards, portal por token, painel admin, jobs.
   */
  async admin<T>(work: (db: Db) => Promise<T>): Promise<T> {
    return this.transaction((client) => work(wrap(client)));
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
