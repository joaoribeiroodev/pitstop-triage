import { TipoTransmissao } from '@models/veiculo.model';

export type ZonaId = 'motor' | 'freios' | 'suspensao' | 'eletrica' | 'transmissao' | 'arrefecimento';

export interface ZonaMeta {
  id: ZonaId;
  label: string;
  icone: string;
  descricao: string;
  sistemas: string[];
}

export interface SintomaDef {
  texto: string;
  /** Se omitido, aplica a qualquer tipo de transmissão. */
  aplicavelA?: TipoTransmissao[];
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

export const sintomasCatalogoPorZona: Record<ZonaId, SintomaDef[]> = {
  motor: [
    { texto: 'Marcha lenta instável ou apagando' },
    { texto: 'Motor falhando ou tremendo parado' },
    { texto: 'Perda de potência em subidas ou ao acelerar' },
    { texto: 'Luz de injeção (engine) acesa' },
    { texto: 'Estouros no escapamento' },
    { texto: 'Cheiro de queimado vindo do cofre' },
    { texto: 'Consumo de combustível aumentou muito' },
    { texto: 'Fumaça branca/azul/preta saindo do escape' },
    { texto: 'Ruído metálico ao acelerar' },
    { texto: 'Motor demora a pegar pela manhã' }
  ],
  freios: [
    { texto: 'Chiado agudo ao frear' },
    { texto: 'Ronco grave ao frear' },
    { texto: 'Pedal do freio muito baixo ou afundando' },
    { texto: 'Pedal duro, difícil de pressionar' },
    { texto: 'Volante vibra durante a frenagem' },
    { texto: 'Carro puxa para um lado ao frear' },
    { texto: 'Luz de freio ou ABS acesa no painel' },
    { texto: 'Cheiro de queimado após descidas' },
    { texto: 'Trepidação no pedal em frenagens fortes' },
    { texto: 'Pisca alerta liga sozinho em frenagem brusca (BAS)' }
  ],
  suspensao: [
    { texto: 'Batida seca ao passar em buracos' },
    { texto: 'Rangido ao passar em lombadas' },
    { texto: 'Carro balança demais em curvas' },
    { texto: 'Pneu desgastando irregularmente' },
    { texto: 'Direção pesada ou puxando para um lado' },
    { texto: 'Volante folgado ou com retorno ruim' },
    { texto: 'Estalos ao esterçar parado' },
    { texto: 'Carro "rebola" após buraco (perde firmeza)' },
    { texto: 'Altura do veículo desigual' },
    { texto: 'Tremor no volante em alta velocidade' }
  ],
  eletrica: [
    { texto: 'Dificuldade ou demora para dar partida' },
    { texto: 'Carro não dá partida (só estala)' },
    { texto: 'Faróis fracos ou oscilando' },
    { texto: 'Painel apaga ou pisca sozinho' },
    { texto: 'Vidros, travas ou retrovisores falhando' },
    { texto: 'Bateria descarrega com frequência' },
    { texto: 'Luz de bateria acesa no painel' },
    { texto: 'Cheiro de fio queimado' },
    { texto: 'Multimídia/rádio reiniciando sozinha' },
    { texto: 'Sensores intermitentes (ré, ABS, airbag)' }
  ],
  transmissao: [
    { texto: 'Tranco ao engatar marcha (D, R ou trocas)' },
    { texto: 'Marcha "escapando" ou pulando' },
    { texto: 'Demora para a marcha entrar (automático)' },
    {
      texto: 'Ruído ao pisar/soltar a embreagem',
      aplicavelA: ['manual', 'automatico_embreagem']
    },
    {
      texto: 'Pedal de embreagem muito alto ou baixo',
      aplicavelA: ['manual', 'automatico_embreagem']
    },
    { texto: 'Cheiro forte após arrancadas em subida' },
    { texto: 'Vazamento de óleo embaixo do câmbio' },
    {
      texto: 'Carro acelera mas não desenvolve (patinando)',
      aplicavelA: ['manual', 'automatico_embreagem']
    },
    { texto: 'Luz da transmissão acesa' },
    { texto: 'Clack metálico em curvas (homocinética)' }
  ],
  arrefecimento: [
    { texto: 'Ponteiro de temperatura subindo acima do normal' },
    { texto: 'Vapor saindo do capô' },
    { texto: 'Nível de água do reservatório baixando rápido' },
    { texto: 'Ventoinha ligada por muito tempo' },
    { texto: 'Cheiro adocicado (aditivo) no motor' },
    { texto: 'Calefação não esquenta' },
    { texto: 'Manchas verdes/rosa/laranja embaixo do carro' },
    { texto: 'Mangueira do radiador estourada ou inchada' },
    { texto: 'Motor superaquece só em trânsito parado' },
    { texto: 'Reservatório fervendo ao desligar' }
  ]
};

/** @deprecated Preferir listarSintomasPorZona para respeitar tipo de transmissão. */
export const sintomasPorZona: Record<ZonaId, string[]> = Object.fromEntries(
  Object.entries(sintomasCatalogoPorZona).map(([zona, defs]) => [zona, defs.map((d) => d.texto)])
) as Record<ZonaId, string[]>;

export function sintomaAplicavelAoVeiculo(
  sintoma: string,
  zona: ZonaId,
  tipoTransmissao?: TipoTransmissao
): boolean {
  const tipo = tipoTransmissao ?? 'desconhecido';
  if (tipo === 'desconhecido') return true;
  const def = sintomasCatalogoPorZona[zona]?.find((d) => d.texto === sintoma);
  if (!def?.aplicavelA) return true;
  return def.aplicavelA.includes(tipo);
}

export function listarSintomasPorZona(zona: ZonaId, tipoTransmissao?: TipoTransmissao): string[] {
  const defs = sintomasCatalogoPorZona[zona] ?? [];
  const tipo = tipoTransmissao ?? 'desconhecido';
  if (tipo === 'desconhecido') return defs.map((d) => d.texto);
  return defs.filter((d) => !d.aplicavelA || d.aplicavelA.includes(tipo)).map((d) => d.texto);
}

export const rotulosZona: Record<string, string> = Object.fromEntries(
  Object.values(zonasCatalogo).map((z) => [z.id, z.label])
);
