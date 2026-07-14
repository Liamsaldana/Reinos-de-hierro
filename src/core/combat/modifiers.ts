/**
 * Helpers internos de auto-resolución (GDD §8.4, §7.1). Puros, sin mutar
 * estado ni consumir Rng — todo lo aleatorio se resuelve en autoresolve.ts
 * pasando el `roll` ya sacado del Rng recibido. Interno al módulo de combate;
 * no forma parte del contrato público (no lo importan otros agentes).
 */
import type { Faction, Season, Terrain, UnitCategory } from '../types';
import { CULTURES } from '../content/cultures';

export type Weather = 'lluvia' | 'nieve' | 'niebla' | 'despejado';

/** Tira el clima de la estación a partir de un roll [0,1) ya sacado del Rng. */
export function rollWeather(season: Season, roll: number): Weather {
  switch (season) {
    case 0: // primavera: lluvia 35% | despejado
      return roll < 0.35 ? 'lluvia' : 'despejado';
    case 1: // verano: despejado 70% | niebla 30%
      return roll < 0.70 ? 'despejado' : 'niebla';
    case 2: // otoño: lluvia 45% | niebla 15% | despejado
      if (roll < 0.45) return 'lluvia';
      if (roll < 0.60) return 'niebla';
      return 'despejado';
    case 3: // invierno: nieve 60% | despejado
      return roll < 0.60 ? 'nieve' : 'despejado';
    default:
      return 'despejado';
  }
}

export interface WeatherEffect {
  /** multiplicador sobre rangedPower en la fórmula de potencia */
  rangedMod: number;
  /** multiplicador sobre la RATIO de moral efectiva (solo afecta el cálculo de fuerza) */
  moraleMod: number;
  /** niebla anula el bono de flanqueo estepario */
  steppeFlankNullified: boolean;
}

export function weatherEffect(weather: Weather): WeatherEffect {
  switch (weather) {
    case 'lluvia': return { rangedMod: 0.65, moraleMod: 1, steppeFlankNullified: false };
    case 'niebla': return { rangedMod: 0.50, moraleMod: 1, steppeFlankNullified: true };
    case 'nieve': return { rangedMod: 0.70, moraleMod: 0.9, steppeFlankNullified: false };
    case 'despejado': return { rangedMod: 1, moraleMod: 1, steppeFlankNullified: false };
  }
}

export interface TerrainSideMods {
  /** bosque: aporte de unidades de caballería ×este factor (ambos bandos) */
  cavalryCategoryMod: number;
  /** bosque: aporte de unidades a distancia ×este factor (ambos bandos) */
  rangedCategoryMod: number;
  /** estepa (sin niebla): aporte de caballería ×este factor (ambos bandos) */
  steppeCavalryMod: number;
  /** pantano: fuerza total del atacante ×este factor */
  attackerTotalMod: number;
  /** montaña/colina: fuerza total del defensor ×este factor */
  defenderTotalMod: number;
}

export function terrainMods(terrain: Terrain, weather: Weather): TerrainSideMods {
  const w = weatherEffect(weather);
  const isForest = terrain === 'forest';
  const isSteppe = terrain === 'steppe';
  return {
    cavalryCategoryMod: isForest ? 0.65 : 1,
    rangedCategoryMod: isForest ? 0.80 : 1,
    steppeCavalryMod: isSteppe && !w.steppeFlankNullified ? 1.2 : 1,
    attackerTotalMod: terrain === 'swamp' ? 0.85 : 1,
    defenderTotalMod: terrain === 'mountain' ? 1.3 : terrain === 'hills' ? 1.18 : 1,
  };
}

/** attackMod cultural de una facción; 1 si el banco de culturas está vacío (stub en paralelo). */
export function culturalAttackMod(faction: Faction | undefined): number {
  if (!faction) return 1;
  return CULTURES[faction.cultureId]?.attackMod ?? 1;
}

export interface SquadPowerInput {
  attack: number; defense: number; armor: number; rangedPower: number;
  men: number; menMax: number; xp: number; morale: number; moraleMax: number;
  category: UnitCategory;
  weather: WeatherEffect;
  terrain: TerrainSideMods;
  cultureMod: number;
}

/** Potencia de un pelotón (misma fórmula base que armyStrength, con ajustes de clima/terreno). */
export function squadPower(i: SquadPowerInput): number {
  if (i.men <= 0 || i.menMax <= 0) return 0;
  const ranged = i.rangedPower * i.weather.rangedMod;
  const base = (i.attack + i.defense) / 2 + ranged * 0.4 + i.armor * 0.5;
  const moraleRatio = i.moraleMax > 0
    ? Math.max(0, Math.min(1, (i.morale / i.moraleMax) * i.weather.moraleMod))
    : 0;
  let scaled = base * (i.men / i.menMax) * (1 + i.xp * 0.1) * (0.5 + 0.5 * moraleRatio);
  scaled *= i.cultureMod;
  if (i.category === 'cavalry') scaled *= i.terrain.cavalryCategoryMod * i.terrain.steppeCavalryMod;
  if (i.category === 'ranged') scaled *= i.terrain.rangedCategoryMod;
  return Math.max(0, scaled);
}

export const ZERO_CATEGORIES: Record<UnitCategory, number> = {
  infantry: 0, cavalry: 0, ranged: 0, spear: 0, siege: 0,
};

/** Fracción (en hombres) de cada categoría dentro del total del bando. */
export function categoryFractions(
  menByCategory: Record<UnitCategory, number>, totalMen: number,
): Record<UnitCategory, number> {
  if (totalMen <= 0) return { ...ZERO_CATEGORIES };
  const out = { ...ZERO_CATEGORIES };
  (Object.keys(out) as UnitCategory[]).forEach((c) => { out[c] = menByCategory[c] / totalMen; });
  return out;
}

/**
 * Contadores del triángulo (GDD §7.1), aplicados como ajuste a la fuerza
 * agregada por categoría de cada bando, usando la composición (en hombres)
 * del bando RIVAL.
 */
export function applyCounters(
  strA: Record<UnitCategory, number>, fracA: Record<UnitCategory, number>,
  strB: Record<UnitCategory, number>, fracB: Record<UnitCategory, number>,
): { a: Record<UnitCategory, number>; b: Record<UnitCategory, number> } {
  const a = { ...strA };
  const b = { ...strB };
  // lanceros anulan caballería rival
  a.cavalry *= (1 - 0.5 * fracB.spear);
  b.cavalry *= (1 - 0.5 * fracA.spear);
  // mucha caballería propia castiga al ranged rival
  if (fracA.cavalry > 0.25) b.ranged *= 0.75;
  if (fracB.cavalry > 0.25) a.ranged *= 0.75;
  // mucho ranged propio castiga a la infantería rival
  if (fracA.ranged > 0.30) b.infantry *= 0.85;
  if (fracB.ranged > 0.30) a.infantry *= 0.85;
  return { a, b };
}

export function sumCategories(r: Record<UnitCategory, number>): number {
  return r.infantry + r.cavalry + r.ranged + r.spear + r.siege;
}

/** Bono de general: martial + rasgos 'genio'/'valiente'. */
export function generalMultiplier(martial: number, traits: string[]): number {
  let m = 1 + martial * 0.03;
  if (traits.includes('genio')) m += 0.05;
  if (traits.includes('valiente')) m += 0.03;
  return m;
}

/**
 * Reparte `total` bajas entre pelotones proporcionalmente a sus hombres
 * (floor), garantizando al menos 1 baja en pelotones grandes (≥20 hombres)
 * cuando el reparto proporcional redondeó a 0 y aún queda cupo.
 */
export function distributeCasualties(units: { men: number }[], total: number): number[] {
  const totalMen = units.reduce((s, u) => s + u.men, 0);
  if (totalMen <= 0 || total <= 0) return units.map(() => 0);
  const result = units.map((u) => Math.floor(total * (u.men / totalMen)));
  let assigned = result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < units.length && assigned < total; i++) {
    if (result[i] === 0 && units[i].men >= 20) {
      result[i] = 1;
      assigned++;
    }
  }
  for (let i = 0; i < units.length; i++) {
    if (result[i] > units[i].men) result[i] = units[i].men;
  }
  return result;
}

export function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
