import { ORDER_STATUSES } from '@pitstop/shared-types';
import { formatBRL, formatDuration, formatPhone, STATUS_TONE } from './format';

describe('formatação', () => {
  it('formata valores em reais', () => {
    expect(formatBRL(309.9).replace(/\s/g, ' ')).toBe('R$ 309,90');
    expect(formatBRL(null).replace(/\s/g, ' ')).toBe('R$ 0,00');
  });

  it('formata telefones com DDD e mantém o que não reconhece', () => {
    expect(formatPhone('71988887777')).toBe('(71) 98888-7777');
    expect(formatPhone('7133334444')).toBe('(71) 3333-4444');
    expect(formatPhone('123')).toBe('123');
    expect(formatPhone(null)).toBe('—');
  });

  it('formata durações em horas e minutos', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(0)).toBe('—');
  });

  it('tem um tom visual para cada status de OS', () => {
    for (const status of ORDER_STATUSES) expect(STATUS_TONE[status]).toBeDefined();
  });
});
