import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TENANT_ROLES, TenantRole, TenantUser } from '@pitstop/shared-types';
import { AccountLinksService, temporaryPassword } from '../auth/account-links.service';
import { AUTH_PROVIDER, AuthProvider } from '../auth/providers/auth-provider';
import type { TenantContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { buildUpdate, rls } from '../common/rls';
import { DatabaseService } from '../database/database.service';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name: string;

  @IsIn(TENANT_ROLES)
  role: TenantRole;

  /** Opcional: sem senha, o usuário recebe convite por e-mail. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name?: string;

  @IsOptional()
  @IsIn(TENANT_ROLES)
  role?: TenantRole;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

const COLUMNS = 'id, tenant_id, user_id, role, full_name, email, is_active, created_at';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly links: AccountLinksService
  ) {}

  list(ctx: TenantContext): Promise<TenantUser[]> {
    return this.db.tenant(rls(ctx), (db) => db.many<TenantUser>(`select ${COLUMNS} from public.tenant_users order by is_active desc, full_name`));
  }

  /** Lista enxuta para atribuição de OS — visível a todos os papéis. */
  assignable(ctx: TenantContext): Promise<Array<Pick<TenantUser, 'id' | 'full_name' | 'role'>>> {
    return this.db.tenant(rls(ctx), (db) => db.many(`select id, full_name, role from public.tenant_users where is_active order by full_name`));
  }

  async create(ctx: TenantContext, dto: CreateUserDto): Promise<TenantUser & { invited: boolean }> {
    const email = dto.email.trim().toLowerCase();
    await this.db.tenant(rls(ctx), async (db) => {
      const { count } = await db.one<{ count: number }>('select count(*)::int as count from public.tenant_users where is_active');
      if (count >= ctx.tenant.limits.max_users) {
        throw new ForbiddenException({
          message: `O plano da oficina permite até ${ctx.tenant.limits.max_users} usuários ativos.`,
          code: 'LIMIT_REACHED'
        });
      }
    });
    const taken = await this.db.admin((db) => db.maybeOne('select 1 from public.tenant_users where lower(email) = $1', [email]));
    if (taken) throw new ConflictException('Este e-mail já está vinculado a uma oficina.');

    // Sem senha, a pessoa entra por convite: o backend cria a conta com uma senha provisória que ninguém vê
    // e manda por e-mail o link para ela definir a própria.
    const invite = !dto.password;
    if (invite) await this.links.assertCanInvite();
    const created = await this.auth.createUser({
      email,
      password: dto.password ?? temporaryPassword(),
      appMetadata: { tenant_id: ctx.tenantId, role: dto.role }
    });
    const user = await this.db.tenant(rls(ctx), (db) =>
      db.one<TenantUser>(
        `insert into public.tenant_users (tenant_id, user_id, role, full_name, email)
         values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
        [ctx.tenantId, created.id, dto.role, dto.full_name.trim(), email]
      )
    );
    if (invite) await this.links.sendInvite({ userId: created.id, email, name: user.full_name, shopName: ctx.tenant.name });
    return { ...user, invited: invite };
  }

  /** Reenvia o convite (por exemplo, se o primeiro expirou ou o e-mail falhou na hora do cadastro). */
  async reinvite(ctx: TenantContext, id: string): Promise<void> {
    const user = await this.db.tenant(rls(ctx), (db) =>
      db.maybeOne<{ user_id: string; email: string; full_name: string }>(
        'select user_id, email, full_name from public.tenant_users where id = $1 and is_active',
        [id]
      )
    );
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.links.assertCanInvite();
    await this.links.sendInvite({ userId: user.user_id, email: user.email, name: user.full_name, shopName: ctx.tenant.name });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateUserDto): Promise<TenantUser> {
    const updated = await this.db.tenant(rls(ctx), async (db) => {
      const current = await db.maybeOne<TenantUser>(`select ${COLUMNS} from public.tenant_users where id = $1 for update`, [id]);
      if (!current) throw new NotFoundException('Usuário não encontrado.');
      const losesOwner = current.role === 'owner' && current.is_active && ((dto.role !== undefined && dto.role !== 'owner') || dto.is_active === false);
      if (losesOwner) await this.assertAnotherOwner(db, id);
      if (current.id === ctx.memberId && dto.is_active === false) {
        throw new BadRequestException('Você não pode desativar o próprio acesso.');
      }
      const { sets, values } = buildUpdate({ full_name: dto.full_name?.trim(), role: dto.role, is_active: dto.is_active }, 2);
      if (!sets.length) return current;
      return db.one<TenantUser>(`update public.tenant_users set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`, [id, ...values]);
    });
    await this.auth.updateAppMetadata(
      updated.user_id,
      updated.is_active ? { tenant_id: updated.tenant_id, role: updated.role } : { tenant_id: null, role: null }
    );
    return updated;
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    const removed = await this.db.tenant(rls(ctx), async (db) => {
      const current = await db.maybeOne<TenantUser>(`select ${COLUMNS} from public.tenant_users where id = $1 for update`, [id]);
      if (!current) throw new NotFoundException('Usuário não encontrado.');
      if (current.id === ctx.memberId) throw new BadRequestException('Você não pode remover o próprio acesso.');
      if (current.role === 'owner') await this.assertAnotherOwner(db, id);
      await db.exec('delete from public.tenant_users where id = $1', [id]);
      return current;
    });
    await this.auth.updateAppMetadata(removed.user_id, { tenant_id: null, role: null });
  }

  private async assertAnotherOwner(db: { one<T>(sql: string, params?: unknown[]): Promise<T> }, exceptId: string): Promise<void> {
    const { count } = await db.one<{ count: number }>(
      `select count(*)::int as count from public.tenant_users where role = 'owner' and is_active and id <> $1`,
      [exceptId]
    );
    if (count === 0) throw new BadRequestException('A oficina precisa ter ao menos um proprietário ativo.');
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('assignable')
  assignable(@Ctx() ctx: TenantContext) {
    return this.users.assignable(ctx);
  }

  @Roles('owner')
  @Get()
  list(@Ctx() ctx: TenantContext) {
    return this.users.list(ctx);
  }

  @Roles('owner')
  @Post()
  create(@Ctx() ctx: TenantContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Roles('owner')
  @HttpCode(204)
  @Post(':id/invite')
  reinvite(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.reinvite(ctx, id);
  }

  @Roles('owner')
  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Roles('owner')
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(ctx, id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
