import { rotulosZona, ZonaId } from '@data/sintomas.catalog';
import { DiagnosticoCdp } from '@models/cdp.model';
import { Veiculo } from '@models/veiculo.model';

export function diagnosticoCdpFallback(
  zonaId: ZonaId | '',
  sintomas: string[],
  veiculo?: Pick<Veiculo, 'tipoTransmissao'>
): DiagnosticoCdp {
  const zona = rotulosZona[zonaId] ?? 'Sistema afetado';
  const tipoTx = veiculo?.tipoTransmissao ?? 'desconhecido';
  const transmissaoAutomatica =
    tipoTx === 'automatico_conversor' || tipoTx === 'cvt' || tipoTx === 'automatico_embreagem';

  const acoesBase = [
    'Realizar leitura de códigos OBD-II',
    'Inspeção visual dos componentes relacionados à zona',
    'Verificar nível de fluidos e vazamentos aparentes'
  ];

  if (zonaId === 'transmissao' && tipoTx === 'desconhecido') {
    acoesBase.push(
      'Confirmar na oficina se o câmbio é manual, automático tradicional, CVT ou automatizado (DCT)'
    );
  }

  const componentesTransmissaoAutomatica = [
    {
      nome: 'Fluido ATF e vazamentos',
      prioridade: 'alta' as const,
      teste_recomendado: 'Inspeção visual + nível e cor'
    },
    {
      nome: 'Conversor de torque / TCU',
      prioridade: 'media' as const,
      teste_recomendado: 'Scanner: leitura de falhas e dados de pressão de linha'
    },
    {
      nome: 'Semieixos e juntas homocinéticas',
      prioridade: 'media' as const,
      teste_recomendado: 'Inspeção de folga e graxa'
    }
  ];

  const componentesGenericos = [
    {
      nome: 'Sensores relacionados',
      prioridade: 'alta' as const,
      teste_recomendado: 'Leitura de scanner OBD-II'
    },
    {
      nome: 'Fluidos e vedações',
      prioridade: 'media' as const,
      teste_recomendado: 'Inspeção visual e nível'
    },
    { nome: 'Fixações e suportes', prioridade: 'baixa' as const, teste_recomendado: 'Verificação mecânica' }
  ];

  const componentes =
    zonaId === 'transmissao' && transmissaoAutomatica
      ? componentesTransmissaoAutomatica
      : componentesGenericos;

  return {
    urgencia_geral: 'media',
    pode_dirigir: 'sim_com_cautela',
    risco_principal: 'Sem conexão com a IA — diagnóstico de contingência baseado apenas em padrão de zona.',
    observacoes_seguranca:
      'Evite uso prolongado até inspeção presencial. Em caso de perda de freio, superaquecimento, fumaça ou cheiro forte, interrompa a condução imediatamente.',
    acoes_imediatas: acoesBase,
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
        componentes_a_verificar: componentes,
        custo_estimado_brl: { min: 150, max: 800 },
        tempo_reparo_horas: { min: 1, max: 4 }
      }
    ]
  };
}
