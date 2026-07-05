/** Versão da política — incrementar ao alterar o texto legal. */
export const POLITICA_PRIVACIDADE_VERSAO = '1.1.0';

export const CONTROLADOR_DADOS = {
  nome: 'PitStop Triage',
  finalidade: 'Triagem automotiva prévia assistida por inteligência artificial',
  contato: 'pitstop.triage@gmail.com'
} as const;

export const RESUMO_TRATAMENTO_DADOS = [
  {
    titulo: 'Dados coletados',
    itens: [
      'Identificação do veículo (marca, modelo, ano, código FIPE ou dados manuais)',
      'Zona e sintomas relatados sobre o automóvel',
      'Respostas ao refinamento com IA',
      'Observações opcionais que você digitar'
    ]
  },
  {
    titulo: 'Finalidade',
    itens: [
      'Gerar diagnóstico prévio (CDP) para apoio à oficina',
      'Refinar hipóteses técnicas com perguntas contextualizadas',
      'Manter sua triagem salva localmente no navegador entre etapas'
    ]
  },
  {
    titulo: 'Compartilhamento',
    itens: [
      'API pública FIPE (Parallelum) — apenas consulta de marca/modelo/ano',
      'OpenAI — processamento das etapas de IA (refinamento e CDP)',
      'Não vendemos nem compartilhamos dados com terceiros para marketing'
    ]
  },
  {
    titulo: 'Armazenamento',
    itens: [
      'Dados da triagem ficam no localStorage do seu navegador',
      'Requisições à IA trafegam pelo servidor da aplicação e não são persistidas em banco',
      'Você pode excluir tudo a qualquer momento pelo rodapé'
    ]
  },
  {
    titulo: 'Seus direitos (LGPD)',
    itens: [
      'Confirmar se tratamos seus dados e acessá-los',
      'Corrigir dados incompletos ou desatualizados',
      'Revogar consentimento e solicitar exclusão',
      'Informação sobre compartilhamento e finalidade'
    ]
  }
] as const;

export const POLITICA_PRIVACIDADE_SECOES = [
  {
    titulo: '1. Controlador e contato',
    paragrafos: [
      `O ${CONTROLADOR_DADOS.nome} é responsável pelo tratamento dos dados pessoais inseridos voluntariamente nesta plataforma de ${CONTROLADOR_DADOS.finalidade}.`,
      `Para exercer seus direitos previstos na Lei nº 13.709/2018 (LGPD), utilize o canal: ${CONTROLADOR_DADOS.contato}.`
    ]
  },
  {
    titulo: '2. Dados tratados',
    paragrafos: [
      'Coletamos apenas os dados necessários para a triagem: informações do veículo, localização do problema no carro, sintomas descritos, respostas às perguntas de refinamento e observações opcionais.',
      'Não solicitamos nome, CPF, e-mail, telefone ou placa do veículo para utilizar o serviço.'
    ]
  },
  {
    titulo: '3. Bases legais',
    paragrafos: [
      'O tratamento ocorre com base no seu consentimento (art. 7º, I, LGPD), manifestado ao clicar em "Começar" após leitura desta política.',
      'O processamento por IA e consultas à FIPE são necessários para a execução do serviço solicitado por você (art. 7º, V).'
    ]
  },
  {
    titulo: '4. Compartilhamento com terceiros',
    paragrafos: [
      'Consulta FIPE: enviamos códigos de marca/modelo/ano à API pública parallelum.com.br para identificar o veículo.',
      'Inteligência artificial: os dados da triagem são enviados à OpenAI exclusivamente para gerar perguntas de refinamento e o diagnóstico prévio. O provedor processa os dados conforme seus termos de uso e política de privacidade.',
      'Não há transferência internacional além daquela inerente ao uso dos serviços de nuvem do provedor de IA, quando aplicável.'
    ]
  },
  {
    titulo: '5. Retenção e armazenamento',
    paragrafos: [
      'Os dados da triagem permanecem no localStorage do seu dispositivo até você excluí-los, reiniciar a triagem ou revogar o consentimento.',
      'O backend serverless não mantém banco de dados persistente com o conteúdo das suas respostas.'
    ]
  },
  {
    titulo: '6. Segurança',
    paragrafos: [
      'Utilizamos HTTPS em produção, validação de entrada na API e minimização de dados — apenas o necessário é enviado à IA.',
      'Recomendamos não incluir em observações dados que identifiquem pessoas (nome, documentos, endereço).'
    ]
  },
  {
    titulo: '7. Direitos do titular',
    paragrafos: [
      'Você pode, a qualquer momento: confirmar a existência de tratamento, acessar, corrigir, anonimizar ou excluir dados, revogar consentimento e obter informações sobre compartilhamento.',
      'Use o botão "Excluir meus dados" no rodapé ou o e-mail de contato indicado acima.'
    ]
  },
  {
    titulo: '8. Atualizações',
    paragrafos: [
      `Esta política pode ser atualizada. A versão vigente é ${POLITICA_PRIVACIDADE_VERSAO}. Novo consentimento poderá ser solicitado se houver mudanças relevantes.`
    ]
  }
] as const;
