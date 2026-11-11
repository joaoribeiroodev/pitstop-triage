import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { AdminMetrics, AdminTenantRow, AuditLogEntry, Paginated, Tenant, TenantUser } from '@pitstop/shared-types';
import { AUTH_PROVIDER, AuthProvider } from '../auth/providers/auth-provider';
import { TokenService } from '../auth/token.service';
import type { SuperAdminContext } from '../common/context';
import { Admin, SuperAdminOnly } from '../common/decorators';
import { offsetOf, paginated } from '../common/pagination';
import { blankToNull, buildUpdate, onlyDigits } from '../common/rls';
import { DatabaseService, Db } from '../database/database.service';
import { TriageModule, TriageService } from '../triage/triage.module';
import { AuditQuery, ConfirmSlugDto, CreateTenantDto, ImpersonateDto, TenantListQuery, UpdateTenantDto } from './admin.dto';

const IMPERSONATION_TTL_SECONDS = 15 * 60;

const TENANT_ROW_SQL = `
  select t.*,
         (select count(*)::int from public.tenant_users tu where tu.tenant_id = t.id and tu.is_active) as users_count,
         (select count(*)::int from public.service_orders o
           where o.tenant_id = t.id and o.opened_at >= date_trunc('month', now())) as orders_this_month,
         (t.status = 'active' and t.expires_at is not null and t.expires_at < now() + interval '7 days') as expiring_soon
    from public.tenants t`;

/**
 * Painel central. Tudo aqui roda em transação privilegiada (não há tenant na sessão),
 * e toda ação que altera um tenant deixa registro em tenant_audit_log na mesma transação.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
    private readonly triage: TriageService,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    @Inject(ENV) private readonly env: Env
  ) {}

  private async audit(db: Db, admin: SuperAdminContext, tenant: Pick<Tenant, 'id' | 'slug'> | null, action: string, payload: unknown): Promise<void> {
    await db.exec(
      `insert into public.tenant_audit_log (tenant_id, tenant_slug, super_admin_email, action, payload)
       values ($1, $2, $3, $4, $5)`,
      [tenant?.id ?? null, tenant?.slug ?? null, admin.email, action, JSON.stringify(payload ?? {})]
    );
  }

  private async find(db: Db, id: string, lock = false): Promise<Tenant> {
    const tenant = await db.maybeOne<Tenant>(`select * from public.tenants where id = $1 ${lock ? 'for update' : ''}`, [id]);
    if (!tenant) throw new NotFoundException('Oficina não encontrada.');
    return tenant;
  }

  list(query: TenantListQuery): Promise<Paginated<AdminTenantRow>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.status) where.push(`t.status = $${params.push(query.status)}`);
    if (query.q?.trim()) {
      const n = params.push(`%${query.q.trim()}%`);
      where.push(`(t.name ilike $${n} or t.slug ilike $${n} or t.document ilike $${n})`);
    }
    const clause = where.length ? `where ${where.join(' and ')}` : '';
    return this.db.admin(async (db) => {
      const { total } = await db.one<{ total: number }>(`select count(*)::int as total from public.tenants t ${clause}`, params);
      const rows = await db.many<AdminTenantRow>(
        `${TENANT_ROW_SQL} ${clause} order by t.created_at desc limit ${query.pageSize} offset ${offsetOf(query)}`,
        params
      );
      return paginated(rows, total, query);
    });
  }

  get(id: string): Promise<AdminTenantRow & { users: TenantUser[] }> {
    return this.db.admin(async (db) => {
      const tenant = await db.maybeOne<AdminTenantRow>(`${TENANT_ROW_SQL} where t.id = $1`, [id]);
      if (!tenant) throw new NotFoundException('Oficina não encontrada.');
      const users = await db.many<TenantUser>(
        `select id, tenant_id, user_id, role, full_name, email, is_active, created_at
           from public.tenant_users where tenant_id = $1 order by role, full_name`,
        [id]
      );
      return { ...tenant, users };
    });
  }

  async create(admin: SuperAdminContext, dto: CreateTenantDto): Promise<Tenant & { owner_invited: boolean }> {
    const ownerEmail = dto.owner_email.trim().toLowerCase();
    await this.db.admin(async (db) => {
      if (await db.maybeOne('select 1 from public.tenants where slug = $1', [dto.slug])) {
        throw new ConflictException('Já existe uma oficina com este slug.');
      }
      if (await db.maybeOne('select 1 from public.tenant_users where lower(email) = $1', [ownerEmail])) {
        throw new ConflictException('O e-mail do proprietário já está vinculado a outra oficina.');
      }
    });

    // 1) tenant + auditoria; 2) usuário no provedor de identidade já com as claims; 3) vínculo de owner.
    const tenant = await this.db.admin(async (db) => {
      const created = await db.one<Tenant>(
        `insert into public.tenants (name, slug, document, contact_name, contact_email, contact_phone, plan, is_trial, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [
          dto.name.trim(),
          dto.slug,
          onlyDigits(dto.document),
          blankToNull(dto.contact_name),
          blankToNull(dto.contact_email)?.toLowerCase() ?? null,
          onlyDigits(dto.contact_phone),
          dto.plan,
          dto.is_trial ?? false,
          dto.expires_at ?? null
        ]
      );
      await this.audit(db, admin, created, 'tenant.created', { plan: dto.plan, expires_at: dto.expires_at ?? null, owner_email: ownerEmail });
      return created;
    });

    try {
      const owner = await this.auth.createUser({
        email: ownerEmail,
        password: dto.owner_password,
        appMetadata: { tenant_id: tenant.id, role: 'owner' }
      });
      await this.db.admin((db) =>
        db.exec(`insert into public.tenant_users (tenant_id, user_id, role, full_name, email) values ($1, $2, 'owner', $3, $4)`, [
          tenant.id,
          owner.id,
          dto.owner_name.trim(),
          ownerEmail
        ])
      );
      return { ...tenant, owner_invited: owner.invited };
    } catch (error) {
      // Sem proprietário a oficina é inutilizável: desfaz a criação para o admin poder tentar de novo com o mesmo slug.
      await this.db.admin(async (db) => {
        await db.exec('delete from public.tenants where id = $1', [tenant.id]);
        await this.audit(db, admin, null, 'tenant.creation_rolled_back', { slug: tenant.slug, reason: (error as Error).message });
      });
      throw error;
    }
  }

  update(admin: SuperAdminContext, id: string, dto: UpdateTenantDto): Promise<Tenant> {
    return this.db.admin(async (db) => {
      const current = await this.find(db, id, true);
      const { sets, values } = buildUpdate(
        {
          name: dto.name?.trim(),
          document: dto.document === undefined ? undefined : onlyDigits(dto.document),
          contact_name: dto.contact_name === undefined ? undefined : blankToNull(dto.contact_name),
          contact_email: dto.contact_email === undefined ? undefined : (blankToNull(dto.contact_email)?.toLowerCase() ?? null),
          contact_phone: dto.contact_phone === undefined ? undefined : onlyDigits(dto.contact_phone),
          plan: dto.plan,
          is_trial: dto.is_trial,
          expires_at: dto.expires_at,
          // flags e limites são mesclados: o painel envia só o que mudou.
          feature_flags: dto.feature_flags ? JSON.stringify({ ...current.feature_flags, ...dto.feature_flags }) : undefined,
          limits: dto.limits ? JSON.stringify({ ...current.limits, ...dto.limits }) : undefined
        },
        2
      );
      if (!sets.length) return current;
      // Renovar a validade de uma oficina vencida a reativa.
      if (dto.expires_at !== undefined && current.status === 'expired') sets.push(`status = 'active'`);
      const updated = await db.one<Tenant>(`update public.tenants set ${sets.join(', ')} where id = $1 returning *`, [id, ...values]);
      await this.audit(db, admin, updated, 'tenant.updated', dto);
      return updated;
    });
  }

  suspend(admin: SuperAdminContext, id: string, dto: ConfirmSlugDto): Promise<Tenant> {
    return this.db.admin(async (db) => {
      const tenant = await this.find(db, id, true);
      if (dto.confirm_slug !== tenant.slug) throw new BadRequestException('O slug de confirmação não confere.');
      if (tenant.status === 'suspended') throw new ConflictException('Esta oficina já está suspensa.');
      const updated = await db.one<Tenant>(`update public.tenants set status = 'suspended', suspended_at = now() where id = $1 returning *`, [id]);
      await this.audit(db, admin, updated, 'tenant.suspended', { reason: dto.reason ?? null });
      return updated;
    });
  }

  reactivate(admin: SuperAdminContext, id: string): Promise<Tenant> {
    return this.db.admin(async (db) => {
      const tenant = await this.find(db, id, true);
      if (tenant.status === 'active') throw new ConflictException('Esta oficina já está ativa.');
      const updated = await db.one<Tenant>(`update public.tenants set status = 'active', suspended_at = null where id = $1 returning *`, [id]);
      await this.audit(db, admin, updated, 'tenant.reactivated', { previous_status: tenant.status });
      return updated;
    });
  }

  /** Acesso de suporte: JWT curto com papel de owner, sempre registrado em auditoria com o motivo. */
  async impersonate(
    admin: SuperAdminContext,
    id: string,
    dto: ImpersonateDto
  ): Promise<{ access_token: string; expires_in: number; tenant_slug: string; app_url: string }> {
    const tenant = await this.db.admin(async (db) => {
      const found = await this.find(db, id);
      await this.audit(db, admin, found, 'tenant.impersonated', { reason: dto.reason, ttl_seconds: IMPERSONATION_TTL_SECONDS });
      return found;
    });
    const accessToken = await this.tokens.signAppToken(
      {
        sub: admin.userId,
        email: admin.email,
        app_metadata: { tenant_id: tenant.id, role: 'owner' },
        impersonated_by: admin.email,
        typ: 'impersonation'
      },
      IMPERSONATION_TTL_SECONDS
    );
    // app_url: onde o painel deve abrir a sessão. É o mesmo endereço público do app da oficina usado nos links do portal.
    return { access_token: accessToken, expires_in: IMPERSONATION_TTL_SECONDS, tenant_slug: tenant.slug, app_url: this.env.portalBaseUrl };
  }

  auditLog(query: AuditQuery): Promise<Paginated<AuditLogEntry>> {
    const where = query.tenant_id ? 'where tenant_id = $1' : '';
    const params = query.tenant_id ? [query.tenant_id] : [];
    return this.db.admin(async (db) => {
      const { total } = await db.one<{ total: number }>(`select count(*)::int as total from public.tenant_audit_log ${where}`, params);
      const rows = await db.many<AuditLogEntry>(
        `select id, tenant_id, tenant_slug, super_admin_email, action, payload, created_at
           from public.tenant_audit_log ${where} order by created_at desc, id limit ${query.pageSize} offset ${offsetOf(query)}`,
        params
      );
      return paginated(rows, total, query);
    });
  }

  metrics(): Promise<AdminMetrics> {
    return this.db.admin(async (db) => {
      const totals = await db.one<Omit<AdminMetrics, 'growth'>>(
        `select
           (select count(*)::int from public.tenants where status = 'active' and (expires_at is null or expires_at > now())) as tenants_active,
           (select count(*)::int from public.tenants where status = 'active' and is_trial) as tenants_trial,
           (select count(*)::int from public.tenants where status = 'suspended') as tenants_suspended,
           (select count(*)::int from public.tenants
             where status = 'active' and expires_at between now() and now() + interval '7 days') as tenants_expiring_7d,
           (select count(*)::int from public.service_orders where opened_at >= date_trunc('month', now())) as orders_this_month,
           (select count(*)::int from public.tenant_users tu join public.tenants t on t.id = tu.tenant_id
             where tu.is_active and t.status = 'active') as active_users`
      );
      const growth = await db.many<AdminMetrics['growth'][number]>(
        `select to_char(m, 'YYYY-MM') as month,
                (select count(*)::int from public.tenants t where t.created_at < m + interval '1 month') as tenants,
                (select count(*)::int from public.service_orders o
                  where o.opened_at >= m and o.opened_at < m + interval '1 month') as orders
           from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m
          order by m`
      );
      return { ...totals, growth };
    });
  }

  async reloadCatalog(admin: SuperAdminContext): Promise<{ categories: number }> {
    this.triage.invalidateCatalog();
    await this.db.admin((db) => this.audit(db, admin, null, 'catalog.reloaded', {}));
    return { categories: (await this.triage.catalog()).length };
  }
}

@SuperAdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('tenants')
  list(@Query() query: TenantListQuery) {
    return this.admin.list(query);
  }

  @Post('tenants')
  create(@Admin() admin: SuperAdminContext, @Body() dto: CreateTenantDto) {
    return this.admin.create(admin, dto);
  }

  @Get('tenants/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.get(id);
  }

  @Patch('tenants/:id')
  update(@Admin() admin: SuperAdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.admin.update(admin, id, dto);
  }

  @HttpCode(200)
  @Post('tenants/:id/suspend')
  suspend(@Admin() admin: SuperAdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmSlugDto) {
    return this.admin.suspend(admin, id, dto);
  }

  @HttpCode(200)
  @Post('tenants/:id/reactivate')
  reactivate(@Admin() admin: SuperAdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reactivate(admin, id);
  }

  @HttpCode(200)
  @Post('tenants/:id/impersonate')
  impersonate(@Admin() admin: SuperAdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImpersonateDto) {
    return this.admin.impersonate(admin, id, dto);
  }

  @Get('audit')
  audit(@Query() query: AuditQuery) {
    return this.admin.auditLog(query);
  }

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @HttpCode(200)
  @Post('catalog/reload')
  reloadCatalog(@Admin() admin: SuperAdminContext) {
    return this.admin.reloadCatalog(admin);
  }
}

@Module({ imports: [TriageModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
