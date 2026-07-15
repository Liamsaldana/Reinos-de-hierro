/**
 * Agentes v1 — espionaje (Fase 3, GDD §10 "poder blando": "Agentes:
 * diplomáticos, espías... para acciones encubiertas"). Dos acciones con
 * riesgo real de verdad: el sabotaje puede fallar Y costar opinión; el
 * espionaje de reconocimiento es la mitad "segura" (solo cuesta oro, siempre
 * informa). AGENTE U: módulo nuevo, propiedad exclusiva.
 *
 * Contrato con el resto del núcleo (mismo patrón que `diplomacy.ts`/
 * `trade.ts`): reutiliza `ActionResult` de `./actions`; duplica helpers
 * internos a propósito (cada módulo dueño de los suyos, sin acoplar agentes
 * en paralelo). Sin wiring para el integrador: ambas acciones son comandos
 * directos (como `recruitUnit`/`moveArmy`), no funciones puras de turno.
 */
import type {
  DiploRelation, FactionId, GameState, Province, ProvinceId,
} from '../types';
import { relKey, seasonOf, yearOf, SEASON_NAMES } from '../types';
import type { Rng } from '../state/rng';
import type { ActionResult } from './actions';
import { clamp } from './economy';
import { armyStrength } from '../combat/autoresolve';

// ---------- helpers internos (duplicados a propósito, ver docstring) ----------

function findProvince(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find((p) => p.id === id);
}

function getRelation(state: GameState, a: FactionId, b: FactionId): DiploRelation {
  const key = relKey(a, b);
  let rel = state.relations[key];
  if (!rel) {
    rel = { opinion: 0, treaties: [] };
    state.relations[key] = rel;
  }
  return rel;
}

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

// ---------- sabotaje de guarnición ----------

const SABOTAGE_COST = 80;
const SABOTAGE_SUCCESS_CHANCE = 0.6;
const SABOTAGE_GARRISON_CUT = 0.4;
const SABOTAGE_FAIL_OPINION_PENALTY = 25;

/** Precondición dura para sabotear (oro, provincia extranjera con señor) — consulta PURA. */
export function sabotageRequirement(state: GameState, spyerId: FactionId, provinceId: ProvinceId): string | null {
  const spyer = state.factions[spyerId];
  if (!spyer) return 'Facción desconocida.';
  const province = findProvince(state, provinceId);
  if (!province) return 'Provincia desconocida.';
  if (!province.ownerId) return 'Esa provincia no tiene señor: no hay nada que sabotear.';
  if (province.ownerId === spyerId) return 'No puedes sabotear tu propia guarnición.';
  if (spyer.gold < SABOTAGE_COST) {
    return `Hace falta oro para pagar a los saboteadores (cuesta ${SABOTAGE_COST}, tenéis ${spyer.gold}).`;
  }
  return null;
}

/**
 * Envía agentes a sabotear la guarnición de una provincia extranjera. Cobra
 * el oro SIEMPRE (se paga a los agentes, trabajen o no). Éxito 60%:
 * guarnición -40%, sin rastro (sin penalización de opinión, sin crónica: el
 * golpe pasó desapercibido). Fallo 40%: los agentes son descubiertos —
 * opinión -25 en la relación con el dueño y crónica del escándalo.
 */
export function sabotageGarrison(
  state: GameState, rng: Rng, spyerId: FactionId, provinceId: ProvinceId,
): ActionResult {
  const reason = sabotageRequirement(state, spyerId, provinceId);
  if (reason) return { ok: false, message: reason };

  const spyer = state.factions[spyerId];
  const province = findProvince(state, provinceId) as Province;
  const ownerId = province.ownerId as FactionId;
  const owner = state.factions[ownerId];

  spyer.gold -= SABOTAGE_COST;

  if (rng.chance(SABOTAGE_SUCCESS_CHANCE)) {
    const cut = Math.floor(province.garrison * SABOTAGE_GARRISON_CUT);
    province.garrison = Math.max(0, province.garrison - cut);
    return {
      ok: true,
      message: `Los agentes de la Casa ${spyer.dynastyName} sabotean en secreto la guarnición de ${province.name}: -${cut} hombres.`,
    };
  }

  const rel = getRelation(state, spyerId, ownerId);
  rel.opinion = clamp(rel.opinion - SABOTAGE_FAIL_OPINION_PENALTY, -100, 100);
  const ownerName = owner ? owner.dynastyName : ownerId;
  state.chronicle.push({
    turn: state.turn,
    kind: 'mundo',
    text: `En ${chronicleDateText(state)}, agentes de la Casa ${spyer.dynastyName} fueron descubiertos `
      + `intentando sabotear ${province.name}: el escándalo mancha su nombre ante la Casa ${ownerName}.`,
  });

  return {
    ok: false,
    message: `Los saboteadores de la Casa ${spyer.dynastyName} son descubiertos en ${province.name}: escándalo diplomático (-${SABOTAGE_FAIL_OPINION_PENALTY} opinión).`,
  };
}

// ---------- reconocimiento ----------

const SCOUT_COST = 40;

/** Precondición dura para espiar (oro, no espiarse a sí mismo) — consulta PURA. */
export function scoutRequirement(state: GameState, spyerId: FactionId, targetId: FactionId): string | null {
  const spyer = state.factions[spyerId];
  const target = state.factions[targetId];
  if (!spyer || !target) return 'Facción desconocida.';
  if (spyerId === targetId) return 'No hace falta espiarte a ti mismo.';
  if (spyer.gold < SCOUT_COST) {
    return `Hace falta oro para pagar a los espías (cuesta ${SCOUT_COST}, tenéis ${spyer.gold}).`;
  }
  return null;
}

/**
 * Envía espías a reconocer una facción: siempre informa (sin riesgo de
 * fallo en v1 — a diferencia del sabotaje), a cambio de oro. El informe
 * (oro, ejércitos totales, fuerza militar total) viaja en el propio mensaje
 * de `ActionResult`, con números reales del estado (nunca inventados).
 */
export function scoutFaction(
  state: GameState, rng: Rng, spyerId: FactionId, targetId: FactionId,
): ActionResult {
  void rng;
  const reason = scoutRequirement(state, spyerId, targetId);
  if (reason) return { ok: false, message: reason };

  const spyer = state.factions[spyerId];
  const target = state.factions[targetId];
  spyer.gold -= SCOUT_COST;

  const armies = Object.values(state.armies).filter((a) => a.factionId === targetId);
  const totalStrength = armies.reduce((sum, a) => sum + armyStrength(state, a), 0);

  return {
    ok: true,
    message: `Vuestros espías informan sobre la Casa ${target.dynastyName}: ${target.gold} de oro, `
      + `${armies.length} ejército(s) en pie, fuerza militar total ≈ ${Math.round(totalStrength)}.`,
  };
}
