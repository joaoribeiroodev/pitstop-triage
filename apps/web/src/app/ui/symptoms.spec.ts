import { TestBed } from '@angular/core/testing';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import type { ReportedSymptom, SymptomCategory } from '@pitstop/shared-types';
import { formatAnswer, indexSymptoms, SymptomQuestionsComponent, SymptomReportComponent, SymptomSelectComponent } from './symptoms';

const CATALOG: SymptomCategory[] = [
  {
    id: 'c1',
    code: 'freios',
    name: 'Freios',
    icon: null,
    description: null,
    symptoms: [
      {
        id: 's1',
        code: 'brake_noise',
        name: 'Chiado ao frear',
        description: null,
        follow_up_questions: [
          { id: 'when', text: 'Quando acontece?', type: 'select', options: ['Sempre', 'Só a frio'] },
          { id: 'km', text: 'Há quantos km?', type: 'number' },
          { id: 'pedal', text: 'O pedal vibra?', type: 'boolean' }
        ]
      },
      { id: 's2', code: 'soft_pedal', name: 'Pedal baixo', description: null, follow_up_questions: [] }
    ]
  }
];

describe('sintomas', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideExperimentalZonelessChangeDetection()] }));

  it('indexa o catálogo por código', () => {
    expect(indexSymptoms(CATALOG).get('soft_pedal')?.name).toBe('Pedal baixo');
  });

  it('descreve respostas em linguagem de gente', () => {
    expect(formatAnswer(true)).toBe('Sim');
    expect(formatAnswer(false)).toBe('Não');
    expect(formatAnswer(undefined)).toBe('Não respondido');
    expect(formatAnswer(12)).toBe('12');
  });

  it('marca e desmarca sintomas preservando os demais', () => {
    const fixture = TestBed.createComponent(SymptomSelectComponent);
    fixture.componentRef.setInput('catalog', CATALOG);
    fixture.componentRef.setInput('value', [] as ReportedSymptom[]);
    const select = fixture.componentInstance;
    select.toggle('brake_noise');
    select.toggle('soft_pedal');
    select.toggle('brake_noise');
    expect(select.value()).toEqual([{ symptom_code: 'soft_pedal', answers: {} }]);
  });

  it('converte respostas pelo tipo da pergunta e remove as vazias', () => {
    const fixture = TestBed.createComponent(SymptomQuestionsComponent);
    fixture.componentRef.setInput('catalog', CATALOG);
    fixture.componentRef.setInput('value', [{ symptom_code: 'brake_noise', answers: {} }]);
    const questions = fixture.componentInstance;
    const [when, km] = CATALOG[0].symptoms[0].follow_up_questions;
    questions.answer('brake_noise', when, ' Sempre ');
    questions.answer('brake_noise', km, '1,5');
    questions.set('brake_noise', 'pedal', false);
    expect(questions.value()[0].answers).toEqual({ when: 'Sempre', km: 1.5, pedal: false });
    questions.answer('brake_noise', when, '   ');
    expect(questions.value()[0].answers).toEqual({ km: 1.5, pedal: false });
  });

  it('mostra o relato com o texto das perguntas, não com os ids', async () => {
    const fixture = TestBed.createComponent(SymptomReportComponent);
    fixture.componentRef.setInput('catalog', CATALOG);
    fixture.componentRef.setInput('symptoms', [{ symptom_code: 'brake_noise', answers: { pedal: true } }]);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Chiado ao frear');
    expect(text).toContain('O pedal vibra?');
    expect(text).toContain('Sim');
  });
});
