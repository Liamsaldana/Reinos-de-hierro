/**
 * El Remanente Imperial (Fase 3, GDD §2.1 "Remanente imperial (reclama toda
 * Aurelia; antagonista natural de fin de partida)", §2.4). AGENTE W: módulo
 * nuevo.
 *
 * Diseño: alrededor del turno 32 (año 8), con 15% de probabilidad CADA
 * INVIERNO mientras el Remanente no exista todavía, "Casa Aureliana"
 * resurge: no nace pequeña como una facción nueva cualquiera — es un imperio
 * que DESPIERTA. En el mismo instante:
 *  1. toma como capital la provincia sin señor de mayor `settlement.level`
 *     (o, si no queda ninguna tierra sin señor en todo el mapa, la más
 *     central del continente) y la asciende a capital de reino de verdad
 *     (nivel 4 — ver `spawnImperialRemnant` para el porqué),
 *  2. levanta DOS huestes completas de golpe (6 unidades tier 2 mixtas cada
 *     una, "son el imperio": ignoran los gates de tecnología normales, no
 *     pasan por `recruitUnit`/`isUnitUnlocked`),
 *  3. declara un RECLAMO inmediato (casus belli 'reclamo') contra quien más
 *     capitales de nivel 4 controle (o, en su defecto, quien más territorio
 *     tenga) — empujando la `War` directamente a `state.wars` (no pasa por
 *     `actions.ts:declareWar`, que podría vetarla por tregua/pacto: el
 *     Remanente no negocia su reclamo, lo proclama),
 *  4. dispara una crónica de trueno ('mundo') y otra de la propia guerra.
 *
 * A partir de ahí, el Remanente juega como cualquier otra facción IA: su
 * turno lo ejecuta `runFactionAI` (ai/factionAI.ts, NO se toca) con
 * arquetipo 'imperial'. Ese archivo nunca hace un switch/if EXHAUSTIVO sobre
 * `Faction['ai']` — solo comparaciones `=== 'tribal'` / `=== 'consolidated'`
 * / `=== 'ambitious'` sueltas con `switch(...) { default: ... }` para el
 * umbral de ataque — así que un arquetipo que ninguna rama reconoce (como
 * 'imperial') cae al comportamiento por defecto sin lanzar: mismo umbral de
 * ataque que 'player' (1.15, aunque 'player' nunca llega ahí en la práctica,
 * es el mismo número que 'ambitious'), mismo criterio de reclutamiento mixto
 * que 'ambitious' (`pickRecruit`'s `else` final), y sin las ramas
 * específicas de diplomacia/declaración de guerra reservadas a
 * tribal/consolidated/ambitious (el Remanente no inicia guerras NUEVAS por
 * su cuenta vía IA normal — solo pelea la que se le declaró al nacer y las
 * que le declaren a él — pero eso no es un crash, es simplemente que esas
 * ramas no matchean). Verificado por inspección Y por
 * `tests/imperial.test.ts` (llama a `runFactionAI` sobre el Remanente y
 * comprueba que no lanza). CONFIRMADO: no hace falta tocar factionAI.ts.
 *
 * Núcleo puro: toda la aleatoriedad sale de `rng` (nunca Math.random). La
 * ÚNICA llamada a `rng.chance` ocurre en invierno (mismo patrón que
 * `turn.ts` sección 6, la muerte natural de personajes, que también solo
 * tira dados en invierno) para no gastar el flujo determinista del Rng en
 * las otras 3 estaciones del año — así una partida que nunca llega a
 * invierno con turn>=32 nunca consume ese roll. El resto de decisiones
 * (capital, objetivo de la guerra, roster) son deterministas por diseño
 * (desempates por id ascendente/posición) para que "semilla forzada" en los
 * tests sea reproducible sin depender de más tiradas de las estrictamente
 * necesarias.
 *
 * ---------------------------------------------------------------------------
 * CABLEADO PARA EL INTEGRADOR (turn.ts es propiedad de otro agente — AGENTE
 * A — y está fuera de mi alcance; NO lo toco):
 *
 * `tickImperial(state, rng)` se llama UNA VEZ por turno dentro de `endTurn`,
 * DESPUÉS de que las IA ya jugaron su turno (paso 2 de turn.ts: así, si el
 * Remanente surge este turno, no juega su propio turno de IA hasta el
 * siguiente — coherente con cómo el resto del motor trata "nace este turno,
 * actúa el que viene") y ANTES del paso 8 (victoria/derrota). El sitio
 * concreto sugerido es justo después del paso 7 ("Guerras: agotamiento y
 * eliminación de facciones sin provincias") y ANTES de
 * `victory.ts:updateVictoryProgress`/`checkExtraVictories` (para que, si el
 * Remanente irrumpe y de inmediato posee la capital que le faltaba a
 * alguien para la restauración, ese desenlace se refleje ESE MISMO turno).
 * Los mensajes que devuelve van al mismo array `playerMessages` que ya usan
 * `tickSieges`/`tickConstruction`/`tickResearch`:
 *
 *   // 7.5 Remanente Imperial (Fase 3): puede surgir como amenaza tardía.
 *   playerMessages.push(...tickImperial(state, rng));
 *
 *   // 8. Victoria/derrota del jugador (extendida, Fase 3: ver victory.ts).
 *   if (state.outcome === 'ongoing') {
 *     updateVictoryProgress(state);
 *     const extra = checkExtraVictories(state);
 *     if (extra) {
 *       state.outcome = extra;
 *     } else {
 *       // ... el bloque de conquista/derrota que YA existe en turn.ts, sin tocar ...
 *     }
 *   }
 * ---------------------------------------------------------------------------
 */
import type {
  Army, ArmyId, Character, CharacterId, Faction, FactionId, GameState, Province, ProvinceId,
  UnitInstance, War,
} from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import { occupyProvince } from './actions';
import { provincesOf } from './economy';
import { joinAlliesToWar } from './diplomacy';
import { getUnitType } from '../content/units';

/** id fijo de la facción: `tickImperial` lo usa como "¿ya existe?" — determinista, sin buscar por nombre. */
export const IMPERIAL_FACTION_ID: FactionId = 'remanente_imperial';

const EMERGENCE_MIN_TURN = 32;
const EMERGENCE_CHANCE_PER_WINTER = 0.15;

/**
 * Roster fijo de cada una de las 2 huestes imperiales: 6 unidades tier 2
 * mixtas (infantería, lanza, distancia, caballería, asedio, más la legión
 * propia de cultura aurelia) — deliberadamente sin azar: "son el imperio",
 * no una tirada de reclutamiento. Todas existen en content/units.ts (tier 2,
 * ver banco de unidades); se instancian a mano (nunca vía `recruitUnit`), así
 * que ignoran `isUnitUnlocked` sin necesidad de ningún caso especial.
 */
const IMPERIAL_ROSTER: readonly string[] = [
  'legionarios_aurelios', 'infanteria_escudo', 'piqueros', 'ballesteros', 'caballeria_choque', 'catapulta',
];

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

/**
 * Provincia sin señor de mayor `settlement.level` (empate → id de provincia
 * más bajo, determinista y sin gastar Rng). Si no queda ninguna tierra sin
 * señor en todo el mapa, cae a la provincia más central del continente:
 * `Province.center` ya es público (no hace falta importar constantes de
 * `content/mapgen.ts`) y el origen del mundo de juego (0,0) coincide con el
 * centro real de la rejilla 8×5 (ORIGIN_X/ORIGIN_Z/SPACING se cancelan ahí
 * por construcción), así que "distancia al origen" = "qué tan central es".
 */
function pickImperialCapital(state: GameState): Province {
  const unowned = state.provinces.filter(p => p.ownerId === null);
  if (unowned.length > 0) {
    return [...unowned].sort((a, b) => (b.settlement.level - a.settlement.level) || (a.id - b.id))[0];
  }
  return [...state.provinces].sort((a, b) => {
    const da = a.center[0] ** 2 + a.center[1] ** 2;
    const db = b.center[0] ** 2 + b.center[1] ** 2;
    return (da - db) || (a.id - b.id);
  })[0];
}

/**
 * Facción viva (que no sea `excludeId`) dueña de más capitales de reino
 * (nivel 4); empate → id de facción ascendente. Si nadie tiene ninguna
 * capital (no debería pasar en una partida real), cae a quien tenga más
 * provincias; si tampoco hay candidatos, null (sin objetivo posible: el
 * Remanente surge sin declarar guerra, en vez de lanzar).
 */
function factionWithMostCapitals(state: GameState, excludeId: FactionId): FactionId | null {
  const capitals = state.provinces.filter(p => p.settlement.level === 4);
  const counts = new Map<FactionId, number>();
  for (const p of capitals) {
    if (!p.ownerId || p.ownerId === excludeId) continue;
    counts.set(p.ownerId, (counts.get(p.ownerId) ?? 0) + 1);
  }
  let best: { id: FactionId; count: number } | null = null;
  for (const [id, count] of counts) {
    const faction = state.factions[id];
    if (!faction || !faction.alive) continue;
    if (!best || count > best.count || (count === best.count && id < best.id)) {
      best = { id, count };
    }
  }
  if (best) return best.id;

  let byLand: { id: FactionId; n: number } | null = null;
  for (const factionId of Object.keys(state.factions)) {
    if (factionId === excludeId) continue;
    const faction = state.factions[factionId];
    if (!faction.alive) continue;
    const n = provincesOf(state, factionId).length;
    if (n === 0) continue;
    if (!byLand || n > byLand.n || (n === byLand.n && factionId < byLand.id)) {
      byLand = { id: factionId, n };
    }
  }
  return byLand?.id ?? null;
}

function uniqueImperialCharacterId(state: GameState): CharacterId {
  let n = 1;
  let id = `char_${IMPERIAL_FACTION_ID}_${n}`;
  while (state.characters[id]) {
    n += 1;
    id = `char_${IMPERIAL_FACTION_ID}_${n}`;
  }
  return id;
}

function uniqueImperialArmyId(state: GameState, n: number): ArmyId {
  let id = `army_${IMPERIAL_FACTION_ID}_${n}`;
  let bump = n;
  while (state.armies[id]) {
    bump += 1;
    id = `army_${IMPERIAL_FACTION_ID}_${bump}`;
  }
  return id;
}

/** Una hueste imperial a plena dotación y veterana (xp 2/3: "fuertes", no reclutas de ayer). */
function makeImperialArmy(state: GameState, index: number, provinceId: ProvinceId, name: string): Army {
  const units: UnitInstance[] = IMPERIAL_ROSTER.map(typeId => {
    const type = getUnitType(typeId);
    return { typeId, men: type.menMax, morale: type.moraleMax, xp: 2 };
  });
  return {
    id: uniqueImperialArmyId(state, index),
    name,
    factionId: IMPERIAL_FACTION_ID,
    provinceId,
    units,
    generalId: null,
    movement: 2,
    movementMax: 2,
  };
}

/**
 * Surge el Remanente Imperial: crea la facción y su gobernante, le da una
 * capital, dos huestes fuertes y una declaración de guerra inmediata contra
 * quien más capitales (o territorio) acumule. Devuelve los mensajes
 * narrados (ya empujados a la crónica).
 */
function spawnImperialRemnant(state: GameState, rng: Rng): string[] {
  const messages: string[] = [];
  const capitalProvince = pickImperialCapital(state);

  const rulerId = uniqueImperialCharacterId(state);
  const ruler: Character = {
    id: rulerId,
    name: 'Aureliano el Restaurador',
    factionId: IMPERIAL_FACTION_ID,
    role: 'ruler',
    age: 50,
    attributes: { martial: 8, stewardship: 7, diplomacy: 4, intrigue: 6 },
    traits: ['ambicioso'],
    alive: true,
  };
  state.characters[rulerId] = ruler;

  const faction: Faction = {
    id: IMPERIAL_FACTION_ID,
    name: 'Remanente de Aurelia',
    dynastyName: 'Casa Aureliana',
    cultureId: 'aurelios',
    religionId: 'aureismo',
    colorPrimary: '#5a4fa0',
    colorSecondary: '#D9C8A0',
    bannerSeed: rng.int(1, 99999),
    ai: 'imperial',
    rulerId,
    heirId: null,
    gold: 400,
    manpower: 3000,
    foodStock: 300,
    legitimacy: 70,
    alive: true,
    research: { active: null, points: 0, done: [] },
  };
  state.factions[IMPERIAL_FACTION_ID] = faction;

  // Capital de verdad (nivel 4, fortLevel 2 — mismo patrón exacto que
  // newGame.ts arma las 3 capitales originales): un imperio que despierta no
  // gobierna desde una aldea. Mantiene el NOMBRE del asentamiento que ya
  // tenía (solo asciende rango y fortificación) — sin esto, `capitalOf()`
  // (factionAI.ts) nunca encontraría dónde reclutar, y esta provincia jamás
  // contaría para "controla TODAS las capitales de nivel 4" (victory.ts),
  // dejando huérfana la condición de restauración justo cuando el Remanente
  // se convierte en el rival a batir.
  capitalProvince.settlement = { ...capitalProvince.settlement, level: 4, fortLevel: 2 };
  occupyProvince(state, IMPERIAL_FACTION_ID, capitalProvince);

  const army1 = makeImperialArmy(state, 1, capitalProvince.id, 'La Legión de la Restauración');
  const army2 = makeImperialArmy(state, 2, capitalProvince.id, 'La Guardia de Aurelia');
  state.armies[army1.id] = army1;
  state.armies[army2.id] = army2;

  const thunderText = `En ${chronicleDateText(state)}, bajo estandartes que nadie había visto ondear en tres `
    + `generaciones, la Casa Aureliana proclama el Remanente de Aurelia en ${capitalProvince.name} y reclama `
    + 'el legado entero del Imperio caído.';
  state.chronicle.push({ turn: state.turn, kind: 'mundo', text: thunderText });
  messages.push(thunderText);

  const targetId = factionWithMostCapitals(state, IMPERIAL_FACTION_ID);
  if (targetId) {
    const target = state.factions[targetId];
    const war: War = {
      id: `war_${IMPERIAL_FACTION_ID}_${targetId}_${state.turn}`,
      attackerId: IMPERIAL_FACTION_ID,
      defenderId: targetId,
      cb: 'reclamo',
      warScore: 0,
      exhaustionAttacker: 0,
      exhaustionDefender: 0,
      startedTurn: state.turn,
    };
    state.wars.push(war);

    const warText = `En ${chronicleDateText(state)}, la Casa Aureliana declara su reclamo sobre las tierras de `
      + `la Casa ${target.dynastyName}: "lo que fue del Imperio, al Imperio ha de volver".`;
    state.chronicle.push({ turn: state.turn, kind: 'guerra', text: warText });
    messages.push(warText);

    // arrastra a los aliados defensivos del objetivo, igual que cualquier
    // otra declaración de guerra (diplomacy.ts:joinAlliesToWar, lectura
    // pública — mismo patrón que actions.ts:declareWar).
    messages.push(...joinAlliesToWar(state, war));
  }

  return messages;
}

/**
 * Avanza al Remanente Imperial un turno: puede SURGIR (ver cabecera del
 * archivo) si todavía no existe. Una vez existe, esta función no vuelve a
 * hacer nada — su turno de IA lo juega `runFactionAI` como a cualquier otra
 * facción (ver cableado en la cabecera). Llamar UNA VEZ por turno.
 */
export function tickImperial(state: GameState, rng: Rng): string[] {
  if (state.factions[IMPERIAL_FACTION_ID]) return [];
  if (state.turn < EMERGENCE_MIN_TURN) return [];
  if (seasonOf(state.turn) !== 3) return [];
  if (!rng.chance(EMERGENCE_CHANCE_PER_WINTER)) return [];
  return spawnImperialRemnant(state, rng);
}
