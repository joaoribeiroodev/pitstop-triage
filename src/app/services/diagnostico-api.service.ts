import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { DiagnosticoCdp } from '@models/cdp.model';
import { RefinamentoResponse } from '@models/refinamento.model';
import { TriageSnapshot } from '@models/triage.model';
import { corrigirDiagnosticoCdp, corrigirRefinamentoResposta } from '@utils/pt-br-text.util';

/** Gemini costuma levar 15–90s; após isso usamos fallback local no componente. */
export const AI_REQUEST_TIMEOUT_MS = 45_000;

@Injectable({ providedIn: 'root' })
export class DiagnosticoApiService {
  private readonly http = inject(HttpClient);

  gerarDiagnostico(snapshot: TriageSnapshot): Observable<DiagnosticoCdp> {
    return this.http.post<DiagnosticoCdp>('/api/gerar-diagnostico', snapshot).pipe(
      map((d) => corrigirDiagnosticoCdp(d)),
      timeout({ first: AI_REQUEST_TIMEOUT_MS })
    );
  }

  gerarPerguntas(snapshot: TriageSnapshot, rodada = 1): Observable<RefinamentoResponse> {
    return this.http.post<RefinamentoResponse>('/api/refinar-triagem', { ...snapshot, rodada }).pipe(
      map((r) => corrigirRefinamentoResposta(r)),
      timeout({ first: AI_REQUEST_TIMEOUT_MS })
    );
  }
}

export type { PerguntaRefinamento, RefinamentoResponse, TipoPergunta } from '@models/refinamento.model';
