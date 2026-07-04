import { PerguntaRefinamento } from '@models/refinamento.model';

export function perguntasRefinamentoFallback(rodada: number): PerguntaRefinamento[] {
  if (rodada === 2) {
    return [
      {
        id: 'q_fb_progressao',
        pergunta: 'O sintoma está piorando ao longo dos dias?',
        tipo: 'escala',
        objetivo: 'Determinar se o problema está em progressão (urgência maior).',
        opcoes: ['Estável', 'Piorando devagar', 'Piorando rápido']
      },
      {
        id: 'q_fb_manut',
        pergunta: 'Qual foi a última manutenção feita?',
        tipo: 'multipla_escolha',
        objetivo: 'Cruzar manutenção recente com sintomas para identificar instalações suspeitas.',
        opcoes: ['Há menos de 1 mês', 'Entre 1 e 6 meses', 'Mais de 6 meses', 'Não lembro']
      }
    ];
  }

  return [
    {
      id: 'q_fb_temp',
      pergunta: 'O problema acontece com o carro frio ou quente?',
      tipo: 'multipla_escolha',
      objetivo: 'Discriminar entre falhas térmicas e mecânicas constantes.',
      opcoes: ['Mais com o carro frio', 'Mais com o carro quente', 'Acontece sempre']
    },
    {
      id: 'q_fb_cond',
      pergunta: 'Quando o sintoma piora?',
      tipo: 'multipla_escolha',
      objetivo: 'Identificar a condição de carga que dispara o problema.',
      opcoes: ['Em movimento', 'Parado', 'Ao frear ou acelerar', 'Em curvas ou buracos']
    }
  ];
}
