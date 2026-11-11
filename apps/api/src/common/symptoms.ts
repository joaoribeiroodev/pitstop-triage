import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { AnswerValue, FollowUpQuestion, ReportedSymptom } from '@pitstop/shared-types';
import type { Db } from '../database/database.service';

export class ReportedSymptomDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,80}$/)
  symptom_code: string;

  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;
}

export const reportedSymptomType = () => Type(() => ReportedSymptomDto);

export class FreeNotes {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  free_form_notes?: string;
}

/**
 * Confere o relato contra o catálogo global: descarta códigos repetidos, recusa códigos
 * inexistentes e mantém apenas respostas de perguntas que existem, com valores primitivos.
 */
export async function sanitizeSymptoms(db: Db, input: ReportedSymptomDto[] | undefined): Promise<ReportedSymptom[]> {
  if (!input?.length) return [];
  const codes = [...new Set(input.map((item) => item.symptom_code))];
  const catalog = await db.many<{ code: string; follow_up_questions: FollowUpQuestion[] }>(
    'select code, follow_up_questions from public.symptoms where code = any($1) and is_active',
    [codes]
  );
  const questionsByCode = new Map(catalog.map((row) => [row.code, row.follow_up_questions]));
  const missing = codes.filter((code) => !questionsByCode.has(code));
  if (missing.length) throw new BadRequestException(`Sintoma(s) inexistente(s) no catálogo: ${missing.join(', ')}`);

  return codes.map((code) => {
    const raw = input.find((item) => item.symptom_code === code)?.answers ?? {};
    const answers: Record<string, AnswerValue> = {};
    for (const question of questionsByCode.get(code) ?? []) {
      const value = raw[question.id];
      if (value === undefined || value === null || value === '') continue;
      if (question.type === 'boolean' && typeof value === 'boolean') answers[question.id] = value;
      else if (question.type === 'number' && typeof value === 'number' && Number.isFinite(value)) answers[question.id] = value;
      else if (question.type === 'select' && typeof value === 'string' && question.options?.includes(value)) answers[question.id] = value;
      else if (question.type === 'text' && typeof value === 'string') answers[question.id] = value.trim().slice(0, 500);
      else throw new BadRequestException(`Resposta inválida para a pergunta "${question.text}".`);
    }
    return { symptom_code: code, answers };
  });
}
