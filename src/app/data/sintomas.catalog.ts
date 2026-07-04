export type ZonaId = 'motor' | 'freios' | 'suspensao' | 'eletrica' | 'transmissao' | 'arrefecimento';

export interface ZonaMeta {
  id: ZonaId;
  label: string;
  icone: string;
  descricao: string;
  sistemas: string[];
}

export const zonasCatalogo: Record<ZonaId, ZonaMeta> = {
  motor: {
    id: 'motor',
    label: 'Motor',
    icone: '🛠️',
    descricao: 'Combustão, ignição, alimentação e gerenciamento eletrônico.',
    sistemas: ['Injeção', 'Ignição', 'Alimentação', 'Lubrificação', 'Sensores ECU']
  },
  freios: {
    id: 'freios',
    label: 'Freios',
    icone: '🛑',
    descricao: 'Frenagem hidráulica, ABS, pastilhas, discos e acionamento.',
    sistemas: ['Hidráulico', 'ABS', 'Atrito (pastilhas/lonas)', 'Servofreio']
  },
  suspensao: {
    id: 'suspensao',
    label: 'Suspensão e Direção',
    icone: '🌀',
    descricao: 'Amortecimento, geometria, articulações e direção.',
    sistemas: ['Amortecedores', 'Molas', 'Bandejas/Pivôs', 'Direção hidráulica/elétrica']
  },
  eletrica: {
    id: 'eletrica',
    label: 'Elétrica',
    icone: '⚡',
    descricao: 'Bateria, alternador, partida, painel e acessórios.',
    sistemas: ['Bateria', 'Alternador', 'Motor de partida', 'Chicotes/fusíveis', 'Iluminação']
  },
  transmissao: {
    id: 'transmissao',
    label: 'Transmissão',
    icone: '⚙️',
    descricao: 'Câmbio (manual ou automático), embreagem e semieixos.',
    sistemas: ['Câmbio', 'Embreagem', 'Semieixos/juntas', 'Eletrônica (TCU)']
  },
  arrefecimento: {
    id: 'arrefecimento',
    label: 'Arrefecimento',
    icone: '🌡️',
    descricao: 'Controle térmico do motor: radiador, bomba, válvula e ventoinha.',
    sistemas: ['Radiador', "Bomba d'água", 'Válvula termostática', 'Ventoinhas', 'Reservatório/mangueiras']
  }
};

export const sintomasPorZona: Record<ZonaId, string[]> = {
  motor: [
    'Marcha lenta instável ou apagando',
    'Motor falhando ou tremendo parado',
    'Perda de potência em subidas ou ao acelerar',
    'Luz de injeção (engine) acesa',
    'Estouros no escapamento',
    'Cheiro de queimado vindo do cofre',
    'Consumo de combustível aumentou muito',
    'Fumaça branca/azul/preta saindo do escape',
    'Ruído metálico ao acelerar',
    'Motor demora a pegar pela manhã'
  ],
  freios: [
    'Chiado agudo ao frear',
    'Ronco grave ao frear',
    'Pedal do freio muito baixo ou afundando',
    'Pedal duro, difícil de pressionar',
    'Volante vibra durante a frenagem',
    'Carro puxa para um lado ao frear',
    'Luz de freio ou ABS acesa no painel',
    'Cheiro de queimado após descidas',
    'Trepidação no pedal em frenagens fortes',
    'Pisca alerta liga sozinho em frenagem brusca (BAS)'
  ],
  suspensao: [
    'Batida seca ao passar em buracos',
    'Rangido ao passar em lombadas',
    'Carro balança demais em curvas',
    'Pneu desgastando irregularmente',
    'Direção pesada ou puxando para um lado',
    'Volante folgado ou com retorno ruim',
    'Estalos ao esterçar parado',
    'Carro "rebola" após buraco (perde firmeza)',
    'Altura do veículo desigual',
    'Tremor no volante em alta velocidade'
  ],
  eletrica: [
    'Dificuldade ou demora para dar partida',
    'Carro não dá partida (só estala)',
    'Faróis fracos ou oscilando',
    'Painel apaga ou pisca sozinho',
    'Vidros, travas ou retrovisores falhando',
    'Bateria descarrega com frequência',
    'Luz de bateria acesa no painel',
    'Cheiro de fio queimado',
    'Multimídia/rádio reiniciando sozinha',
    'Sensores intermitentes (ré, ABS, airbag)'
  ],
  transmissao: [
    'Tranco ao engatar marcha (D, R ou trocas)',
    'Marcha "escapando" ou pulando',
    'Demora para a marcha entrar (automático)',
    'Ruído ao pisar/soltar a embreagem',
    'Pedal de embreagem muito alto ou baixo',
    'Cheiro forte após arrancadas em subida',
    'Vazamento de óleo embaixo do câmbio',
    'Carro acelera mas não desenvolve (patinando)',
    'Luz da transmissão acesa',
    'Clack metálico em curvas (homocinética)'
  ],
  arrefecimento: [
    'Ponteiro de temperatura subindo acima do normal',
    'Vapor saindo do capô',
    'Nível de água do reservatório baixando rápido',
    'Ventoinha ligada por muito tempo',
    'Cheiro adocicado (aditivo) no motor',
    'Calefação não esquenta',
    'Manchas verdes/rosa/laranja embaixo do carro',
    'Mangueira do radiador estourada ou inchada',
    'Motor superaquece só em trânsito parado',
    'Reservatório fervendo ao desligar'
  ]
};

export const rotulosZona: Record<string, string> = Object.fromEntries(
  Object.values(zonasCatalogo).map((z) => [z.id, z.label])
);
