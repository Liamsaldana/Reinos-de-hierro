/**
 * IA de facción por arquetipo (GDD §2.4, §17.1-2): reglas simples y honestas.
 * consolidated = defensivo/estable · ambitious = expansor · tribal = incursor.
 * AGENTE N: LA IA DEBE MORDER — reemplaza el contenido tras el diagnóstico
 * del harness de simulación (tests/simulation.test.ts, evidence/sim_report.md).
 *
 * ---------------------------------------------------------------------------
 * DIAGNÓSTICO (causa raíz, verificada con `evidence/sim_report.md` y con una
 * corrida instrumentada): la IA nunca atacaba ni conquistaba porque
 * `defenseEstimate` sumaba magnitudes que NO son comparables:
 *
 *   - `province.garrison` es una CUENTA DE HOMBRES (province.garrison ~
 *     200–500 en provincias propias de una facción, ~300–800 en tierras sin
 *     señor — ver `content/mapgen.ts` y `content/newGame.ts`).
 *   - `armyStrength()` (`combat/autoresolve.ts`) es una PUNTUACIÓN DE PODER
 *     por ejército, típicamente ~30–100 para los ejércitos que esta IA puede
 *     reunir en 30 turnos.
 *
 * El código viejo hacía `targetProvince.garrison + Σ armyStrength(enemigos)`
 * y comparaba eso contra `myStrength` (una `armyStrength`). Como garrison
 * (cientos) domina esa suma, el umbral de ataque NUNCA se superaba — ni
 * siquiera turno 0 contra una guarnición "débil". La comprobación de
 * expansión pacífica (`p.garrison < myStrength`) tenía el mismo defecto:
 * comparaba directamente cientos contra decenas.
 *
 * La ironía es que la guarnición real, en combate (`resolveBattleAt`), NO
 * pelea proporcional a su cantidad de hombres: `autoresolve.ts` clona el
 * UnitType 'milicia' con `menMax = province.garrison`, así que la ratio
 * hombres/menMax de la guarnición es SIEMPRE 1 — su potencia inicial de
 * combate es la de UNA unidad de milicia a plena dotación (~4.5, ver
 * `content/units.ts`: milicia attack 4 + defense 4 → base 4.5), modulada por
 * terreno (montaña ×1.3, colinas ×1.18) y por el nivel de fortificación si la
 * provincia tiene dueño. El tamaño de la guarnición solo importa para CUÁNTO
 * aguanta encajando bajas a lo largo de las rondas, no para su potencia por
 * ronda. Por eso un ejército inicial (armyStrength ~30-38) aplasta CUALQUIER
 * guarnición aislada — la IA vieja simplemente nunca lo intentaba porque
 * comparaba unidades incompatibles.
 *
 * ARREGLO: `garrisonDefensePower()` reconstruye, con los datos PÚBLICOS de
 * `content/units.ts` (nunca importamos `combat/modifiers.ts`: ese módulo se
 * declara expresamente interno — "no forma parte del contrato público" — así
 * que no lo tocamos), una estimación de potencia de guarnición EN LAS MISMAS
 * UNIDADES que `armyStrength()`. `provinceDefenseAt()` sirve de estimación
 * de defensa total de una provincia (guarnición + ejércitos ajenos allí
 * presentes) coherente en escala con la fuerza atacante — así el umbral por
 * arquetipo (GDD, ambitious 1.15× / tribal 0.95× / consolidated 1.35×) por
 * fin compara peras con peras.
 * ---------------------------------------------------------------------------
 *
 * Contrato de tolerancia a fallos (se mantiene): TODAS las mutaciones pasan
 * por ../systems/actions. Esta IA nunca asume éxito: solo registra una línea
 * de log cuando `result.ok === true`, y en caso contrario sigue (o corta el
 * intento) sin romper ni reintentar en bucle infinito.
 *
 * Supuestos documentados:
 * - "Capital" de una facción = provincia propia con settlement.level === 4.
 *   Si no tiene, no recluta esta IA (no hay dónde).
 * - "Vecino fronterizo" = facción dueña de alguna provincia adyacente a
 *   cualquier provincia propia. Fuerza de un vecino = suma de armyStrength()
 *   de todos sus ejércitos.
 * - "defensa presente" de una provincia objetivo = garrisonDefensePower()
 *   (ver arriba) + Σ armyStrength() de los ejércitos de OTRAS facciones
 *   presentes allí que estén en guerra con nosotros — igual que
 *   `resolveBattleAt` decide quién defiende de verdad (`isAtWar`), para no
 *   sobreestimar (contando a alguien que en la batalla real no pelearía) ni
 *   arriesgar el caso borde de `actions.ts:hasDefense` (que sí cuenta
 *   presencia de cualquier facción, en guerra o no) chocando con
 *   `resolveBattleAt` (que si no hay guarnición ni ejército EN GUERRA
 *   presente, lanza "No hay defensores"): `safeToMoveInto()` evita mover
 *   ahí en ese caso borde.
 * - BFS de movimiento solo atraviesa provincias propias, sin dueño, o de
 *   facciones en guerra con nosotros (entrar en territorio de un tercero con
 *   el que no hay guerra sería ilegal per moveArmy).
 * - "amenaza adyacente" (para la retirada) = Σ armyStrength() de ejércitos
 *   de facciones en guerra con nosotros estacionados en una provincia VECINA
 *   a la nuestra (no en la nuestra misma). Retiramos un ejército hacia la
 *   capital si su propia fuerza es menor que 0.6× esa amenaza.
 */
import type {
  Army, Faction, FactionId, GameState, Province, ProvinceId, UnitType,
} from '../types';
import type { Rng } from '../state/rng';
import {
  declareWar, legalMoves, moveArmy, negotiatePeace, recruitUnit,
} from '../systems/actions';
import { getUnitType, unitTypesFor } from '../content/units';
import { armyStrength } from '../combat/autoresolve';

const MAX_UNITS_PER_ARMY = 8;

/** margen de "ventaja clara" para tomar tierra sin señor (GDD: expansión oportunista). */
const EXPANSION_ADVANTAGE = 1.1;
/** retirar un ejército si su fuerza cae por debajo de esta fracción de la amenaza adyacente. */
const RETREAT_RATIO = 0.6;

/** fallback si el banco de unidades no trae 'milicia' (no debería pasar; ver content/units.ts). */
const FALLBACK_MILITIA_STATS = { attack: 4, defense: 4, armor: 1, rangedPower: 0 };

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

/** Umbral de ataque por arquetipo (GDD §17.1-2): decenas de armyStrength contra decenas. */
function attackThreshold(archetype: Faction['ai']): number {
  switch (archetype) {
    case 'ambitious': return 1.15;
    case 'tribal': return 0.95;
    case 'consolidated': return 1.35;
    default: return 1.15; // 'player' nunca llega aquí (ver guard al inicio de runFactionAI)
  }
}

/**
 * Potencia de combate de la guarnición de una provincia, EN LAS MISMAS
 * UNIDADES que armyStrength() (ver diagnóstico arriba). Reconstruida a mano
 * a partir de content/units.ts porque combat/modifiers.ts es interno al
 * módulo de combate y no se importa desde fuera.
 */
function garrisonDefensePower(province: Province): number {
  if (province.garrison <= 0) return 0;
  let militia: { attack: number; defense: number; armor: number; rangedPower: number };
  try {
    militia = getUnitType('milicia');
  } catch {
    militia = FALLBACK_MILITIA_STATS;
  }
  const base = (militia.attack + militia.defense) / 2 + militia.rangedPower * 0.4 + militia.armor * 0.5;
  const terrainMod = province.terrain === 'mountain' ? 1.3 : province.terrain === 'hills' ? 1.18 : 1;
  const fortMod = province.ownerId !== null ? (1 + province.settlement.fortLevel * 0.12) : 1;
  return base * terrainMod * fortMod;
}

/**
 * Defensa total presente en una provincia (guarnición + ejércitos de OTRAS
 * facciones en guerra con `myFactionId` allí estacionados) — coherente con
 * quién pelea de verdad en `resolveBattleAt` (ver diagnóstico arriba).
 */
function provinceDefenseAt(state: GameState, province: Province, myFactionId: FactionId): number {
  const hostileArmies = Object.values(state.armies).filter(
    (a) => a.provinceId === province.id && a.factionId !== myFactionId && isAtWar(state, myFactionId, a.factionId),
  );
  return garrisonDefensePower(province) + hostileArmies.reduce((s, a) => s + armyStrength(state, a), 0);
}

/**
 * Evita el caso borde entre `actions.ts:hasDefense` (considera "defendida"
 * la mera presencia de un ejército ajeno, esté o no en guerra con nosotros)
 * y `combat/autoresolve.ts:resolveBattleAt` (solo cuenta como defensores a
 * quien SÍ está en guerra): si no hay guarnición y el único presente no está
 * en guerra con nosotros, moveArmy() dispararía una batalla sin defensores
 * declarados y `resolveBattleAt` lanzaría. Preferimos no entrar ahí.
 */
function safeToMoveInto(state: GameState, factionId: FactionId, province: Province): boolean {
  if (province.garrison > 0) return true;
  const others = Object.values(state.armies).filter((a) => a.provinceId === province.id && a.factionId !== factionId);
  if (others.length === 0) return true; // nadie ahí: ocupación pacífica segura
  return others.some((a) => isAtWar(state, factionId, a.factionId));
}

/** Amenaza de facciones en guerra con nosotros en provincias VECINAS a `provinceId`. */
function adjacentThreat(state: GameState, factionId: FactionId, provinceId: ProvinceId): number {
  const here = provinceById(state, provinceId);
  if (!here) return 0;
  let threat = 0;
  for (const nId of here.neighbors) {
    for (const a of Object.values(state.armies)) {
      if (a.provinceId === nId && a.factionId !== factionId && isAtWar(state, factionId, a.factionId)) {
        threat += armyStrength(state, a);
      }
    }
  }
  return threat;
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

/** BFS: distancia (en saltos) desde `fromId` hasta la provincia goal más cercana, o null si inalcanzable. */
function bfsDistanceTo(
  state: GameState, fromId: ProvinceId,
  isGoal: (p: Province) => boolean,
  passable: (p: Province) => boolean,
): number | null {
  const byId = new Map(state.provinces.map((p) => [p.id, p]));
  const start = byId.get(fromId);
  if (!start) return null;
  if (isGoal(start)) return 0;
  const dist = new Map<ProvinceId, number>([[fromId, 0]]);
  const queue: ProvinceId[] = [fromId];
  while (queue.length) {
    const cur = queue.shift() as ProvinceId;
    const curP = byId.get(cur);
    if (!curP) continue;
    const curDist = dist.get(cur) ?? 0;
    for (const nb of curP.neighbors) {
      if (dist.has(nb)) continue;
      const nbP = byId.get(nb);
      if (!nbP) continue;
      const goal = isGoal(nbP);
      if (!goal && !passable(nbP)) continue;
      dist.set(nb, curDist + 1);
      if (goal) return curDist + 1;
      queue.push(nb);
    }
  }
  return null;
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

  // 3) MOVER / ATACAR / RETIRAR
  const myArmies = armiesOf(state, factionId);
  const atWar = myWars.length > 0;
  const enemyIds = new Set(myWars.map((w) => (w.attackerId === factionId ? w.defenderId : w.attackerId)));

  for (const army of myArmies) {
    if (army.movement <= 0) continue;
    const here = provinceById(state, army.provinceId);
    if (!here) continue;
    const myStrength = armyStrength(state, army);

    // (d) no suicidarse: si la amenaza en provincias vecinas nos supera con
    // holgura, replegamos hacia la capital en vez de seguir avanzando.
    const threat = atWar ? adjacentThreat(state, factionId, army.provinceId) : 0;
    if (threat > 0 && myStrength < RETREAT_RATIO * threat && capital && army.provinceId !== capital.id) {
      const dest = firstStepTowardsGoal(
        state, army.provinceId,
        (p) => p.id === capital.id,
        (p) => p.ownerId === factionId || p.ownerId === null,
      );
      if (dest !== null) {
        const destProvince = provinceById(state, dest);
        const legal = legalMoves(state, army.id);
        if (destProvince && legal.includes(dest) && safeToMoveInto(state, factionId, destProvince)) {
          const res = moveArmy(state, rng, army.id, dest);
          if (res.ok) log.push(`${faction.name} repliega a ${army.name} ante una amenaza superior.`);
        }
      }
      continue; // este ejército ya decidió su turno: replegarse, no atacar.
    }

    // (a) tierra sin señor débil adyacente: expansión oportunista, con o sin guerra.
    const weakUnowned = here.neighbors
      .map((id) => provinceById(state, id))
      .find((p): p is Province => !!p && p.ownerId === null
        && safeToMoveInto(state, factionId, p)
        && myStrength > EXPANSION_ADVANTAGE * provinceDefenseAt(state, p, factionId));

    if (atWar) {
      const isEnemyGoal = (p: Province) => p.ownerId !== null && enemyIds.has(p.ownerId);
      const passable = (p: Province) => p.ownerId === null || p.ownerId === factionId
        || (p.ownerId !== null && enemyIds.has(p.ownerId));

      let target: ProvinceId | null = null;
      if (weakUnowned) {
        target = weakUnowned.id;
      } else {
        target = firstStepTowardsGoal(state, army.provinceId, isEnemyGoal, passable);
      }

      if (target !== null) {
        const legal = legalMoves(state, army.id);
        if (legal.includes(target)) {
          const targetProvince = provinceById(state, target);
          const isFinalEnemyTarget = !!targetProvince && targetProvince.ownerId !== null && enemyIds.has(targetProvince.ownerId);
          let shouldMove = !!targetProvince && safeToMoveInto(state, factionId, targetProvince);
          if (shouldMove && isFinalEnemyTarget && targetProvince) {
            const defenseEstimate = provinceDefenseAt(state, targetProvince, factionId);
            shouldMove = myStrength > attackThreshold(faction.ai) * defenseEstimate;
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
      // sin guerra: tomar tierra sin señor débil, o volver a la capital.
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
          const nextProvince = provinceById(state, next);
          const legal = legalMoves(state, army.id);
          if (nextProvince && legal.includes(next) && safeToMoveInto(state, factionId, nextProvince)) {
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

// ---------------------------------------------------------------------------
// Exportado solo para tests/ai.test.ts (unidad mínima): no lo consume el
// resto del runtime. Mantiene la lógica de distancia BFS testeable de forma
// aislada sin duplicar la implementación.
// ---------------------------------------------------------------------------
export const __testing = {
  garrisonDefensePower,
  provinceDefenseAt,
  attackThreshold,
  bfsDistanceTo,
};
