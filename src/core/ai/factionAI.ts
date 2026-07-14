/**
 * IA de facción por arquetipo (GDD §2.4, §17.1-2): reglas simples y honestas.
 * consolidated = defensivo/estable · ambitious = expansor · tribal = incursor.
 * AGENTE D: reemplaza el contenido. MANTÉN la firma exportada.
 *
 * Contrato de tolerancia a fallos: TODAS las mutaciones pasan por
 * ../systems/actions. Esas acciones son stubs en paralelo (agente A) y hoy
 * devuelven `ok:false` sin mutar nada — por diseño, esta IA nunca asume éxito:
 * solo registra una línea de log cuando `result.ok === true`, y en caso
 * contrario simplemente sigue (o corta el intento) sin romper ni reintentar
 * en bucle infinito. legalMoves() stub devuelve [] hoy, así que ningún
 * movimiento/ataque se ejecuta hasta que el agente A termine su parte —
 * eso es esperado y no es un bug de este archivo.
 *
 * Supuestos documentados:
 * - "Capital" de una facción = provincia propia con settlement.level === 4.
 *   Si no tiene, no recluta esta IA (no hay dónde).
 * - "Vecino fronterizo" = facción dueña de alguna provincia adyacente a
 *   cualquier provincia propia. Fuerza de un vecino = suma de armyStrength()
 *   de todos sus ejércitos.
 * - "defensa estimada" de una provincia objetivo = province.garrison (como
 *   número de fuerza, aproximación deliberada) + Σ armyStrength() de los
 *   ejércitos de otras facciones presentes allí.
 * - BFS de movimiento solo atraviesa provincias propias, sin dueño, o de
 *   facciones en guerra con nosotros (entrar en territorio de un tercero con
 *   el que no hay guerra sería ilegal per moveArmy).
 */
import type {
  Army, Faction, FactionId, GameState, Province, ProvinceId, UnitType,
} from '../types';
import type { Rng } from '../state/rng';
import {
  declareWar, legalMoves, moveArmy, negotiatePeace, recruitUnit,
} from '../systems/actions';
import { unitTypesFor } from '../content/units';
import { armyStrength } from '../combat/autoresolve';

const MAX_UNITS_PER_ARMY = 8;

function ownedProvinces(state: GameState, factionId: FactionId): Province[] {
  return state.provinces.filter((p) => p.ownerId === factionId);
}

function capitalOf(state: GameState, factionId: FactionId): Province | null {
  return ownedProvinces(state, factionId).find((p) => p.settlement.level === 4) ?? null;
}

function armiesOf(state: GameState, factionId: FactionId): Army[] {
  return Object.values(state.armies).filter((a) => a.factionId === factionId);
}

function factionTotalStrength(state: GameState, factionId: FactionId): number {
  return armiesOf(state, factionId).reduce((s, a) => s + armyStrength(state, a), 0);
}

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some((w) => (w.attackerId === a && w.defenderId === b)
    || (w.attackerId === b && w.defenderId === a));
}

function provinceById(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find((p) => p.id === id);
}

/** BFS: primer paso desde `fromId` hacia la provincia objetivo más cercana que cumpla `isGoal`. */
function firstStepTowardsGoal(
  state: GameState, fromId: ProvinceId,
  isGoal: (p: Province) => boolean,
  passable: (p: Province) => boolean,
): ProvinceId | null {
  const byId = new Map(state.provinces.map((p) => [p.id, p]));
  const start = byId.get(fromId);
  if (!start) return null;
  if (isGoal(start)) return null; // ya estamos ahí

  const prev = new Map<ProvinceId, ProvinceId | null>();
  prev.set(fromId, null);
  const queue: ProvinceId[] = [fromId];
  let goalId: ProvinceId | null = null;

  while (queue.length) {
    const cur = queue.shift() as ProvinceId;
    const curP = byId.get(cur);
    if (!curP) continue;
    for (const nb of curP.neighbors) {
      if (prev.has(nb)) continue;
      const nbP = byId.get(nb);
      if (!nbP) continue;
      const goal = isGoal(nbP);
      if (!goal && !passable(nbP)) continue;
      prev.set(nb, cur);
      if (goal) { goalId = nb; break; }
      queue.push(nb);
    }
    if (goalId !== null) break;
  }
  if (goalId === null) return null;
  // reconstruir el primer salto desde fromId
  let node = goalId;
  let parent = prev.get(node) ?? null;
  while (parent !== null && parent !== fromId) {
    node = parent;
    parent = prev.get(node) ?? null;
  }
  return node;
}

function pickRecruit(faction: Faction, owned: Province[], archetype: Faction['ai']): UnitType | null {
  const candidates = unitTypesFor(faction.cultureId).filter((t) => {
    if (t.cost.gold > faction.gold) return false;
    if (t.cost.manpower > faction.manpower) return false;
    if (t.cost.iron && !owned.some((p) => p.iron)) return false;
    if (t.cost.horses && !owned.some((p) => p.horses)) return false;
    return true;
  });
  if (!candidates.length) return null;
  const score = (t: UnitType): number => {
    if (archetype === 'tribal') return t.attack;
    if (archetype === 'consolidated') return t.defense;
    return (t.attack + t.defense) / 2; // ambitious: mixto
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0];
}

/** Ejecuta el turno de una facción IA. Devuelve líneas de log (español). */
export function runFactionAI(state: GameState, rng: Rng, factionId: FactionId): string[] {
  const faction = state.factions[factionId];
  const log: string[] = [];
  if (!faction || !faction.alive || faction.ai === 'player') return log;

  const myWars = state.wars.filter((w) => w.attackerId === factionId || w.defenderId === factionId);

  // 1) PAZ
  for (const war of myWars) {
    const iAmAttacker = war.attackerId === factionId;
    const myScore = iAmAttacker ? war.warScore : -war.warScore;
    const myExhaustion = iAmAttacker ? war.exhaustionAttacker : war.exhaustionDefender;
    if (myScore < -35 || myExhaustion > 65) {
      const kind: 'white' | 'concede' = myScore <= -35 ? 'concede' : 'white';
      const res = negotiatePeace(state, war.id, kind);
      if (res.ok) {
        const otherId = iAmAttacker ? war.defenderId : war.attackerId;
        const otherName = state.factions[otherId]?.name ?? otherId;
        log.push(kind === 'white'
          ? `${faction.name} propone paz blanca a ${otherName}.`
          : `${faction.name}, exhausta, pide la paz a ${otherName} cediendo términos.`);
      }
    }
  }

  // 2) RECLUTAR
  const capital = capitalOf(state, factionId);
  if (capital) {
    const owned = ownedProvinces(state, factionId);
    let guard = 0;
    while (faction.gold > 140 && faction.manpower > 300 && guard < MAX_UNITS_PER_ARMY) {
      guard++;
      const armyHere = Object.values(state.armies)
        .find((a) => a.factionId === factionId && a.provinceId === capital.id);
      if (armyHere && armyHere.units.length >= MAX_UNITS_PER_ARMY) break;
      const choice = pickRecruit(faction, owned, faction.ai);
      if (!choice) break;
      const res = recruitUnit(state, rng, factionId, capital.id, choice.id);
      if (!res.ok) break; // sin éxito: no reintentar en bucle (stub o rechazo real)
      log.push(`${faction.name} recluta ${choice.name}.`);
    }
  }

  // 3) MOVER / ATACAR
  const myArmies = armiesOf(state, factionId);
  const atWar = myWars.length > 0;
  for (const army of myArmies) {
    if (army.movement <= 0) continue;
    const here = provinceById(state, army.provinceId);
    if (!here) continue;
    const myStrength = armyStrength(state, army);

    if (atWar) {
      const enemyIds = new Set(myWars.map((w) => (w.attackerId === factionId ? w.defenderId : w.attackerId)));
      const isEnemyGoal = (p: Province) => p.ownerId !== null && enemyIds.has(p.ownerId);
      const passable = (p: Province) => p.ownerId === null || p.ownerId === factionId
        || (p.ownerId !== null && enemyIds.has(p.ownerId));

      // objetivo prioritario: vecino directo sin dueño y débil (incursión rápida)
      let target: ProvinceId | null = null;
      const weakUnowned = here.neighbors
        .map((id) => provinceById(state, id))
        .find((p): p is Province => !!p && p.ownerId === null && p.garrison < myStrength);
      if (weakUnowned) {
        target = weakUnowned.id;
      } else {
        target = firstStepTowardsGoal(state, army.provinceId, isEnemyGoal, passable);
      }

      if (target !== null) {
        const legal = legalMoves(state, army.id);
        if (legal.includes(target)) {
          const targetProvince = provinceById(state, target);
          const isFinalEnemyTarget = targetProvince && targetProvince.ownerId !== null && enemyIds.has(targetProvince.ownerId);
          let shouldMove = true;
          if (isFinalEnemyTarget && targetProvince) {
            const hostileArmies = Object.values(state.armies).filter((a) => a.provinceId === target && a.factionId !== factionId);
            const defenseEstimate = targetProvince.garrison
              + hostileArmies.reduce((s, a) => s + armyStrength(state, a), 0);
            const threshold = faction.ai === 'tribal' ? 0.9 : 1.15;
            shouldMove = myStrength > threshold * defenseEstimate;
          }
          if (shouldMove) {
            const res = moveArmy(state, rng, army.id, target);
            if (res.ok) {
              log.push(isFinalEnemyTarget
                ? `${faction.name} lanza ${army.name} contra ${targetProvince?.name ?? target}.`
                : `${faction.name} avanza con ${army.name} hacia ${targetProvince?.name ?? target}.`);
            }
          }
        }
      }
    } else {
      // sin guerra: tomar tierra sin señor débil adyacente, o volver a la capital
      const weakUnowned = here.neighbors
        .map((id) => provinceById(state, id))
        .find((p): p is Province => !!p && p.ownerId === null && p.garrison < myStrength);
      if (weakUnowned) {
        const legal = legalMoves(state, army.id);
        if (legal.includes(weakUnowned.id)) {
          const res = moveArmy(state, rng, army.id, weakUnowned.id);
          if (res.ok) log.push(`${faction.name} extiende sus fronteras hacia ${weakUnowned.name}.`);
        }
      } else if (capital && army.provinceId !== capital.id) {
        const next = firstStepTowardsGoal(
          state, army.provinceId,
          (p) => p.id === capital.id,
          (p) => p.ownerId === factionId || p.ownerId === null,
        );
        if (next !== null) {
          const legal = legalMoves(state, army.id);
          if (legal.includes(next)) {
            const res = moveArmy(state, rng, army.id, next);
            if (res.ok) log.push(`${faction.name} repliega a ${army.name} hacia la capital.`);
          }
        }
      }
    }
  }

  // 4) DECLARAR GUERRA (máximo 1 por turno, solo si no está ya en guerra)
  if (!atWar) {
    const myProvinceIds = new Set(ownedProvinces(state, factionId).map((p) => p.id));
    const neighborFactionIds = new Set<FactionId>();
    for (const p of state.provinces) {
      if (!myProvinceIds.has(p.id)) continue;
      for (const nId of p.neighbors) {
        const np = provinceById(state, nId);
        if (np && np.ownerId && np.ownerId !== factionId) neighborFactionIds.add(np.ownerId);
      }
    }
    if (neighborFactionIds.size > 0) {
      let weakest: { id: FactionId; strength: number } | null = null;
      for (const id of neighborFactionIds) {
        const s = factionTotalStrength(state, id);
        if (!weakest || s < weakest.strength) weakest = { id, strength: s };
      }
      if (weakest) {
        const myStrengthTotal = factionTotalStrength(state, factionId);
        const neighborFaction = state.factions[weakest.id];
        let declared = false;
        if (faction.ai === 'ambitious' && myStrengthTotal > 1.3 * weakest.strength) {
          const res = declareWar(state, factionId, weakest.id, 'reclamo');
          if (res.ok) { declared = true; log.push(`${faction.name} declara la guerra a ${neighborFaction?.name ?? weakest.id} por reclamo.`); }
        } else if (faction.ai === 'tribal' && myStrengthTotal > 1.1 * weakest.strength
          && neighborFaction && neighborFaction.religionId !== faction.religionId) {
          const res = declareWar(state, factionId, weakest.id, 'religioso');
          if (res.ok) { declared = true; log.push(`La horda de ${faction.name} cae sobre ${neighborFaction.name}.`); }
        } else if (faction.ai === 'consolidated' && faction.legitimacy > 70 && myStrengthTotal > 1.6 * weakest.strength) {
          const res = declareWar(state, factionId, weakest.id, 'reclamo');
          if (res.ok) { declared = true; log.push(`${faction.name} declara la guerra a ${neighborFaction?.name ?? weakest.id}, invocando su legitimidad.`); }
        }
        void declared; // una sola declaración posible por turno; el bucle ya terminó
      }
    }
  }

  return log;
}
