import { rotulosZona, ZonaId } from '@data/sintomas.catalog';
import { DiagnosticoCdp } from '@models/cdp.model';

export function diagnosticoCdpFallback(zonaId: ZonaId | '', sintomas: string[]): DiagnosticoCdp {
  const zona = rotulosZona[zonaId] ?? 'Sistema afetado';

  return {
    urgencia_geral: 'media',
    pode_dirigir: 'sim_com_cautela',
    risco_principal: 'Sem conexão com a IA — diagnóstico de contingência baseado apenas em padrão de zona.',
    observacoes_seguranca:
      'Evite uso prolongado até inspeção presencial. Em caso de perda de freio, superaquecimento, fumaça ou cheiro forte, interrompa a condução imediatamente.',
    acoes_imediatas: [
      'Realizar leitura de códigos OBD-II',
      'Inspeção visual dos componentes relacionados à zona',
      'Verificar nível de fluidos e vazamentos aparentes'
    ],
    resumo_para_cliente:
      'A IA está indisponível no momento. Pelo que você informou, o carro precisa de uma avaliação presencial antes de uso prolongado. Se possível, evite viagens longas até um mecânico confirmar a causa. Se aparecer superaquecimento, fumaça, cheiro forte ou perda de freio, pare o carro e chame guincho.',
    hipoteses: [
      {
        titulo: `Falha provável em ${zona}`,
        sistema_afetado: zona,
        probabilidade: 50,
        confianca: 'baixa',
        justificativa_tecnica:
          'Diagnóstico de contingência sem análise IA. A combinação entre zona, sintomas e respostas indica anomalia localizada que requer teste funcional.',
        evidencias_usadas: sintomas,
        componentes_a_verificar: [
          {
            nome: 'Sensores relacionados',
            prioridade: 'alta',
            teste_recomendado: 'Leitura de scanner OBD-II'
          },
          { nome: 'Fluidos e vedações', prioridade: 'media', teste_recomendado: 'Inspeção visual e nível' },
          { nome: 'Fixações e suportes', prioridade: 'baixa', teste_recomendado: 'Verificação mecânica' }
        ],
        custo_estimado_brl: { min: 150, max: 800 },
        tempo_reparo_horas: { min: 1, max: 4 }
      }
    ]
  };
}
