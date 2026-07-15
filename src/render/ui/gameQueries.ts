/**
 * Lecturas derivadas del estado para la legibilidad del HUD (franja de
 * estado, informe del turno). Puras, de solo lectura — nunca mutan
 * GameState. Viven en la UI (no en /core) porque son vistas de
 * presentación, no reglas de simulación.
 */
import {
  armiesOf, foodConsumption, foodProduction, manpowerCap, manpowerGain, provincesOf, taxIncome,
  upkeepCost,
} from '../../core/systems/economy';
import type {
  Army, FactionId, GameState, Province, ProvinceId, Season,
} from '../../core/types';

// ---------- economía del turno (desglose real, mismas fórmulas del núcleo) ----------

export interface EconomyBreakdown {
  income: number;
  upkeep: number;
  foodProd: number;
  foodCons: number;
  manpowerGain: number;
  manpowerCap: number;
  provinceCount: number;
  unitCount: number;
}

export function computeEconomyBreakdown(
  state: GameState, factionId: FactionId, season: Season,
): EconomyBreakdown {
  const unitCount = armiesOf(state, factionId).reduce((sum, a) => sum + a.units.length, 0);
  return {
    income: taxIncome(state, factionId, season),
    upkeep: upkeepCost(state, factionId),
    foodProd: foodProduction(state, factionId, season),
    foodCons: foodConsumption(state, factionId),
    manpowerGain: manpowerGain(state, factionId),
    manpowerCap: manpowerCap(state, factionId),
    provinceCount: provincesOf(state, factionId).length,
    unitCount,
  };
}

// ---------- huestes con movimiento sin gastar ----------

export function idleArmies(state: GameState): Army[] {
  const playerId = state.playerFactionId;
  return Object.values(state.armies).filter(a => a.factionId === playerId && a.movement > 0);
}

// ---------- amenazas: ejércitos enemigos junto a provincias propias ----------

export interface ThreatEntry {
  provinceId: ProvinceId;
  provinceName: string;
  enemyArmy: Army;
}

function atWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(
    w => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

function menIn(army: Army): number {
  return army.units.reduce((sum, u) => sum + u.men, 0);
}

/** Una entrada por provincia propia amenazada (la hueste enemiga más fuerte cerca). */
export function computeThreats(state: GameState): ThreatEntry[] {
  const playerId = state.playerFactionId;
  const byId = new Map<ProvinceId, Province>(state.provinces.map(p => [p.id, p]));
  const enemyArmies = Object.values(state.armies).filter(
    a => a.factionId !== playerId && atWar(state, playerId, a.factionId),
  );
  if (enemyArmies.length === 0) return [];

  const entries: ThreatEntry[] = [];
  for (const province of state.provinces) {
    if (province.ownerId !== playerId) continue;
    let worst: Army | null = null;
    for (const army of enemyArmies) {
      const armyProvince = byId.get(army.provinceId);
      if (!armyProvince) continue;
      const adjacent = armyProvince.id === province.id || province.neighbors.includes(armyProvince.id);
      if (!adjacent) continue;
      if (!worst || menIn(army) > menIn(worst)) worst = army;
    }
    if (worst) entries.push({ provinceId: province.id, provinceName: province.name, enemyArmy: worst });
  }
  return entries;
}

// ---------- sucesión ----------

/** true si el gobernante no tiene un heredero vivo listo para el trono. */
export function successionAtRisk(state: GameState): boolean {
  const faction = state.factions[state.playerFactionId];
  if (!faction || !faction.alive) return false;
  if (faction.heirId && state.characters[faction.heirId]?.alive) return false;
  return true;
}
