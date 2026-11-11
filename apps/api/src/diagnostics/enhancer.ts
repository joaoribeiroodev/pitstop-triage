import { Injectable, Logger } from '@nestjs/common';
import type { DiagnosticResult } from '@pitstop/shared-types';

export const DIAGNOSTIC_ENHANCER = Symbol('DIAGNOSTIC_ENHANCER');

export interface EnhancerContext {
  tenantId: string;
  enabled: boolean;
}

/**
 * Ponto de extensão reservado para um enriquecimento opcional (Fase 4).
 * O contrato é: receber a saída determinística e devolver uma saída do mesmo formato.
 * Nenhuma implementação é fonte de verdade — o motor funciona sem ela.
 */
export interface DiagnosticEnhancer {
  enhance(result: DiagnosticResult, context: EnhancerContext): Promise<DiagnosticResult>;
}

/** Implementação padrão: não faz nada. */
@Injectable()
export class NoOpEnhancer implements DiagnosticEnhancer {
  async enhance(result: DiagnosticResult): Promise<DiagnosticResult> {
    return result;
  }
}

/**
 * Executa qualquer enhancer com rede de proteção: se estiver desligado para o tenant,
 * falhar ou devolver algo inválido, vale a saída determinística original — sem erro visível.
 */
export async function enhanceSafely(
  enhancer: DiagnosticEnhancer,
  result: DiagnosticResult,
  context: EnhancerContext,
  logger: Logger
): Promise<DiagnosticResult> {
  if (!context.enabled) return result;
  try {
    const enhanced = await enhancer.enhance(result, context);
    const valid = enhanced && Array.isArray(enhanced.suggestions) && enhanced.suggestions.length === result.suggestions.length;
    return valid ? enhanced : result;
  } catch (error) {
    logger.warn(`Enhancer falhou; mantendo saída determinística: ${(error as Error).message}`);
    return result;
  }
}
