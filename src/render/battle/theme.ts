/**
 * Dirección de arte LOCAL de la escena de batalla: "mesa de guerra" cartográfica,
 * coherente con el mapa 3D (pergamino / hierro / sangre apagada, SIN neón ni glow).
 * Autoridad de color local del renderer de batalla; no toca el contrato del core.
 * (No importa de render/world ni render/ui: los tokens se replican aquí a propósito.)
 */
import type { Terrain, UnitCategory } from '../../core/types';
import type { Formation, TacticalTerrain, TacticalUnit } from '../../core/tactical/types';
import { getUnitType } from '../../core/content/units';

/** color cartográfico por terreno táctico (HEX sRGB). */
export const TERRAIN_HEX: Record<TacticalTerrain, string> = {
  llano: '#8f8a5f',
  bosque: '#5c684a',
  colina: '#8a7c58',
  pantano: '#67705c',
  rio: '#3a5560',
  roca: '#6e6a66',
};

/** trazo de hierro para bordes de hex y fichas. */
export const STROKE_HEX = '#1B1716';
/** relleno de unidad de guarnición neutral (sin señor). */
export const NEUTRAL_UNIT_HEX = '#55504a';
/** glifo de bosque (arbolado). */
export const FOREST_GLYPH = '♣';

/** glifo por categoría de unidad. */
export const CATEGORY_GLYPH: Record<UnitCategory, string> = {
  infantry: '⚔',
  spear: '▲',
  ranged: '➶',
  cavalry: '♞',
  siege: '⚙',
};

/** tokens del HUD DOM (coherentes con la UI del juego). */
export const HUD = {
  bg: '#1B1716',
  panel: 'rgba(27,23,22,0.92)',
  panelSoft: 'rgba(27,23,22,0.78)',
  text: '#EDEBDE',
  textDim: 'rgba(237,235,222,0.62)',
  hairline: 'rgba(237,235,222,0.14)',
  accent: '#810100',
  parchment: '#EDE7D6',
  font: 'Georgia, "Times New Roman", serif',
} as const;

/** colores auxiliares del lienzo (numéricos para Phaser). */
export const CANVAS = {
  background: '#14110F',
  parchment: 0xede7d6,
  stroke: 0x1b1716,
  targetRing: 0x810100,
  activeRing: 0xede7d6,
  menBar: 0xc9b782,
  moraleHigh: 0x6f7a4f,
  moraleLow: 0x9c3a2f,
  barBack: 0x120f0e,
  rain: 0x9fb2b8,
  snow: 0xede7d6,
  fog: 0x8a8f92,
  casualty: 0xd8b48a,
} as const;

/** nombre en español de la formación. */
export const FORMATION_ES: Record<Formation, string> = {
  linea: 'Línea',
  muro_escudos: 'Muro de escudos',
  cuna: 'Cuña',
  dispersa: 'Dispersa',
};

/** efecto narrado de cada formación (tooltip). */
export const FORMATION_FX: Record<Formation, string> = {
  linea: 'Línea: formación equilibrada, sin bonos ni penas.',
  muro_escudos: 'Muro de escudos: +defensa frontal, −movilidad.',
  cuna: 'Cuña: +ímpetu de carga de caballería, −defensa de flanco.',
  dispersa: 'Dispersa: −daño de proyectiles recibido, −cohesión en melee.',
};

/** ciclo de formaciones para el botón de la botonera. */
export const FORMATION_ORDER: Formation[] = ['linea', 'muro_escudos', 'cuna', 'dispersa'];

/** nombre en español del terreno estratégico (banda superior). */
export const STRAT_TERRAIN_ES: Record<Terrain, string> = {
  plains: 'Llanura',
  hills: 'Colinas',
  mountain: 'Montaña',
  forest: 'Bosque',
  swamp: 'Pantano',
  coast: 'Costa',
  steppe: 'Estepa',
  desert: 'Desierto',
};

/** capitaliza y limpia el texto de clima que viene del core. */
export function weatherEs(w: string): string {
  if (!w) return 'Despejado';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** categoría de una unidad táctica (via banco de contenido; robusto ante stubs). */
export function categoryOf(u: TacticalUnit): UnitCategory {
  try {
    return getUnitType(u.typeId).category;
  } catch {
    return 'infantry';
  }
}

/** glifo de categoría de la unidad. */
export function glyphOf(u: TacticalUnit): string {
  return CATEGORY_GLYPH[categoryOf(u)];
}

/** '#rrggbb' → 0xrrggbb para Phaser. */
export function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) >>> 0;
}

/** luminancia relativa aproximada de un HEX (0..1). */
export function luminance(hex: string): number {
  const n = hexToNum(hex);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.114 * b;
}

/** mezcla un color numérico hacia el blanco por amt (0..1). */
export function lightenNum(num: number, amt: number): number {
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const nr = Math.round(r + (255 - r) * amt);
  const ng = Math.round(g + (255 - g) * amt);
  const nb = Math.round(b + (255 - b) * amt);
  return ((nr << 16) | (ng << 8) | nb) >>> 0;
}

/** interpolación lineal entre dos colores numéricos (t 0..1). */
export function lerpNum(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return ((rr << 16) | (rg << 8) | rb) >>> 0;
}
