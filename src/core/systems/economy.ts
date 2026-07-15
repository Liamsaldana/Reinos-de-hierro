/**
 * Helpers de economía compartidos por actions.ts y turn.ts (GDD §5).
 * AGENTE A: módulo propio, no es un stub — libre de diseñar mientras
 * mantenga el resto del contrato del núcleo (sin Math.random/Date.now,
 * todo serializable, sin dependencias de render).
 *
 * AGENTE P (Fase 2, GDD §9.1/§11): sumó `buildingEffects` + los efectos de
 * edificios dentro de taxIncome/foodProduction/manpowerGain (sin tocar sus
 * firmas), y los nuevos exports researchIncome/legitimacyTick. El resto del
 * archivo es de AGENTE A.
 */
import type { Army, FactionId, GameState, Province, Season } from '../types';
import { getUnitType } from '../content/units';
import { BUILDINGS } from '../content/buildings';
// import perezoso a nivel de función (ciclo economy⇄research resuelto en runtime)
import { getTechModifiers } from './research';

/** Provincias que posee la facción. */
export function provincesOf(state: GameState, factionId: FactionId): Province[] {
  return state.provinces.filter(p => p.ownerId === factionId);
}

/** Ejércitos que pertenecen a la facción. */
export function armiesOf(state: GameState, factionId: FactionId): Army[] {
  return Object.values(state.armies).filter(a => a.factionId === factionId);
}

/** true si el reino posee al menos una provincia con el recurso estratégico dado. */
export function factionHasResource(
  state: GameState, factionId: FactionId, resource: 'iron' | 'horses',
): boolean {
  return provincesOf(state, factionId).some(p => p[resource]);
}

/** Efectos totales (GDD §9.1) de los edificios ya construidos en una provincia. */
export interface BuildingEffectsTotal {
  taxFlat: number;
  foodFlat: number;
  manpowerFlat: number;
  researchFlat: number;
  legitimacyFlat: number;
}

/** Suma los `effects` de cada edificio en `province.buildings` (banco: content/buildings.ts). */
export function buildingEffects(province: Province): BuildingEffectsTotal {
  const total: BuildingEffectsTotal = {
    taxFlat: 0, foodFlat: 0, manpowerFlat: 0, researchFlat: 0, legitimacyFlat: 0,
  };
  for (const id of province.buildings ?? []) {
    const def = BUILDINGS[id];
    if (!def) continue; // id desconocido (guardado viejo/edificio retirado): se ignora, no rompe
    total.taxFlat += def.effects.taxFlat ?? 0;
    total.foodFlat += def.effects.foodFlat ?? 0;
    total.manpowerFlat += def.effects.manpowerFlat ?? 0;
    total.researchFlat += def.effects.researchFlat ?? 0;
    total.legitimacyFlat += def.effects.legitimacyFlat ?? 0;
  }
  return total;
}

/** Ingresos de impuestos de la facción para la estación dada (GDD §5.2, turno). */
export function taxIncome(state: GameState, factionId: FactionId, season: Season): number {
  const seasonMod = season === 2 ? 1.25 : 1; // Otoño: cosecha/impuestos
  const base = provincesOf(state, factionId).reduce(
    (sum, p) => sum + p.baseTax * (p.settlement.level === 4 ? 1.3 : 1) + buildingEffects(p).taxFlat,
    0,
  );
  return base * seasonMod * getTechModifiers(state, factionId).taxMod;
}

/** Mantenimiento total de las tropas de la facción. */
export function upkeepCost(state: GameState, factionId: FactionId): number {
  let total = 0;
  for (const army of armiesOf(state, factionId)) {
    for (const u of army.units) {
      total += getUnitType(u.typeId).upkeep;
    }
  }
  return total;
}

/** Producción de alimento de la facción para la estación dada. */
export function foodProduction(state: GameState, factionId: FactionId, season: Season): number {
  const seasonMod = season === 2 ? 1.5 : season === 3 ? 0.5 : 1; // Otoño / Invierno
  const base = provincesOf(state, factionId).reduce(
    (sum, p) => sum + p.baseFood + buildingEffects(p).foodFlat,
    0,
  );
  return base * seasonMod * getTechModifiers(state, factionId).foodMod;
}

/** Consumo de alimento: hombres bajo armas + una unidad por provincia administrada. */
export function foodConsumption(state: GameState, factionId: FactionId): number {
  const men = armiesOf(state, factionId).reduce(
    (sum, a) => sum + a.units.reduce((s, u) => s + u.men, 0),
    0,
  );
  return men / 100 + provincesOf(state, factionId).length;
}

/** Ganancia bruta de levas (mano de obra) antes de aplicar el tope. */
export function manpowerGain(state: GameState, factionId: FactionId): number {
  const provinces = provincesOf(state, factionId);
  const base = provinces.reduce((sum, p) => sum + p.baseManpower, 0);
  const flat = provinces.reduce((sum, p) => sum + buildingEffects(p).manpowerFlat, 0);
  return Math.floor((Math.floor(base * 0.5) + flat) * getTechModifiers(state, factionId).manpowerMod);
}

/** Tope de la reserva de levas del reino. */
export function manpowerCap(state: GameState, factionId: FactionId): number {
  const base = provincesOf(state, factionId).reduce((sum, p) => sum + p.baseManpower, 0);
  return 20 * base;
}

/**
 * Investigación producida por el reino este turno (biblioteca, GDD §11).
 * economy.ts no sabe nada de árboles de tecnología: el agente de tech
 * consume este número y decide qué desbloquea.
 */
export function researchIncome(state: GameState, factionId: FactionId): number {
  const flat = provincesOf(state, factionId).reduce((sum, p) => sum + buildingEffects(p).researchFlat, 0);
  return 2 + flat;
}

/**
 * Delta de legitimidad por turno aportado por edificios (templo/corte, GDD
 * §9.1). Tope duro de +3/turno; además, la legitimidad que aportan los
 * edificios por sí sola no empuja el marcador más allá de 80 (blurb de
 * templo/corte: "tope +80 solo por edificios" — el resto, 80→100, se deja a
 * buen gobierno/decisiones de Fase 3). El integrador (turn.ts) debe sumar
 * el resultado a `faction.legitimacy` y volver a aplicar `clamp(0, 100)`,
 * igual que ya hace con el resto de ajustes de legitimidad.
 */
export function legitimacyTick(state: GameState, factionId: FactionId): number {
  const faction = state.factions[factionId];
  const flat = provincesOf(state, factionId).reduce((sum, p) => sum + buildingEffects(p).legitimacyFlat, 0);
  const capped = Math.min(3, flat);
  if (!faction) return Math.max(0, capped);
  const room = Math.max(0, 80 - faction.legitimacy);
  return Math.max(0, Math.min(capped, room));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
