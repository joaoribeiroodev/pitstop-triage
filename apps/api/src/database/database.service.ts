import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { ENV, Env } from '../config/env';

// numeric e bigint chegam como string no driver; o domínio trabalha com number.
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(20, (value) => Number(value));
// `date` é uma data de calendário (vencimento), não um instante: fica como 'YYYY-MM-DD', sem virar Date e deslizar de dia pelo fuso.
types.setTypeParser(1082, (value) => value);

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
  /** Fuso da oficina (IANA). Ausente: vale o padrão do ambiente. */
  timezone?: string;
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
  private readonly defaultTimezone: string;

  constructor(@Inject(ENV) env: Env) {
    this.defaultTimezone = env.appTimezone;
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
    return this.transaction(identity.timezone ?? this.defaultTimezone, async (client) => {
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
    return this.transaction(this.defaultTimezone, (client) => work(wrap(client)));
  }

  /**
   * Horários: as colunas são timestamptz (instantes em UTC) e a API devolve ISO 8601 em UTC.
   * O fuso só vale dentro da transação, para o banco saber onde começam "hoje", a semana e o mês
   * (current_date, date_trunc, ::date) do ponto de vista da oficina, e não do servidor.
   */
  private async transaction<T>(timezone: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('timezone', $1, true)`, [timezone]);
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
