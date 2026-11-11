/**
 * Zonas do veículo: o "onde dói no carro?" do PitStop Triage.
 * Cada zona corresponde a uma categoria do catálogo global de sintomas (mesmo código).
 */
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

export const ZONA_IDS = Object.keys(zonasCatalogo) as ZonaId[];

export function isZona(code: string | null | undefined): code is ZonaId {
  return !!code && code in zonasCatalogo;
}
