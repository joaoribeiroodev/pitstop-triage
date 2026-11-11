import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { APPOINTMENT_STATUSES, type Appointment, type AppointmentStatus } from '@pitstop/shared-types';
import type { TenantContext } from '../common/context';
import { Ctx, RequireFeature, Roles, STAFF_WRITE } from '../common/decorators';
import { blankToNull, buildUpdate, rls } from '../common/rls';
import { DatabaseService, Db } from '../database/database.service';

export class AppointmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title: string;

  @IsISO8601()
  starts_at: string;

  @IsISO8601()
  ends_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bay?: string | null;

  @IsOptional()
  @IsUUID()
  mechanic_id?: string | null;

  @IsOptional()
  @IsUUID()
  customer_id?: string | null;

  @IsOptional()
  @IsUUID()
  vehicle_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsISO8601()
  starts_at?: string;

  @IsOptional()
  @IsISO8601()
  ends_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bay?: string | null;

  @IsOptional()
  @IsUUID()
  mechanic_id?: string | null;

  @IsOptional()
  @IsUUID()
  customer_id?: string | null;

  @IsOptional()
  @IsUUID()
  vehicle_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;
}

export class ScheduleQuery {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;
}

const APPOINTMENT_SQL = `select a.id, a.title, a.starts_at, a.ends_at, a.bay, a.mechanic_id, m.full_name as mechanic_name, a.status, a.notes,
                                a.customer_id, c.name as customer_name, c.phone as customer_phone,
                                a.vehicle_id, v.plate as vehicle_plate, nullif(trim(concat_ws(' ', v.brand, v.model)), '') as vehicle_label,
                                a.service_order_id, a.created_at
                           from public.appointments a
                           left join public.tenant_users m on m.id = a.mechanic_id
                           left join public.customers c on c.id = a.customer_id
                           left join public.vehicles v on v.id = a.vehicle_id`;

/** Ocupam box e mecânico: os agendamentos que ainda vão (ou podem) acontecer. */
const BLOCKING: AppointmentStatus[] = ['scheduled', 'confirmed'];
const MAX_HOURS = 24 * 14;

interface Slot {
  starts_at: string;
  ends_at: string;
  bay: string | null;
  mechanic_id: string | null;
}

/**
 * Agenda da oficina (Fase 3): horários por box e por mecânico, com bloqueio de conflito.
 * Dois agendamentos ativos não podem ocupar o mesmo box nem o mesmo mecânico no mesmo intervalo.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly db: DatabaseService) {}

  list(ctx: TenantContext, query: ScheduleQuery): Promise<Appointment[]> {
    return this.db.tenant(rls(ctx), (db) =>
      db.many<Appointment>(
        `${APPOINTMENT_SQL} where a.starts_at < $2::timestamptz and a.ends_at > $1::timestamptz order by a.starts_at, a.created_at limit 1000`,
        [query.from, query.to]
      )
    );
  }

  private async find(db: Db, id: string): Promise<Appointment> {
    const appointment = await db.maybeOne<Appointment>(`${APPOINTMENT_SQL} where a.id = $1`, [id]);
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    return appointment;
  }

  private static assertPeriod(slot: Slot): void {
    const start = new Date(slot.starts_at).getTime();
    const end = new Date(slot.ends_at).getTime();
    if (!(end > start)) throw new BadRequestException('O término precisa ser depois do início.');
    if (end - start > MAX_HOURS * 3_600_000) throw new BadRequestException('Um agendamento pode durar no máximo 14 dias.');
  }

  /** Referências precisam ser da própria oficina: a RLS já esconde as de outras, então "não achei" é "não existe". */
  private async assertReferences(db: Db, dto: { mechanic_id?: string | null; customer_id?: string | null; vehicle_id?: string | null }): Promise<void> {
    if (dto.mechanic_id && !(await db.maybeOne('select 1 from public.tenant_users where id = $1 and is_active', [dto.mechanic_id]))) {
      throw new BadRequestException('Responsável não encontrado ou inativo.');
    }
    if (dto.customer_id && !(await db.maybeOne('select 1 from public.customers where id = $1', [dto.customer_id]))) {
      throw new BadRequestException('Cliente não encontrado.');
    }
    if (dto.vehicle_id && !(await db.maybeOne('select 1 from public.vehicles where id = $1', [dto.vehicle_id]))) {
      throw new BadRequestException('Veículo não encontrado.');
    }
  }

  private async assertFree(db: Db, ctx: TenantContext, slot: Slot, ignoreId: string | null): Promise<void> {
    if (!slot.bay && !slot.mechanic_id) return;
    // Serializa as marcações da oficina: duas requisições simultâneas não passam ambas pela checagem.
    await db.exec('select pg_advisory_xact_lock(hashtext($1))', [`agenda:${ctx.tenantId}`]);
    const clash = await db.maybeOne<{ title: string; bay: string | null; mechanic_id: string | null; mechanic_name: string | null }>(
      `select a.title, a.bay, a.mechanic_id, m.full_name as mechanic_name
         from public.appointments a left join public.tenant_users m on m.id = a.mechanic_id
        where a.status = any($1) and a.starts_at < $3::timestamptz and a.ends_at > $2::timestamptz
          and ($4::uuid is null or a.id <> $4)
          and (($5::text is not null and lower(a.bay) = lower($5)) or ($6::uuid is not null and a.mechanic_id = $6))
        order by a.starts_at limit 1`,
      [BLOCKING, slot.starts_at, slot.ends_at, ignoreId, slot.bay, slot.mechanic_id]
    );
    if (!clash) return;
    const sameBay = slot.bay && clash.bay && clash.bay.toLowerCase() === slot.bay.toLowerCase();
    throw new ConflictException(
      sameBay
        ? `O box ${clash.bay} já está ocupado nesse horário (${clash.title}).`
        : `${clash.mechanic_name ?? 'O responsável'} já tem um agendamento nesse horário (${clash.title}).`
    );
  }

  create(ctx: TenantContext, dto: AppointmentDto): Promise<Appointment> {
    return this.db.tenant(rls(ctx), async (db) => {
      const slot: Slot = { starts_at: dto.starts_at, ends_at: dto.ends_at, bay: blankToNull(dto.bay), mechanic_id: dto.mechanic_id ?? null };
      ScheduleService.assertPeriod(slot);
      await this.assertReferences(db, dto);
      await this.assertFree(db, ctx, slot, null);
      const created = await db.one<{ id: string }>(
        `insert into public.appointments (tenant_id, title, starts_at, ends_at, bay, mechanic_id, customer_id, vehicle_id, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          ctx.tenantId,
          dto.title.trim(),
          slot.starts_at,
          slot.ends_at,
          slot.bay,
          slot.mechanic_id,
          dto.customer_id ?? null,
          dto.vehicle_id ?? null,
          blankToNull(dto.notes),
          ctx.userId
        ]
      );
      return this.find(db, created.id);
    });
  }

  update(ctx: TenantContext, id: string, dto: UpdateAppointmentDto): Promise<Appointment> {
    return this.db.tenant(rls(ctx), async (db) => {
      const current = await this.find(db, id);
      const slot: Slot = {
        starts_at: dto.starts_at ?? current.starts_at,
        ends_at: dto.ends_at ?? current.ends_at,
        bay: dto.bay === undefined ? current.bay : blankToNull(dto.bay),
        mechanic_id: dto.mechanic_id === undefined ? current.mechanic_id : dto.mechanic_id
      };
      const status = dto.status ?? current.status;
      ScheduleService.assertPeriod(slot);
      await this.assertReferences(db, dto);
      if (BLOCKING.includes(status)) await this.assertFree(db, ctx, slot, id);
      const { sets, values } = buildUpdate(
        {
          title: dto.title?.trim(),
          starts_at: dto.starts_at,
          ends_at: dto.ends_at,
          bay: dto.bay === undefined ? undefined : slot.bay,
          mechanic_id: dto.mechanic_id,
          customer_id: dto.customer_id,
          vehicle_id: dto.vehicle_id,
          notes: dto.notes === undefined ? undefined : blankToNull(dto.notes),
          status: dto.status
        },
        2
      );
      if (sets.length) await db.exec(`update public.appointments set ${sets.join(', ')} where id = $1`, [id, ...values]);
      return this.find(db, id);
    });
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    await this.db.tenant(rls(ctx), async (db) => {
      await this.find(db, id);
      await db.exec('delete from public.appointments where id = $1', [id]);
    });
  }
}

@Controller('appointments')
@RequireFeature('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  list(@Ctx() ctx: TenantContext, @Query() query: ScheduleQuery) {
    return this.schedule.list(ctx, query);
  }

  @Post()
  @Roles(...STAFF_WRITE)
  create(@Ctx() ctx: TenantContext, @Body() dto: AppointmentDto) {
    return this.schedule.create(ctx, dto);
  }

  @Patch(':id')
  @Roles(...STAFF_WRITE)
  update(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAppointmentDto) {
    return this.schedule.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...STAFF_WRITE)
  remove(@Ctx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.remove(ctx, id);
  }
}

@Module({ controllers: [ScheduleController], providers: [ScheduleService] })
export class ScheduleModule {}
