/**
 * Banco de unidades (GDD §7): 5 categorías × 2 niveles + 1–2 únicas por
 * cultura jugable. Fase 3 (GDD §2.2, §7.3) añade las 2 unidades de sarradio
 * y las 2 de highland, sumando 17 unidades. Balance del triángulo de
 * contadores (GDD §7.1): lanza > caballo > arco > infantería > lanza.
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
 *
 * NOTA para el integrador: `content/mythicUnits.ts` (Fase 3, capa mítica)
 * inyecta 'palido'/'engendro_de_escarcha' en `UNIT_TYPES` por efecto de
 * importación (ver ese archivo) — este módulo no los referencia ni depende
 * de ellos, pero cualquier cambio a la FORMA de `UNIT_TYPES`/`getUnitType`
 * rompería ese enganche.
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

  // ---------- Fase 3: sarradio (GDD §2.2, comercio/ciencia levantino) ----------
  lanceros_ligeros_sarradios: {
    id: 'lanceros_ligeros_sarradios', name: 'Lanceros Ligeros Sarradios', category: 'spear', tier: 1, culture: 'sarradio',
    // variante RÁPIDA del lancero genérico: menos asta/armadura que 'lanceros'
    // (defense 8 vs 9, armor 1 vs 2) a cambio de bastante más velocidad e
    // iniciativa (9/10 vs 6/9) — ancla la línea igual, pero además persigue.
    attack: 5, defense: 8, armor: 1, rangedPower: 0, initiative: 10, speed: 9,
    moraleMax: 9, menMax: 100,
    cost: { gold: 16, manpower: 100 }, upkeep: 1,
  },
  camelleros_sarradios: {
    id: 'camelleros_sarradios', name: 'Camelleros Sarradios', category: 'cavalry', tier: 2, culture: 'sarradio',
    // única sarradia: caballería de las rutas caravaneras, a lomos de camello,
    // no de caballo — por eso NO pide el recurso 'horses' (cost sin campo
    // horses/iron: monta y arreos ligeros, no herraje pesado). A cambio, un
    // animal así de raro en Valdemar sale caro: el oro sustituye al recurso
    // estratégico. Ataque por debajo de la caballería de choque (13 vs 17,
    // sin bono de hierro) pero con la misma independencia logística que hace
    // única a esta tropa: se recluta en cualquier provincia sarradia, tenga
    // o no caballos.
    attack: 13, defense: 6, armor: 3, rangedPower: 0, initiative: 11, speed: 13,
    moraleMax: 11, menMax: 100,
    cost: { gold: 66, manpower: 100 }, upkeep: 3,
  },

  // ---------- Fase 3: highland (GDD §2.2, defensa/terreno celta) ----------
  montaneses_highland: {
    id: 'montaneses_highland', name: 'Montañeses de Highland', category: 'spear', tier: 2, culture: 'highland',
    // única highland: lanza larga entre gargantas de montaña. Defensa 16 —
    // la más alta del banco (por encima de piqueros 14 y legionarios 15) —
    // expresa el "bono implícito de montaña" vía stats puros (no hay campo de
    // terreno por unidad en el contrato): junto al +30% de defensa que ya da
    // el terreno de montaña/colina en combat/modifiers.ts, un muro highland
    // en su propia tierra es brutal de romper. Lentos (speed 4): no persiguen,
    // resisten.
    attack: 7, defense: 16, armor: 4, rangedPower: 0, initiative: 7, speed: 4,
    moraleMax: 11, menMax: 100,
    cost: { gold: 40, manpower: 100, iron: 1 }, upkeep: 2,
  },
  honderos_highland: {
    id: 'honderos_highland', name: 'Honderos de Highland', category: 'ranged', tier: 1, culture: 'highland',
    // honda de pastor, no arco: rangedPower por debajo de 'arqueros' (9 vs 12)
    // pero mucho más BARATA (14 vs 22 de oro) — la tropa a distancia que
    // cualquier clan pobre de las tierras altas puede permitirse desde el
    // primer día.
    attack: 2, defense: 3, armor: 0, rangedPower: 9, initiative: 11, speed: 7,
    moraleMax: 8, menMax: 100,
    cost: { gold: 14, manpower: 100 }, upkeep: 1,
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
