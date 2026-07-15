/**
 * Diplomacia profunda (GDD §10 v1+): matrimonios con lazo dinástico y
 * herencia simple, alianzas defensivas que arrastran a la guerra, y pactos
 * de no agresión. AGENTE R.
 *
 * Contrato con el resto del núcleo (para que compile hoy sin tocar los
 * archivos de otros agentes):
 * - Reutiliza `ActionResult` de `./actions` (mismo contrato que declareWar/
 *   negotiatePeace) en vez de duplicar la interfaz.
 * - `isAtWar`/`getRelation`/`chronicleDateText` están duplicados a propósito
 *   (mismo patrón que ya existe entre `systems/actions.ts` y
 *   `ai/factionAI.ts`: cada módulo es dueño de sus propios helpers internos
 *   para no crear una dependencia cruzada entre agentes en paralelo).
 * - Las funciones `xRequirement(...)` son la ÚNICA fuente de verdad de la
 *   precondición dura ("requiere...") de cada acción: las usa tanto la
 *   acción real (para no duplicar la validación) como `warsPanel.ts` (para
 *   deshabilitar botones con motivo, SIN mutar estado en cada render — por
 *   eso son consultas puras, a diferencia de `getRelation`).
 *
 * ---------------------------------------------------------------------------
 * CABLEADO PARA EL INTEGRADOR (no lo hago yo — no toco actions.ts ni turn.ts):
 *
 * 1) `canDeclareWar(state, aId, bId)` debe llamarse AL PRINCIPIO de
 *    `actions.ts:declareWar`, antes de mutar nada: si `.ok` es false, devolver
 *    `{ ok: false, message: reason }` igual que sus otras validaciones (ya
 *    cubre isAtWar/truce, que declareWar ya valida por su cuenta — el único
 *    caso NUEVO que añade es el pacto de no agresión vigente).
 *
 * 2) `joinAlliesToWar(state, war)` debe llamarse dentro de `declareWar`,
 *    justo DESPUÉS de `state.wars.push(war)` (una vez la guerra original ya
 *    existe y tiene id), pasándole ese mismo objeto `war` recién creado.
 *    Devuelve `string[]` de mensajes narrados (ya empujados a la crónica);
 *    concaténalos al mensaje de retorno de declareWar si se quiere mostrar
 *    en la UI, o ignóralos si solo interesa el efecto (la crónica ya quedó
 *    escrita). Es UN solo salto (aliados del defensor), no recursivo.
 *
 * 3) `marriageHeirFaction(state, deadFactionId)` y `transferRealm(state,
 *    fromId, toId)` se llaman juntas en `turn.ts`, en el punto donde una
 *    casa se queda sin línea de sucesión viable (hoy: el `else` que crea "un
 *    primo lejano" cuando `faction.heirId` es null tras morir el gobernante,
 *    y el punto donde se marca `faction.alive = false` por falta de
 *    provincias). Orden sugerido: cuando se detecte que una facción NO
 *    jugadora se queda sin heredero válido (o se extingue por completo),
 *    llamar primero `marriageHeirFaction(state, deadFactionId)`; si devuelve
 *    un id (no null), preferirlo sobre el fallback de "primo lejano" y
 *    llamar `transferRealm(state, deadFactionId, heirId)` para mover
 *    provincias y disolver ejércitos; solo si devuelve null, caer al
 *    fallback existente. `transferRealm` NO toca `faction.alive`: eso lo
 *    decide `turn.ts` con su propia secuencia (evita presuponer el orden
 *    exacto de la sección 6/7 de `endTurn`, que es propiedad de otro agente).
 * ---------------------------------------------------------------------------
 */
import type {
  DiploRelation, FactionId, GameState, TreatyType, War,
} from '../types';
import { relKey, seasonOf, yearOf, SEASON_NAMES } from '../types';
import type { Rng } from '../state/rng';
import { clamp } from './economy';
import type { ActionResult } from './actions';

// ---------- helpers internos (duplicados a propósito, ver docstring) ----------

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(
    (w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

/** Lectura+creación perezosa de la relación (igual que actions.ts): solo la usan
 * las acciones que SÍ van a mutar. Las consultas puras leen `state.relations`
 * directo con `??` de respaldo, para no ensuciar el estado solo por preguntar. */
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

/** true si una tercera facción viva está en guerra con ambas (amenaza común, GDD §10.1). */
function hasCommonThreat(state: GameState, aId: FactionId, bId: FactionId): boolean {
  for (const cId of Object.keys(state.factions)) {
    if (cId === aId || cId === bId) continue;
    const c = state.factions[cId];
    if (!c || !c.alive) continue;
    if (isAtWar(state, cId, aId) && isAtWar(state, cId, bId)) return true;
  }
  return false;
}

function uniqueWarId(state: GameState, attackerId: FactionId, defenderId: FactionId): string {
  const base = `war_${attackerId}_${defenderId}_${state.turn}`;
  if (!state.wars.some((w) => w.id === base)) return base;
  let n = state.wars.length;
  let id = `${base}_${n}`;
  while (state.wars.some((w) => w.id === id)) { n += 1; id = `${base}_${n}`; }
  return id;
}

const TREATY_BREAK_FLAVOR: Record<TreatyType, string> = {
  alliance: 'su alianza',
  non_aggression: 'su pacto de no agresión',
  marriage_tie: 'su lazo de sangre',
};

// ---------- matrimonio ----------

/**
 * Precondición dura para proponer matrimonio (sin guerra, opinión >= -20,
 * sin lazo ya) — consulta PURA (no crea la relación si no existe), usada
 * tanto por `proposeMarriage` como por la UI para deshabilitar el botón.
 */
export function marriageRequirement(state: GameState, aId: FactionId, bId: FactionId): string | null {
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return 'Facción desconocida.';
  if (aId === bId) return 'Una casa no puede casarse consigo misma.';
  if (isAtWar(state, aId, bId)) return 'No se puede proponer un matrimonio mientras estáis en guerra.';
  const rel = state.relations[relKey(aId, bId)];
  if ((rel?.opinion ?? 0) < -20) return 'La opinión es demasiado baja para proponer un matrimonio (mínimo -20).';
  if (rel?.treaties.includes('marriage_tie')) return 'Ya existe un lazo de sangre entre ambas casas.';
  return null;
}

/**
 * Propone un matrimonio entre las casas `proposerId` y `targetId`. La casa
 * objetivo decide con el propio Rng, determinista: acepta siempre que su
 * opinión sea >= 0; si es negativa (entre -20 y 0 por la precondición),
 * acepta con probabilidad `0.3 + opinión/200` (entre 0.2 y 0.3 — nunca
 * imposible, nunca gratis). Aceptado: lazo de sangre + opinión +25 + crónica.
 * Rechazado: opinión -5.
 */
export function proposeMarriage(
  state: GameState, rng: Rng, proposerId: FactionId, targetId: FactionId,
): ActionResult {
  const reason = marriageRequirement(state, proposerId, targetId);
  if (reason) return { ok: false, message: reason };

  const proposer = state.factions[proposerId];
  const target = state.factions[targetId];
  const rel = getRelation(state, proposerId, targetId);

  const accepted = rel.opinion >= 0 || rng.chance(0.3 + rel.opinion / 200);
  if (!accepted) {
    rel.opinion = clamp(rel.opinion - 5, -100, 100);
    return {
      ok: false,
      message: `La Casa ${target.dynastyName} rechaza la propuesta de matrimonio de la Casa ${proposer.dynastyName}.`,
    };
  }

  rel.treaties.push('marriage_tie');
  rel.opinion = clamp(rel.opinion + 25, -100, 100);
  state.chronicle.push({
    turn: state.turn,
    kind: 'dinastia',
    text: `En ${chronicleDateText(state)}, las casas ${proposer.dynastyName} y ${target.dynastyName} unieron su sangre en un matrimonio real.`,
  });

  return {
    ok: true,
    message: `La Casa ${target.dynastyName} acepta el matrimonio con la Casa ${proposer.dynastyName}.`,
  };
}

// ---------- alianza ----------

/**
 * Precondición dura para proponer alianza (opinión >= 20, o lazo de sangre
 * ya existente) — consulta PURA, no confundir con el umbral de ACEPTACIÓN
 * de `formAlliance` (más estricto: 25, o 10 con lazo, o amenaza común).
 */
export function allianceRequirement(state: GameState, aId: FactionId, bId: FactionId): string | null {
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return 'Facción desconocida.';
  if (aId === bId) return 'Una facción no puede aliarse consigo misma.';
  if (isAtWar(state, aId, bId)) return 'No se puede sellar una alianza mientras estáis en guerra.';
  const rel = state.relations[relKey(aId, bId)];
  if (rel?.treaties.includes('alliance')) return 'Ya existe una alianza entre ambas casas.';
  const hasMarriage = rel?.treaties.includes('marriage_tie') ?? false;
  if (!((rel?.opinion ?? 0) >= 20 || hasMarriage)) {
    return 'Hace falta una opinión de al menos 20 (o un lazo de sangre) para proponer una alianza.';
  }
  return null;
}

/**
 * Propone una alianza. Acepta si opinión >= 25, o si hay lazo de sangre y
 * opinión >= 10, o si hay una amenaza común (una tercera facción viva en
 * guerra con ambas). Sin componente de azar propio (los umbrales ya
 * arbitran); `rng` se mantiene en la firma por consistencia con el resto de
 * acciones diplomáticas y para uso futuro (Fase 3: sobornos/favores).
 */
export function formAlliance(
  state: GameState, rng: Rng, aId: FactionId, bId: FactionId,
): ActionResult {
  void rng;
  const reason = allianceRequirement(state, aId, bId);
  if (reason) return { ok: false, message: reason };

  const a = state.factions[aId];
  const b = state.factions[bId];
  const rel = getRelation(state, aId, bId);
  const hasMarriage = rel.treaties.includes('marriage_tie');

  const accepted = rel.opinion >= 25
    || (hasMarriage && rel.opinion >= 10)
    || hasCommonThreat(state, aId, bId);
  if (!accepted) {
    return {
      ok: false,
      message: `La Casa ${b.dynastyName} declina la alianza propuesta por la Casa ${a.dynastyName}.`,
    };
  }

  rel.treaties.push('alliance');
  rel.opinion = clamp(rel.opinion + 15, -100, 100);
  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${a.dynastyName} y la Casa ${b.dynastyName} sellaron una alianza.`,
  });

  return {
    ok: true,
    message: `La Casa ${b.dynastyName} acepta la alianza con la Casa ${a.dynastyName}.`,
  };
}

// ---------- no agresión ----------

/** Precondición dura para el pacto de no agresión — consulta PURA. */
export function nonAggressionRequirement(state: GameState, aId: FactionId, bId: FactionId): string | null {
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return 'Facción desconocida.';
  if (aId === bId) return 'Una facción no puede pactar consigo misma.';
  if (isAtWar(state, aId, bId)) return 'No se puede firmar un pacto de no agresión mientras estáis en guerra.';
  const rel = state.relations[relKey(aId, bId)];
  if (rel?.treaties.includes('non_aggression')) return 'Ya hay un pacto de no agresión entre ambas casas.';
  return null;
}

/**
 * Firma un pacto de no agresión. Acepta casi siempre — solo rechaza con
 * opinión < -40. Trae una tregua implícita (`truceUntilTurn = turno + 12`),
 * así que también bloquea `canDeclareWar` mientras dure el propio tratado.
 */
export function signNonAggression(
  state: GameState, rng: Rng, aId: FactionId, bId: FactionId,
): ActionResult {
  void rng; // "casi siempre": el único filtro es el umbral de opinión, sin tirada.
  const reason = nonAggressionRequirement(state, aId, bId);
  if (reason) return { ok: false, message: reason };

  const a = state.factions[aId];
  const b = state.factions[bId];
  const rel = getRelation(state, aId, bId);
  if (rel.opinion < -40) {
    return {
      ok: false,
      message: `La Casa ${b.dynastyName} rechaza el pacto: desprecia demasiado a la Casa ${a.dynastyName}.`,
    };
  }

  rel.treaties.push('non_aggression');
  rel.opinion = clamp(rel.opinion + 8, -100, 100);
  rel.truceUntilTurn = state.turn + 12;
  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${a.dynastyName} y la Casa ${b.dynastyName} firmaron un pacto de no agresión.`,
  });

  return {
    ok: true,
    message: `La Casa ${b.dynastyName} acepta el pacto de no agresión con la Casa ${a.dynastyName}.`,
  };
}

// ---------- romper tratado ----------

/**
 * Rompe un tratado unilateralmente: `breakerId` paga el coste (opinión -30
 * en la relación, legitimidad -10 solo para quien rompe) y `otherId` queda
 * libre de él. Si el tratado roto es 'non_aggression', también limpia la
 * tregua implícita que trajo consigo (si no, `canDeclareWar` seguiría
 * bloqueando por tregua aunque el pacto ya no exista — rompería el sentido
 * de "romperlo primero" para poder declarar la guerra el mismo turno).
 */
export function breakTreaty(
  state: GameState, breakerId: FactionId, otherId: FactionId, treaty: TreatyType,
): ActionResult {
  const breaker = state.factions[breakerId];
  const other = state.factions[otherId];
  if (!breaker || !other) return { ok: false, message: 'Facción desconocida.' };
  const rel = getRelation(state, breakerId, otherId);
  if (!rel.treaties.includes(treaty)) {
    return {
      ok: false,
      message: `No hay ningún tratado de ese tipo entre la Casa ${breaker.dynastyName} y la Casa ${other.dynastyName}.`,
    };
  }

  rel.treaties = rel.treaties.filter((t) => t !== treaty);
  if (treaty === 'non_aggression') delete rel.truceUntilTurn;
  rel.opinion = clamp(rel.opinion - 30, -100, 100);
  breaker.legitimacy = clamp(breaker.legitimacy - 10, 0, 100);

  const flavor = TREATY_BREAK_FLAVOR[treaty];
  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${breaker.dynastyName} rompió ${flavor} con la Casa ${other.dynastyName}, manchando su honor.`,
  });

  return {
    ok: true,
    message: `La Casa ${breaker.dynastyName} rompe ${flavor} con la Casa ${other.dynastyName}.`,
  };
}

// ---------- validación de guerra ----------

/**
 * Consulta PURA (no muta) para saber si `aId` puede declarar la guerra a
 * `bId` ahora mismo: ni guerra activa, ni tregua vigente, ni pacto de no
 * agresión (hay que romperlo primero con `breakTreaty`). El integrador la
 * llama al principio de `actions.ts:declareWar`; mientras tanto, `factionAI`
 * ya la respeta para sus propias declaraciones.
 */
export function canDeclareWar(state: GameState, aId: FactionId, bId: FactionId): { ok: boolean; reason?: string } {
  if (aId === bId) return { ok: false, reason: 'Una facción no puede declararse la guerra a sí misma.' };
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return { ok: false, reason: 'Facción desconocida.' };
  if (isAtWar(state, aId, bId)) {
    return { ok: false, reason: `Ya hay guerra entre ${a.dynastyName} y ${b.dynastyName}.` };
  }
  const rel = state.relations[relKey(aId, bId)];
  if (rel?.truceUntilTurn !== undefined && rel.truceUntilTurn > state.turn) {
    return { ok: false, reason: 'Hay una tregua vigente: no se puede declarar la guerra todavía.' };
  }
  if (rel?.treaties.includes('non_aggression')) {
    return { ok: false, reason: 'Hay un pacto de no agresión vigente: romped el pacto primero.' };
  }
  return { ok: true };
}

// ---------- alianzas y arrastre a la guerra ----------

/** Facciones vivas con alianza activa con `factionId` (orden determinista: el de `state.factions`). */
export function alliesOf(state: GameState, factionId: FactionId): FactionId[] {
  const result: FactionId[] = [];
  for (const otherId of Object.keys(state.factions)) {
    if (otherId === factionId) continue;
    const other = state.factions[otherId];
    if (!other || !other.alive) continue;
    const rel = state.relations[relKey(factionId, otherId)];
    if (rel?.treaties.includes('alliance')) result.push(otherId);
  }
  return result;
}

/**
 * Cuando arranca `war`, arrastra a los aliados DEFENSIVOS del defensor: por
 * cada aliado vivo que no sea ya el propio atacante ni esté ya en guerra con
 * él, crea una guerra espejo (mismo atacante, aliado como defensor, mismo
 * casus belli), penaliza la opinión atacante-aliado en -30 y narra el
 * ingreso en la crónica. Un solo salto (no encadena aliados de aliados: v1,
 * ver GDD §10.1). Devuelve los mensajes narrados (ya en la crónica).
 */
export function joinAlliesToWar(state: GameState, war: War): string[] {
  const messages: string[] = [];
  const attacker = state.factions[war.attackerId];
  const defender = state.factions[war.defenderId];
  if (!attacker || !defender) return messages;

  for (const allyId of alliesOf(state, war.defenderId)) {
    if (allyId === war.attackerId) continue;
    if (isAtWar(state, war.attackerId, allyId)) continue;
    const ally = state.factions[allyId];
    if (!ally || !ally.alive) continue;

    const mirrorWar: War = {
      id: uniqueWarId(state, war.attackerId, allyId),
      attackerId: war.attackerId,
      defenderId: allyId,
      cb: war.cb,
      warScore: 0,
      exhaustionAttacker: 0,
      exhaustionDefender: 0,
      startedTurn: state.turn,
    };
    state.wars.push(mirrorWar);

    const rel = getRelation(state, war.attackerId, allyId);
    rel.opinion = clamp(rel.opinion - 30, -100, 100);

    const text = `En ${chronicleDateText(state)}, la Casa ${ally.dynastyName} acude en defensa de su aliada `
      + `la Casa ${defender.dynastyName} y entra en guerra contra la Casa ${attacker.dynastyName}.`;
    state.chronicle.push({ turn: state.turn, kind: 'guerra', text });
    messages.push(text);
  }

  return messages;
}

// ---------- herencia por matrimonio ----------

/**
 * Si `deadFactionId` tenía lazo(s) de sangre, devuelve la casa ligada VIVA
 * de mayor opinión (desempate determinista por id de facción ascendente).
 * null si no hay ningún lazo o ningún candidato vivo. Consulta PURA: no
 * muta nada — quien llama decide si usar el resultado y luego invoca
 * `transferRealm` por separado.
 */
export function marriageHeirFaction(state: GameState, deadFactionId: FactionId): FactionId | null {
  const candidates: { id: FactionId; opinion: number }[] = [];
  for (const [key, rel] of Object.entries(state.relations)) {
    if (!rel.treaties.includes('marriage_tie')) continue;
    const [a, b] = key.split('|');
    const otherId = a === deadFactionId ? b : b === deadFactionId ? a : null;
    if (!otherId) continue;
    const other = state.factions[otherId];
    if (!other || !other.alive) continue;
    candidates.push({ id: otherId, opinion: rel.opinion });
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => (y.opinion - x.opinion) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return candidates[0].id;
}

/**
 * Transferencia completa del legado de `fromId` a `toId` (v1, GDD §6.2 +
 * §10.1: "unión pacífica si se extingue la otra línea"): las provincias de
 * `fromId` cambian de dueño a `toId`; los ejércitos de `fromId` se disuelven
 * (v1 — sin banderas nuevas ni fusión de tropas, eso es Fase 3). Registra
 * crónica épica y devuelve los mensajes narrados. NO toca `alive` de
 * ninguna de las dos facciones — eso es responsabilidad de quien llama
 * (`turn.ts`, propiedad de otro agente) en la secuencia que le corresponda.
 */
export function transferRealm(state: GameState, fromId: FactionId, toId: FactionId): string[] {
  const messages: string[] = [];
  if (fromId === toId) return messages;
  const from = state.factions[fromId];
  const to = state.factions[toId];
  if (!from || !to) return messages;

  const provinces = state.provinces.filter((p) => p.ownerId === fromId);
  for (const p of provinces) p.ownerId = toId;

  const armyIds = Object.values(state.armies).filter((a) => a.factionId === fromId).map((a) => a.id);
  for (const id of armyIds) delete state.armies[id];

  const realmText = provinces.length > 0
    ? `En ${chronicleDateText(state)}, la Casa ${to.dynastyName} hereda las tierras de la extinta Casa `
      + `${from.dynastyName} por derecho de sangre: ${provinces.length} provincia(s) cambian de bandera sin una sola espada.`
    : `En ${chronicleDateText(state)}, la Casa ${to.dynastyName} reclama el legado vacío de la extinta Casa ${from.dynastyName}.`;
  state.chronicle.push({ turn: state.turn, kind: 'dinastia', text: realmText });
  messages.push(realmText);

  if (armyIds.length > 0) {
    const armyText = `Sin un señor de la Casa ${from.dynastyName} que las dirija, sus huestes se disuelven.`;
    state.chronicle.push({ turn: state.turn, kind: 'dinastia', text: armyText });
    messages.push(armyText);
  }

  return messages;
}
