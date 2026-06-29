import { Injectable, computed, signal } from '@angular/core';
import { POLITICA_PRIVACIDADE_VERSAO } from '@core/constants/lgpd.constants';
import { LgpdConsentimento } from '@core/models/lgpd.model';

const STORAGE_KEY = 'pitstop-triage/lgpd/v1';

function carregarConsentimento(): LgpdConsentimento | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LgpdConsentimento;
    if (!parsed.aceito || parsed.versaoPolitica !== POLITICA_PRIVACIDADE_VERSAO) return null;
    return parsed;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class LgpdConsentService {
  private readonly consentimento = signal<LgpdConsentimento | null>(carregarConsentimento());

  readonly temConsentimento = computed(() => Boolean(this.consentimento()?.aceito));
  readonly dataAceite = computed(() => this.consentimento()?.dataAceite ?? null);

  registrarAceite(): void {
    const registro: LgpdConsentimento = {
      aceito: true,
      versaoPolitica: POLITICA_PRIVACIDADE_VERSAO,
      dataAceite: new Date().toISOString()
    };
    this.consentimento.set(registro);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registro));
      } catch {
        /* ignore */
      }
    }
  }

  revogarConsentimento(): void {
    this.consentimento.set(null);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}
