/**
 * Banco de unidades v1 (GDD §7): 5 categorías × 2 niveles + 1 única por cultura
 * jugable (13 unidades). Balance del triángulo de contadores (GDD §7.1):
 * lanza > caballo > arco > infantería > lanza.
 *
 * La ventaja de categoría (p.ej. lanceros vs caballería) la aplica el motor
 * de combate (agente D) leyendo `category`; aquí solo fijamos los números
 * base que dan sabor a cada arquetipo: lanza/piquero = mucha defensa
 * (frena la carga), caballería = ataque y velocidad altos (rompe líneas),
 * a distancia = rangedPower alto (castiga infantería), infantería = stats
 * parejos y sólidos (aguanta la línea de lanza a base de número y moral).
 *
 * armor se mantiene en la banda baja (0–10, ver contrato en types.ts) aunque
 * el resto de stats use 1–20; el resto de campos sí recorre 1–20.
 */
import type { CultureId, UnitType, UnitTypeId } from '../types';

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  // ---------- genéricas: infantería ----------
  milicia: {
    id: 'milicia', name: 'Milicia Campesina', category: 'infantry', tier: 1, culture: null,
    attack: 4, defense: 4, armor: 1, rangedPower: 0, initiative: 8, speed: 6,
    moraleMax: 8, menMax: 100,
    cost: { gold: 15, manpower: 100 }, upkeep: 1,
  },
  infanteria_escudo: {
    id: 'infanteria_escudo', name: 'Infantería de Escudo', category: 'infantry', tier: 2, culture: null,
    attack: 7, defense: 11, armor: 4, rangedPower: 0, initiative: 8, speed: 5,
    moraleMax: 10, menMax: 100,
    cost: { gold: 32, manpower: 100, iron: 1 }, upkeep: 2,
  },

  // ---------- genéricas: lanza (anti-caballería) ----------
  lanceros: {
    id: 'lanceros', name: 'Lanceros', category: 'spear', tier: 1, culture: null,
    attack: 5, defense: 9, armor: 2, rangedPower: 0, initiative: 9, speed: 6,
    moraleMax: 9, menMax: 100,
    cost: { gold: 18, manpower: 100 }, upkeep: 1,
  },
  piqueros: {
    id: 'piqueros', name: 'Piqueros', category: 'spear', tier: 2, culture: null,
    attack: 7, defense: 14, armor: 3, rangedPower: 0, initiative: 8, speed: 5,
    moraleMax: 10, menMax: 100,
    cost: { gold: 36, manpower: 100, iron: 1 }, upkeep: 2,
  },

  // ---------- genéricas: a distancia ----------
  arqueros: {
    id: 'arqueros', name: 'Arqueros', category: 'ranged', tier: 1, culture: null,
    attack: 3, defense: 3, armor: 0, rangedPower: 12, initiative: 12, speed: 6,
    moraleMax: 8, menMax: 100,
    cost: { gold: 22, manpower: 100 }, upkeep: 1,
  },
  ballesteros: {
    id: 'ballesteros', name: 'Ballesteros', category: 'ranged', tier: 2, culture: null,
    // rangedPower muy alto pero initiative baja: la ballesta pega fuerte y tarda en recargar.
    attack: 4, defense: 4, armor: 2, rangedPower: 17, initiative: 5, speed: 5,
    moraleMax: 9, menMax: 100,
    cost: { gold: 38, manpower: 100, iron: 1 }, upkeep: 2,
  },

  // ---------- genéricas: caballería ----------
  jinetes: {
    id: 'jinetes', name: 'Jinetes', category: 'cavalry', tier: 1, culture: null,
    attack: 8, defense: 5, armor: 2, rangedPower: 0, initiative: 11, speed: 14,
    moraleMax: 10, menMax: 100,
    cost: { gold: 30, manpower: 100, horses: 1 }, upkeep: 2,
  },
  caballeria_choque: {
    id: 'caballeria_choque', name: 'Caballería de Choque', category: 'cavalry', tier: 2, culture: null,
    attack: 17, defense: 7, armor: 5, rangedPower: 0, initiative: 10, speed: 12,
    moraleMax: 11, menMax: 100,
    cost: { gold: 58, manpower: 100, iron: 1, horses: 1 }, upkeep: 3,
  },

  // ---------- genéricas: asedio (casi nulas en campo abierto) ----------
  ariete: {
    id: 'ariete', name: 'Ariete', category: 'siege', tier: 1, culture: null,
    attack: 2, defense: 2, armor: 3, rangedPower: 0, initiative: 2, speed: 2,
    moraleMax: 8, menMax: 50,
    cost: { gold: 40, manpower: 50 }, upkeep: 2,
  },
  catapulta: {
    id: 'catapulta', name: 'Catapulta', category: 'siege', tier: 2, culture: null,
    attack: 1, defense: 1, armor: 2, rangedPower: 10, initiative: 1, speed: 1,
    moraleMax: 8, menMax: 50,
    cost: { gold: 68, manpower: 50 }, upkeep: 3,
  },

  // ---------- únicas culturales (tier 2) ----------
  legionarios_aurelios: {
    id: 'legionarios_aurelios', name: 'Legionarios Aurelios', category: 'infantry', tier: 2, culture: 'aurelios',
    // defensa y armadura más altas del banco: infantería pesada de escudo, sabor imperial.
    attack: 8, defense: 15, armor: 8, rangedPower: 0, initiative: 8, speed: 5,
    moraleMax: 12, menMax: 100,
    cost: { gold: 42, manpower: 100, iron: 1 }, upkeep: 3,
  },
  asaltantes_norlander: {
    id: 'asaltantes_norlander', name: 'Asaltantes Norlander', category: 'infantry', tier: 2, culture: 'norlander',
    // ataque más alto del banco entero, armadura muy baja: furia de incursión.
    attack: 18, defense: 5, armor: 1, rangedPower: 0, initiative: 13, speed: 8,
    moraleMax: 11, menMax: 100,
    cost: { gold: 36, manpower: 100 }, upkeep: 2,
  },
  arqueros_caballo_estepara: {
    id: 'arqueros_caballo_estepara', name: 'Arqueros a Caballo Esteparios', category: 'cavalry', tier: 2, culture: 'estepara',
    attack: 6, defense: 4, armor: 1, rangedPower: 15, initiative: 14, speed: 15,
    moraleMax: 10, menMax: 100,
    cost: { gold: 48, manpower: 100, horses: 1 }, upkeep: 3,
  },
};

export function getUnitType(id: UnitTypeId): UnitType {
  const t = UNIT_TYPES[id];
  if (!t) throw new Error(`UnitType desconocido: ${id}`);
  return t;
}

/** Unidades reclutables por una cultura (genéricas + propias). */
export function unitTypesFor(cultureId: CultureId): UnitType[] {
  return Object.values(UNIT_TYPES).filter(u => u.culture === null || u.culture === cultureId);
}
