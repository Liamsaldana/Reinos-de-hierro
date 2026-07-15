/**
 * Construcción de edificios y mejora de fortificación (Fase 2, GDD §9.1-9.2).
 * AGENTE P: módulo nuevo, propiedad exclusiva.
 *
 * Una obra a la vez por provincia (`Province.buildQueue` es un único item,
 * no una lista — ver types.ts). La mejora de fortificación ('muralla_up',
 * WALL_UPGRADE_ID) es un pseudo-edificio que comparte la MISMA cola: no vive
 * en el banco `BUILDINGS` de content/buildings.ts ni se empuja jamás a
 * `province.buildings`; en su lugar, al completarse, sube
 * `settlement.fortLevel` (cap 3 = ciudadela). autoresolve.ts y factionAI.ts
 * ya leen `fortLevel` para el bono de defensa — no hace falta tocarlos.
 */
import type {
  BuildingId, FactionId, GameState, Province, ProvinceId,
} from '../types';
import {
  BUILDINGS, getBuilding, type BuildingDef, type BuildingRequires,
} from '../content/buildings';
import type { ActionResult } from './actions';

/** id reservado para la mejora de fortificación (pseudo-edificio, ver cabecera). */
export const WALL_UPGRADE_ID: BuildingId = 'muralla_up';

const FORT_NAMES = ['Sin muro', 'Empalizada', 'Muralla', 'Ciudadela'] as const;

/** coste/turnos de subir DESDE el nivel indicado (0, 1 o 2) al siguiente. */
const WALL_UPGRADE_COST: Record<0 | 1 | 2, { gold: number; turns: number }> = {
  0: { gold: 60, turns: 2 },
  1: { gold: 140, turns: 3 },
  2: { gold: 260, turns: 4 },
};

/** Ranuras de edificio de una provincia (GDD §9.1): crecen con el asentamiento. */
export function buildingSlots(province: Province): number {
  return 2 + province.settlement.level;
}

/** BuildingDef sintético para la mejora de fortificación, o null si ya está al máximo (ciudadela). */
function fortUpgradeDef(province: Province): BuildingDef | null {
  const level = province.settlement.fortLevel;
  if (level >= 3) return null;
  const cost = WALL_UPGRADE_COST[level as 0 | 1 | 2];
  const nextName = FORT_NAMES[level + 1];
  return {
    id: WALL_UPGRADE_ID,
    name: `Mejorar fortificación (${nextName})`,
    blurb: `Sube la fortificación de "${FORT_NAMES[level]}" a "${nextName}": más defensa en asedio y batalla.`,
    cost,
    effects: {},
  };
}

/** Motivos (en español) por los que `requires` no se cumple en `province` ahora mismo. */
function requirementReasons(province: Province, requires: BuildingRequires | undefined): string[] {
  if (!requires) return [];
  const reasons: string[] = [];
  if (requires.iron && !province.iron) reasons.push('Requiere una provincia con hierro.');
  if (requires.horses && !province.horses) reasons.push('Requiere una provincia con caballos.');
  if (requires.coast && province.terrain !== 'coast') reasons.push('Solo se puede construir en una provincia costera.');
  if (requires.capital && province.settlement.level !== 4) reasons.push('Solo se puede construir en la capital del reino.');
  if (requires.minSettlementLevel && province.settlement.level < requires.minSettlementLevel) {
    reasons.push(`Requiere un asentamiento de nivel ${requires.minSettlementLevel} o mayor.`);
  }
  return reasons;
}

function findProvince(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find(p => p.id === id);
}

/**
 * Edificios (y, si aplica, la mejora de fortificación) que se pueden EMPEZAR
 * a construir ahora mismo en esta provincia: sin duplicado, requisitos de
 * recurso/terreno/capital cumplidos, cola libre (una obra a la vez) y
 * ranuras disponibles. NO filtra por oro: igual que `unitTypesFor` con el
 * reclutamiento, esa comprobación (y su mensaje) vive en la UI y se
 * re-valida al cobrar en `startConstruction`.
 */
export function buildableIn(state: GameState, provinceId: ProvinceId): BuildingDef[] {
  const province = findProvince(state, provinceId);
  if (!province) return [];
  if (province.buildQueue) return []; // ya hay obra en curso: nada más es "construible ahora"

  const result: BuildingDef[] = [];
  const built = new Set(province.buildings ?? []);
  if (built.size < buildingSlots(province)) {
    for (const def of Object.values(BUILDINGS)) {
      if (built.has(def.id)) continue;
      if (requirementReasons(province, def.requires).length > 0) continue;
      result.push(def);
    }
  }
  const wall = fortUpgradeDef(province);
  if (wall) result.push(wall); // la fortificación no consume ranura de edificio
  return result;
}

/**
 * Empieza a construir `buildingId` (edificio real o WALL_UPGRADE_ID) en una
 * provincia propia: valida propiedad, cola libre, duplicado, ranuras,
 * requisitos y oro; si todo pasa, cobra y arma `buildQueue`.
 */
export function startConstruction(
  state: GameState, factionId: FactionId, provinceId: ProvinceId, buildingId: BuildingId,
): ActionResult {
  const faction = state.factions[factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };
  const province = findProvince(state, provinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };
  if (province.ownerId !== factionId) {
    return { ok: false, message: `No controlas ${province.name}: no puedes construir ahí.` };
  }
  if (province.buildQueue) {
    return { ok: false, message: `${province.name} ya tiene una obra en curso.` };
  }

  if (buildingId === WALL_UPGRADE_ID) {
    const wall = fortUpgradeDef(province);
    if (!wall) {
      return { ok: false, message: `${province.name} ya tiene la fortificación al máximo (ciudadela).` };
    }
    if (faction.gold < wall.cost.gold) {
      return {
        ok: false,
        message: `No hay oro suficiente para mejorar la fortificación: cuesta ${wall.cost.gold}, tienes ${faction.gold}.`,
      };
    }
    faction.gold -= wall.cost.gold;
    province.buildQueue = { buildingId: WALL_UPGRADE_ID, turnsLeft: wall.cost.turns };
    return {
      ok: true,
      message: `${province.name} empieza a levantar su ${FORT_NAMES[(province.settlement.fortLevel + 1)]} `
        + `(${wall.cost.turns} turnos).`,
    };
  }

  let def: BuildingDef;
  try {
    def = getBuilding(buildingId);
  } catch {
    return { ok: false, message: `Edificio desconocido: ${buildingId}.` };
  }

  const built = province.buildings ?? [];
  if (built.includes(buildingId)) {
    return { ok: false, message: `${province.name} ya tiene ${def.name}.` };
  }
  if (built.length >= buildingSlots(province)) {
    return { ok: false, message: `${province.name} no tiene ranuras de construcción libres.` };
  }
  const reasons = requirementReasons(province, def.requires);
  if (reasons.length > 0) {
    return { ok: false, message: reasons.join(' ') };
  }
  if (faction.gold < def.cost.gold) {
    return { ok: false, message: `No hay oro suficiente: cuesta ${def.cost.gold}, tienes ${faction.gold}.` };
  }

  faction.gold -= def.cost.gold;
  province.buildQueue = { buildingId, turnsLeft: def.cost.turns };
  return { ok: true, message: `${province.name} empieza a construir ${def.name} (${def.cost.turns} turnos).` };
}

/** Cancela la obra en curso de una provincia propia y devuelve el 50% del oro pagado. */
export function cancelConstruction(
  state: GameState, factionId: FactionId, provinceId: ProvinceId,
): ActionResult {
  const faction = state.factions[factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };
  const province = findProvince(state, provinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };
  if (province.ownerId !== factionId) {
    return { ok: false, message: `No controlas ${province.name}.` };
  }
  const queue = province.buildQueue;
  if (!queue) return { ok: false, message: `${province.name} no tiene obra en curso que cancelar.` };

  let paidGold = 0;
  if (queue.buildingId === WALL_UPGRADE_ID) {
    paidGold = fortUpgradeDef(province)?.cost.gold ?? 0;
  } else {
    try {
      paidGold = getBuilding(queue.buildingId).cost.gold;
    } catch {
      paidGold = 0;
    }
  }
  const refund = Math.floor(paidGold * 0.5);
  faction.gold += refund;
  province.buildQueue = null;

  return { ok: true, message: `Obra cancelada en ${province.name}: recuperas ${refund} de oro.` };
}

/**
 * Avanza toda obra en curso un turno (turnsLeft--). Al llegar a 0: los
 * edificios reales se empujan a `province.buildings`; la mejora de
 * fortificación sube `fortLevel` (cap 3). Registra crónica 'economia' y
 * devuelve mensajes en español SOLO para provincias del jugador (igual que
 * el resto del turno trata el ruido de la IA — ver turn.ts). Llamar una vez
 * por turno desde `endTurn` (turn.ts, otro agente): `tickConstruction(state)`.
 */
export function tickConstruction(state: GameState): string[] {
  const playerId = state.playerFactionId;
  const messages: string[] = [];

  for (const province of state.provinces) {
    const queue = province.buildQueue;
    if (!queue) continue;

    queue.turnsLeft -= 1;
    if (queue.turnsLeft > 0) continue;

    province.buildQueue = null;
    const isPlayer = province.ownerId === playerId;

    if (queue.buildingId === WALL_UPGRADE_ID) {
      const next = Math.min(3, province.settlement.fortLevel + 1) as 0 | 1 | 2 | 3;
      province.settlement.fortLevel = next;
      if (isPlayer) {
        const text = `${province.name} termina su ${FORT_NAMES[next]}.`;
        state.chronicle.push({ turn: state.turn, kind: 'economia', text });
        messages.push(text);
      }
      continue;
    }

    let def: BuildingDef | null = null;
    try { def = getBuilding(queue.buildingId); } catch { def = null; }
    if (!def) continue; // id desconocido (no debería pasar): descarta en silencio, sin romper el turno

    province.buildings ??= [];
    if (!province.buildings.includes(def.id)) province.buildings.push(def.id);

    if (isPlayer) {
      const text = `${def.name} terminado en ${province.name}.`;
      state.chronicle.push({ turn: state.turn, kind: 'economia', text });
      messages.push(text);
    }
  }

  return messages;
}
