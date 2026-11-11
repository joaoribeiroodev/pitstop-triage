import { Inject, Injectable } from '@nestjs/common';
import type { DiagnosticResult } from '@pitstop/shared-types';
import { ENV, Env } from '../config/env';
import type { DiagnosticEnhancer } from './enhancer';

const MAX_NOTE = 600;

/**
 * Camada opcional de IA (Fase 4), atrás do módulo "ai" do tenant e de uma chave no ambiente.
 * Ela só ACRESCENTA um resumo em linguagem simples (`ai_note`): causas, verificações, peças e tempos
 * continuam sendo exatamente os do motor determinístico. Sem chave, com erro ou com resposta estranha,
 * vale a saída original (ver enhanceSafely).
 * Privacidade: só seguem para o provedor os nomes dos sintomas, as causas e a marca — nenhum dado de cliente.
 */
@Injectable()
export class AiEnhancer implements DiagnosticEnhancer {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async enhance(result: DiagnosticResult): Promise<DiagnosticResult> {
    if (!this.env.openaiApiKey || !result.suggestions.length) return result;
    const facts = result.suggestions.map((suggestion) => ({
      sintoma: suggestion.symptom_name,
      causas: suggestion.causes.slice(0, 4).map((cause) => cause.description),
      verificacoes: suggestion.checks.slice(0, 4).map((check) => check.name)
    }));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.openaiApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.env.openaiModel,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content:
              'Você ajuda mecânicos de oficina. Com base APENAS nos dados fornecidos, escreva em português um resumo de até 3 frases indicando por onde começar a verificação. Não invente causas, peças, preços nem prazos.'
          },
          { role: 'user', content: JSON.stringify({ marca: result.vehicle_brand, itens: facts }) }
        ]
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`Provedor de IA respondeu HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const note = body.choices?.[0]?.message?.content?.trim();
    return note ? { ...result, ai_note: note.slice(0, MAX_NOTE) } : result;
  }
}
