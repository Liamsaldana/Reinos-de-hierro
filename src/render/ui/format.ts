/**
 * Diccionarios y helpers de presentación en español. Vive aquí (no en /core)
 * porque es puramente cosmético — el core no sabe de idiomas ni de texto UI.
 */
import type {
  CasusBelli, ChronicleKind, CultureId, GameState, Province, Terrain, UnitCategory,
} from '../../core/types';

export const TERRAIN_ES: Record<Terrain, string> = {
  plains: 'Llanura',
  hills: 'Colinas',
  mountain: 'Montaña',
  forest: 'Bosque',
  swamp: 'Pantano',
  coast: 'Costa',
  steppe: 'Estepa',
  desert: 'Desierto',
};

export const SETTLEMENT_LEVEL_ES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Aldea',
  2: 'Pueblo',
  3: 'Ciudad',
  4: 'Capital',
};

export const FORT_LEVEL_ES: Record<0 | 1 | 2 | 3, string> = {
  0: 'Sin muro',
  1: 'Empalizada',
  2: 'Muralla',
  3: 'Ciudadela',
};

export const UNIT_CATEGORY_ES: Record<UnitCategory, string> = {
  infantry: 'Infantería',
  cavalry: 'Caballería',
  ranged: 'A distancia',
  spear: 'Lanceros',
  siege: 'Asedio',
};

/**
 * Nombres de cultura de reserva (GDD §2.2). El banco de contenido real vive en
 * core/content/cultures.ts (CULTURES); mientras esté vacío (stub en paralelo)
 * usamos esto para no dejar la UI en blanco. Si CULTURES trae datos, se prefieren.
 */
export const CULTURE_ES_FALLBACK: Record<CultureId, string> = {
  aurelios: 'Aurelios',
  norlander: 'Norlander',
  estepara: 'Estepara',
  sarradio: 'Sarradio',
  highland: 'Highland',
};

export const CASUS_BELLI_ES: Record<CasusBelli, string> = {
  reclamo: 'Reclamo',
  religioso: 'Religioso',
  sin_causa: 'Sin más causa que la ambición',
};

export const CHRONICLE_ICON: Record<ChronicleKind, string> = {
  guerra: '⚔',
  batalla: '🛡',
  dinastia: '♛',
  economia: '⛁',
  mundo: '✦',
};

export function ownerLabel(state: GameState, province: Province): string {
  if (!province.ownerId) return 'Tierra sin señor';
  const f = state.factions[province.ownerId];
  if (!f) return 'Tierra sin señor';
  return `${f.dynastyName} · ${f.name}`;
}

export function settlementLabel(p: Province): string {
  return `${SETTLEMENT_LEVEL_ES[p.settlement.level]} — ${p.settlement.name}`;
}

export function fortLabel(p: Province): string {
  return FORT_LEVEL_ES[p.settlement.fortLevel];
}

/** ¿La facción posee alguna provincia con el recurso estratégico dado? */
export function factionHasResource(state: GameState, factionId: string, resource: 'iron' | 'horses'): boolean {
  return state.provinces.some(p => p.ownerId === factionId && p[resource]);
}
