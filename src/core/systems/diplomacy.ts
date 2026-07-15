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
 *
 * AGENTE U (Fase 3, GDD §10 "poder blando"): sumó vasallaje (`proposeVassalage`
 * + el arrastre de VASALLOS a la guerra en `joinAlliesToWar`, single-hop,
 * mismo patrón que los aliados) y sobornos (`bribeOpinion`,
 * `bribeBreakAlliance`) — todo aditivo, sin tocar las firmas existentes.
 * También añadió el veto de vasallos en `canDeclareWar` (un vasallo no
 * declara guerra por su cuenta; a un vasallo no se le declara la guerra
 * directamente, se le declara a su señor) y, en `breakTreaty`, la limpieza
 * de `vassalOfId` cuando el tratado roto es 'vassalage' (mismo patrón que ya
 * existía para limpiar `truceUntilTurn` al romper 'non_aggression' — sin
 * esto, romper el vínculo dejaría `Faction.vassalOfId` desincronizado del
 * propio tratado). El resto del archivo es de AGENTE R. Comercio/lujos
 * (`tradeIncome`, `luxuryLegitimacy`, `tributeFlows`, `proposeTradeTreaty`) y
 * espionaje (`sabotageGarrison`, `scoutFaction`) viven en módulos nuevos
 * separados: `./trade` y `./espionage` (mismo motivo que separó
 * `religion.ts` de `economy.ts` en Fase 2: módulo nuevo y chico en vez de
 * inflar uno existente).
 */
import type {
  DiploRelation, FactionId, GameState, TreatyType, War,
} from '../types';
import { relKey, seasonOf, yearOf, SEASON_NAMES } from '../types';
import type { Rng } from '../state/rng';
import { clamp, provincesOf } from './economy';
import type { ActionResult } from './actions';
import { armyStrength } from '../combat/autoresolve';

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
  trade: 'su tratado comercial',
  vassalage: 'su juramento de vasallaje',
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
  // Vasallaje (Fase 3, AGENTE U): romperlo debe liberar de verdad — si no se
  // limpia `vassalOfId`, quedaría desincronizado del propio tratado (el
  // vasallo seguiría vetado en `canDeclareWar`/arrastrado en
  // `joinAlliesToWar`/cobrado en `tributeFlows` sin que exista ya el vínculo).
  if (treaty === 'vassalage') {
    if (other.vassalOfId === breakerId) other.vassalOfId = null;
    else if (breaker.vassalOfId === otherId) breaker.vassalOfId = null;
  }
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
  // Vasallaje (Fase 3, GDD §10, AGENTE U): un vasallo no declara guerras por
  // su cuenta, y a un vasallo no se le declara la guerra directamente — hay
  // que declarársela a su señor (que arrastrará a sus vasallos consigo, ver
  // `joinAlliesToWar`).
  if (a.vassalOfId) {
    return {
      ok: false,
      reason: `${a.dynastyName} es vasalla y no puede declarar la guerra por su cuenta: debe seguir a su señor.`,
    };
  }
  if (b.vassalOfId) {
    const overlord = state.factions[b.vassalOfId];
    return {
      ok: false,
      reason: `${b.dynastyName} es vasalla de ${overlord ? overlord.dynastyName : b.vassalOfId}: declarad la guerra a su señor.`,
    };
  }
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

  // Vasallaje arrastra a la guerra (Fase 3, GDD §10, AGENTE U): mismo patrón
  // que los aliados de arriba (guerra espejo + opinión -30 + crónica), pero
  // por juramento de vasallaje en vez de alianza. Un solo salto (no arrastra
  // vasallos de vasallos). Se duplica el cuerpo del bucle en vez de
  // refactorizar el de arriba a propósito: cero riesgo de tocar el
  // comportamiento ya probado de los aliados (mismo motivo documentado en
  // el docstring del archivo). El guard `isAtWar` de abajo también evita una
  // guerra duplicada si una facción fuese, a la vez, aliada Y vasalla del
  // defensor (el bucle de aliados ya la habría metido en guerra primero).
  for (const vassalId of vassalsOf(state, war.defenderId)) {
    if (vassalId === war.attackerId) continue;
    if (isAtWar(state, war.attackerId, vassalId)) continue;
    const vassal = state.factions[vassalId];
    if (!vassal || !vassal.alive) continue;

    const mirrorWar: War = {
      id: uniqueWarId(state, war.attackerId, vassalId),
      attackerId: war.attackerId,
      defenderId: vassalId,
      cb: war.cb,
      warScore: 0,
      exhaustionAttacker: 0,
      exhaustionDefender: 0,
      startedTurn: state.turn,
    };
    state.wars.push(mirrorWar);

    const rel = getRelation(state, war.attackerId, vassalId);
    rel.opinion = clamp(rel.opinion - 30, -100, 100);

    const text = `En ${chronicleDateText(state)}, la Casa ${vassal.dynastyName}, vasalla de la Casa `
      + `${defender.dynastyName}, acude en su defensa por juramento de sangre y entra en guerra contra `
      + `la Casa ${attacker.dynastyName}.`;
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

// ============================================================================
// AGENTE U — vasallaje y sobornos (Fase 3, GDD §10 "poder blando")
// ============================================================================

// ---------- vasallaje ----------

/** Fuerza militar total de la facción (duplicado a propósito, ver docstring del archivo). */
function factionTotalStrength(state: GameState, factionId: FactionId): number {
  return Object.values(state.armies)
    .filter((a) => a.factionId === factionId)
    .reduce((sum, a) => sum + armyStrength(state, a), 0);
}

/** warScore de la guerra entre `factionId` y `otherId`, visto desde `factionId`; null si no están en guerra. */
function warScoreFor(state: GameState, factionId: FactionId, otherId: FactionId): number | null {
  const war = state.wars.find(
    (w) => (w.attackerId === factionId && w.defenderId === otherId)
      || (w.attackerId === otherId && w.defenderId === factionId),
  );
  if (!war) return null;
  return war.attackerId === factionId ? war.warScore : -war.warScore;
}

/** Facciones vivas vasallas de `factionId` (single-hop: no vasallos de vasallos, GDD v1). */
export function vassalsOf(state: GameState, factionId: FactionId): FactionId[] {
  const result: FactionId[] = [];
  for (const otherId of Object.keys(state.factions)) {
    if (otherId === factionId) continue;
    const other = state.factions[otherId];
    if (!other || !other.alive) continue;
    if (other.vassalOfId === factionId) result.push(otherId);
  }
  return result;
}

/**
 * Precondición dura para exigir vasallaje — consulta PURA. A propósito NO
 * exige paz (a diferencia de matrimonio/alianza/no-agresión): el caso de uso
 * típico es justo lo contrario, exigir la rodilla a quien ya va perdiendo
 * una guerra.
 */
export function vassalageRequirement(state: GameState, lordId: FactionId, vassalId: FactionId): string | null {
  const lord = state.factions[lordId];
  const vassal = state.factions[vassalId];
  if (!lord || !vassal) return 'Facción desconocida.';
  if (lordId === vassalId) return 'Una facción no puede exigirse vasallaje a sí misma.';
  if (vassal.vassalOfId) {
    return vassal.vassalOfId === lordId
      ? 'Esa casa ya es vasalla vuestra.'
      : 'Esa casa ya es vasalla de otro señor.';
  }
  if (lord.vassalOfId) return 'Una casa vasalla no puede exigir vasallaje a otras.';
  return null;
}

/**
 * Exige vasallaje a `vassalId`. La casa objetivo ACEPTA solo si va perdiendo
 * fuerte: su fuerza militar total es menor que 0.45x la del señor, Y además
 * (está en guerra con él con warScore < -30 desde su propia perspectiva, O
 * le quedan 2 provincias o menos). Sin tirada propia (el umbral ya arbitra,
 * igual que `formAlliance`/`signNonAggression`); `rng` se mantiene en la
 * firma por consistencia con el resto de propuestas diplomáticas.
 * Aceptado: treaty 'vassalage', `vassal.vassalOfId = lordId`, termina la
 * guerra entre ambos si la había, opinión +20, crónica ("hincó la rodilla").
 * Rechazado: sin penalización (como `formAlliance`/`signNonAggression` —
 * proponer no insulta, a diferencia de `proposeMarriage`).
 */
export function proposeVassalage(
  state: GameState, rng: Rng, lordId: FactionId, vassalId: FactionId,
): ActionResult {
  void rng;
  const reason = vassalageRequirement(state, lordId, vassalId);
  if (reason) return { ok: false, message: reason };

  const lord = state.factions[lordId];
  const vassal = state.factions[vassalId];

  const lordStrength = factionTotalStrength(state, lordId);
  const vassalStrength = factionTotalStrength(state, vassalId);
  const overwhelmed = vassalStrength < 0.45 * lordStrength;
  const myWarScore = warScoreFor(state, vassalId, lordId);
  const losingWar = myWarScore !== null && myWarScore < -30;
  const fewProvinces = provincesOf(state, vassalId).length <= 2;

  if (!(overwhelmed && (losingWar || fewProvinces))) {
    return {
      ok: false,
      message: `La Casa ${vassal.dynastyName} rechaza hincar la rodilla ante la Casa ${lord.dynastyName}: aún puede resistir.`,
    };
  }

  const activeWar = state.wars.find(
    (w) => (w.attackerId === lordId && w.defenderId === vassalId)
      || (w.attackerId === vassalId && w.defenderId === lordId),
  );
  if (activeWar) {
    state.wars = state.wars.filter((w) => w.id !== activeWar.id);
  }

  const rel = getRelation(state, lordId, vassalId);
  rel.treaties.push('vassalage');
  rel.opinion = clamp(rel.opinion + 20, -100, 100);
  vassal.vassalOfId = lordId;

  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${vassal.dynastyName} hincó la rodilla ante la Casa `
      + `${lord.dynastyName} y juró vasallaje.`,
  });

  return {
    ok: true,
    message: `La Casa ${vassal.dynastyName} acepta el vasallaje bajo la Casa ${lord.dynastyName}.`,
  };
}

// ---------- soborno ----------

const BRIBE_OPINION_COST = 50;
const BRIBE_OPINION_GAIN = 15;
const BRIBE_BREAK_ALLIANCE_COST = 120;

/** Precondición dura para el soborno simple — consulta PURA (solo hace falta el oro). */
export function bribeOpinionRequirement(state: GameState, aId: FactionId, bId: FactionId): string | null {
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return 'Facción desconocida.';
  if (aId === bId) return 'Una facción no puede sobornarse a sí misma.';
  if (a.gold < BRIBE_OPINION_COST) {
    return `Hace falta oro para el soborno (cuesta ${BRIBE_OPINION_COST}, tenéis ${a.gold}).`;
  }
  return null;
}

/**
 * Soborno simple: `aId` paga a la corte de `bId` por buena voluntad. Sin
 * tirada ni rechazo — el oro habla siempre que alcance para pagarlo (a
 * diferencia de `bribeBreakAlliance`, aquí no hay umbral de opinión que lo
 * bloquee). LÍMITE v1 documentado a propósito: la especificación pide "cap 1
 * uso por par por turno", pero imponerlo de verdad exige una marca de turno
 * nueva en `DiploRelation` (o un contador), y `types.ts` NO es de este
 * agente en esta fase — queda como deuda técnica explícita, no como bug
 * escondido: por ahora nada impide sobornar más de una vez el mismo turno
 * salvo el propio oro disponible. Candidato para cuando `types.ts` esté
 * disponible: `DiploRelation.bribedUntilTurn`. Sin crónica a propósito: es
 * un soborno, no un acto público (a diferencia de tratados/matrimonios).
 */
export function bribeOpinion(
  state: GameState, rng: Rng, aId: FactionId, bId: FactionId,
): ActionResult {
  void rng;
  const reason = bribeOpinionRequirement(state, aId, bId);
  if (reason) return { ok: false, message: reason };

  const a = state.factions[aId];
  const b = state.factions[bId];
  a.gold -= BRIBE_OPINION_COST;
  const rel = getRelation(state, aId, bId);
  rel.opinion = clamp(rel.opinion + BRIBE_OPINION_GAIN, -100, 100);

  return {
    ok: true,
    message: `La Casa ${a.dynastyName} soborna a la corte de la Casa ${b.dynastyName} `
      + `(+${BRIBE_OPINION_GAIN} opinión, -${BRIBE_OPINION_COST} de oro).`,
  };
}

/**
 * Soborno de ruptura: `briberId` paga para que `targetId` rompa SU alianza
 * con `thirdId`. La casa `targetId` acepta solo si su propia opinión hacia
 * `thirdId` es < 20 (una alianza que ya valora poco es más fácil de
 * comprar) — sin tirada, umbral puro. Aceptado: cobra el oro a `briberId` y
 * ejecuta `breakTreaty` sobre `targetId`↔`thirdId` (mismo coste de
 * opinión/legitimidad que romper cualquier tratado: el soborno no exime a
 * `targetId` de la mancha de romper su palabra, solo la provoca; la crónica
 * de la ruptura ya la escribe `breakTreaty`, no se duplica aquí). Rechazado:
 * sin coste para nadie — el oro nunca cambia de manos si `targetId` no
 * muerde.
 */
export function bribeBreakAlliance(
  state: GameState, rng: Rng, briberId: FactionId, targetId: FactionId, thirdId: FactionId,
): ActionResult {
  void rng;
  const briber = state.factions[briberId];
  const target = state.factions[targetId];
  const third = state.factions[thirdId];
  if (!briber || !target || !third) return { ok: false, message: 'Facción desconocida.' };
  if (briberId === targetId || briberId === thirdId || targetId === thirdId) {
    return { ok: false, message: 'Hacen falta tres casas distintas para este soborno.' };
  }
  const rel = state.relations[relKey(targetId, thirdId)];
  if (!rel?.treaties.includes('alliance')) {
    return {
      ok: false,
      message: `No hay alianza entre la Casa ${target.dynastyName} y la Casa ${third.dynastyName} que romper.`,
    };
  }
  if (briber.gold < BRIBE_BREAK_ALLIANCE_COST) {
    return {
      ok: false,
      message: `Hace falta oro para el soborno (cuesta ${BRIBE_BREAK_ALLIANCE_COST}, tenéis ${briber.gold}).`,
    };
  }
  if (rel.opinion >= 20) {
    return {
      ok: false,
      message: `La Casa ${target.dynastyName} rechaza el soborno: su alianza con la Casa ${third.dynastyName} vale más que el oro.`,
    };
  }

  briber.gold -= BRIBE_BREAK_ALLIANCE_COST;
  const broken = breakTreaty(state, targetId, thirdId, 'alliance');

  return {
    ok: true,
    message: `El oro de la Casa ${briber.dynastyName} corrompe a la Casa ${target.dynastyName}: ${broken.message}`,
  };
}
