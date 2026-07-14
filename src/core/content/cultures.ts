/**
 * Culturas y religiones v1 (GDD §2.2–2.3). Alcance v1: 3 de las 5 culturas
 * del GDD (aurelios, norlander, estepara — sarradio y highland entran en
 * Fase 3) y las 3 religiones mayores.
 * AGENTE B: reemplaza el contenido. MANTÉN las firmas exportadas.
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
} as Record<CultureId, CultureDef>;

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
