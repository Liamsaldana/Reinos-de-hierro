/**
 * Culturas y religiones (GDD §2.2–2.3). Fase 3 (GDD §2.2, §2.4): entran las
 * 5 culturas completas — aurelios, norlander y estepara (v1) más sarradio y
 * highland, que ya tienen casa jugable propia (ver content/newGame.ts) — y
 * las 3 religiones mayores.
 * AGENTE T: banco de culturas cerrado en 5. MANTÉN las firmas exportadas.
 */
import type { CultureId, ReligionId } from '../types';

export interface CultureDef {
  id: CultureId;
  name: string;
  blurb: string;       // rasgo identitario, 1 línea
  /** multiplicadores suaves (1 = neutro) */
  taxMod: number;
  attackMod: number;
  cavalryMod: number;
}

export interface ReligionDef {
  id: ReligionId;
  name: string;
  blurb: string;
}

export const CULTURES: Record<CultureId, CultureDef> = {
  aurelios: {
    id: 'aurelios',
    name: 'Aurelios',
    blurb: 'Herederos de la legitimidad imperial: administración firme, impuestos disciplinados y fe en la ley.',
    taxMod: 1.15,
    attackMod: 1.0,
    cavalryMod: 1.0,
  },
  norlander: {
    id: 'norlander',
    name: 'Norlander',
    blurb: 'Guerreros del norte curtidos en la incursión: moral inquebrantable y furia ofensiva en la carga.',
    taxMod: 1.0,
    attackMod: 1.15,
    cavalryMod: 1.0,
  },
  estepara: {
    id: 'estepara',
    name: 'Estepara',
    blurb: 'Jinetes de horizonte infinito: movilidad y caballería sin igual en todo Valdemar.',
    taxMod: 1.0,
    attackMod: 1.0,
    cavalryMod: 1.25,
  },
  sarradio: {
    id: 'sarradio',
    name: 'Sarradio',
    blurb: 'Mercaderes y sabios del litoral levantino: caravanas, bibliotecas y una balanza que rinde más oro que la lanza.',
    taxMod: 1.1,
    attackMod: 0.95,
    cavalryMod: 1.0,
  },
  highland: {
    id: 'highland',
    name: 'Highland',
    blurb: 'Clanes de las tierras altas: ceden poco y tarde, atrincherados en el desfiladero que conocen palmo a palmo.',
    taxMod: 0.95,
    // no es más agresivo: es un pueblo que vende cara cada cuesta y cada muro — el número
    // premia la tenacidad defensiva del clan, no la carga (coherente con GDD §2.2: "defensa/terreno").
    attackMod: 1.05,
    // terreno de montaña, pocos pastos: la caballería highland nunca fue su fuerte.
    cavalryMod: 0.9,
  },
};

export const RELIGIONS: Record<ReligionId, ReligionDef> = {
  aureismo: {
    id: 'aureismo',
    name: 'La Luz Solar',
    blurb: 'Fe monoteísta y jerárquica que bendice la legitimidad de los tronos y puede llamar a cruzadas.',
  },
  viejos_pactos: {
    id: 'viejos_pactos',
    name: 'Los Viejos Pactos',
    blurb: 'Panteón animista y descentralizado de norlanders y esteparios que favorece la guerra y la incursión.',
  },
  calculo: {
    id: 'calculo',
    name: 'El Cálculo',
    blurb: 'Fe filosófico-mercantil que venera el conocimiento y el equilibrio, y premia ciencia y comercio.',
  },
} as Record<ReligionId, ReligionDef>;
