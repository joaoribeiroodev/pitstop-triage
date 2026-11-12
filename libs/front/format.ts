import { Pipe, PipeTransform } from '@angular/core';
import { ORDER_STATUS_LABELS, OrderStatus, QUOTE_STATUS_LABELS, QuoteStatus, TenantRole } from '@pitstop/shared-types';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Datas de calendário ('2026-11-13', como vencimento e validade) não são instantes: lidas como UTC,
 * apareceriam como o dia anterior no Brasil. Aqui elas valem no dia local; instantes completos seguem como são.
 */
export function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
}

/** Dia local (YYYY-MM-DD) de um instante, para preencher campos de data. */
export function localDay(value: Date | string): string {
  const date = typeof value === 'string' ? toDate(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatBRL(value: number | null | undefined): string {
  return BRL.format(value ?? 0);
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export type Tone = 'idle' | 'wait' | 'work' | 'done' | 'stop';

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'idle',
  diagnosis: 'work',
  awaiting_approval: 'wait',
  approved: 'wait',
  in_progress: 'work',
  completed: 'done',
  delivered: 'done',
  rejected: 'stop',
  cancelled: 'idle'
};

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  receptionist: 'Recepção',
  mechanic: 'Mecânico'
};

@Pipe({ name: 'brl', standalone: true })
export class BrlPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatBRL(value);
  }
}

@Pipe({ name: 'phone', standalone: true })
export class PhonePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatPhone(value);
  }
}

@Pipe({ name: 'day', standalone: true })
export class DayPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? DATE.format(toDate(value)) : '—';
  }
}

@Pipe({ name: 'moment', standalone: true })
export class MomentPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? DATE_TIME.format(toDate(value)).replace(',', ' às') : '—';
  }
}

@Pipe({ name: 'duration', standalone: true })
export class DurationPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatDuration(value);
  }
}

@Pipe({ name: 'orderStatus', standalone: true })
export class OrderStatusPipe implements PipeTransform {
  transform(value: OrderStatus): string {
    return ORDER_STATUS_LABELS[value] ?? value;
  }
}

@Pipe({ name: 'quoteStatus', standalone: true })
export class QuoteStatusPipe implements PipeTransform {
  transform(value: QuoteStatus): string {
    return QUOTE_STATUS_LABELS[value] ?? value;
  }
}

export const FORMAT_PIPES = [BrlPipe, PhonePipe, DayPipe, MomentPipe, DurationPipe, OrderStatusPipe, QuoteStatusPipe] as const;
