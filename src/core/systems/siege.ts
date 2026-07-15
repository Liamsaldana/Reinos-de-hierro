/**
 * Asedios (Fase 2, GDD §9.2, alcance v1: bloqueo por provisiones + asalto).
 * AGENTE O: módulo nuevo.
 *
 * Diseño: un asedio se abre cuando un ejército entra en una provincia
 * ENEMIGA (con dueño, en guerra — nunca tierra sin señor) suficientemente
 * fortificada (umbral exacto en `actions.ts:SIEGE_MIN_FORT_LEVEL`, ver el
 * comentario ahí para la calibración) defendida solo por guarnición, sin
 * ejércitos hostiles en campo (ver `actions.ts:moveArmy`/`triggersSiege`,
 * que deciden CUÁNDO llamar a `startSiege` en vez de resolver batalla
 * instantánea — este módulo no conoce ni impone ese umbral). Cada turno,
 * `tickSieges` hace que el hambre erosione las provisiones de la guarnición
 * y la atrición desgaste al sitiador; si las provisiones llegan a 0, la
 * plaza se rinde. El jugador (o la IA, vía el mismo `assaultSiege`) puede
 * forzar el desenlace con un asalto que reutiliza el motor de auto-resolución
 * normal — el bono de fortificación ya vive ahí (`combat/autoresolve.ts`).
 *
 * Fuera de alcance v1 (documentado, no implementado): un ejército de socorro
 * que llegue a reforzar la provincia sitiada NO rompe el cerco ni lo
 * convierte en batalla campal a mitad de asedio (si el jugador quiere
 * forzarlo, tiene `assaultSiege`/`assaultSiegeTactical`). El "salvavidas" de
 * abajo sí cubre el caso de que la guerra termine (paz) o la provincia
 * cambie de dueño por otra vía mientras el cerco sigue abierto: se levanta
 * solo, sin crash.
 */
import type {
  Army, ArmyId, BattleReport, FactionId, GameState, Province, ProvinceId, Siege,
} from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import type { GameStore } from '../state/store';
import { resolveBattleAt } from '../combat/autoresolve';
import { occupyProvince, type ActionResult } from './actions';

// ---------- calibración (GDD §9.2) ----------
const PROVISIONS_MIN_MAX = 400;
const PROVISIONS_LOSS = 120;
const PROVISIONS_LOSS_WINTER = 180;
const ATTRITION_PCT = 0.02;
const ATTRITION_PCT_WINTER = 0.04;

// ---------- helpers internos ----------

function findProvince(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find(p => p.id === id);
}

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(
    w => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

function uniqueSiegeId(state: GameState, provinceId: ProvinceId): string {
  const sieges = state.sieges ?? [];
  let n = 1;
  let id = `siege_${provinceId}_${state.turn}`;
  while (sieges.some(s => s.id === id)) {
    n += 1;
    id = `siege_${provinceId}_${state.turn}_${n}`;
  }
  return id;
}

/** provisiones máximas de un asedio: guarnición×2 + fortificación×300, mínimo 400. */
function computeProvisionsMax(province: Province): number {
  return Math.max(PROVISIONS_MIN_MAX, province.garrison * 2 + province.settlement.fortLevel * 300);
}

function armiesPresent(state: GameState, ids: ArmyId[], provinceId: ProvinceId): ArmyId[] {
  return ids.filter(id => {
    const a = state.armies[id];
    return !!a && a.provinceId === provinceId;
  });
}

function applyAttrition(state: GameState, armyIds: ArmyId[], pct: number): void {
  for (const armyId of armyIds) {
    const army: Army | undefined = state.armies[armyId];
    if (!army) continue;
    for (const u of army.units) {
      if (u.men <= 0) continue;
      let loss = Math.floor(u.men * pct);
      if (u.men > 20 && loss < 1) loss = 1;
      u.men = Math.max(0, u.men - loss);
    }
    army.units = army.units.filter(u => u.men > 0);
    if (army.units.length === 0) delete state.armies[armyId];
  }
}

// ---------- API pública ----------

/**
 * Abre el cerco sobre `provinceId` con el ejército `armyId`. Si ya hay un
 * asedio propio (misma facción atacante) en curso ahí, el ejército se suma
 * a `besiegerArmyIds` en vez de abrir uno nuevo (idempotente). MUTA
 * `state.sieges` (lo crea si hace falta).
 */
export function startSiege(state: GameState, armyId: ArmyId, provinceId: ProvinceId): Siege {
  state.sieges ??= [];
  const army = state.armies[armyId];
  const province = findProvince(state, provinceId);
  if (!army || !province) {
    throw new Error(`startSiege: ejército o provincia inválidos (${armyId}, ${provinceId})`);
  }

  const existing = state.sieges.find(
    s => s.provinceId === provinceId && s.attackerFactionId === army.factionId,
  );
  if (existing) {
    if (!existing.besiegerArmyIds.includes(armyId)) existing.besiegerArmyIds.push(armyId);
    return existing;
  }

  const provisionsMax = computeProvisionsMax(province);
  const siege: Siege = {
    id: uniqueSiegeId(state, provinceId),
    provinceId,
    attackerFactionId: army.factionId,
    besiegerArmyIds: [armyId],
    provisions: provisionsMax,
    provisionsMax,
    startedTurn: state.turn,
  };
  state.sieges.push(siege);
  return siege;
}

/** Levanta el asedio (el jugador se retira, o ya se resolvió por otra vía). No juzga por qué. */
export function liftSiege(state: GameState, siegeId: string): void {
  state.sieges ??= [];
  state.sieges = state.sieges.filter(s => s.id !== siegeId);
}

/**
 * Avanza todos los asedios activos un turno: el hambre come provisiones
 * (peor en invierno) y la atrición desgasta al sitiador (peor en invierno);
 * levanta el cerco si el sitiador ya no está presente o pereció, o si la
 * guerra que lo sostenía ya no existe; rinde la plaza si las provisiones se
 * agotan (guarnición a 0, ocupación, crónica con sabor). Devuelve, en
 * español, los mensajes relevantes para el jugador (asedios donde ataca o
 * donde defiende) — pensados para el informe de turno del integrador.
 */
export function tickSieges(state: GameState, rng: Rng): string[] {
  void rng; // el desgaste es determinista (porcentajes fijos); no consume aleatoriedad.
  state.sieges ??= [];
  if (state.sieges.length === 0) return [];

  const winter = seasonOf(state.turn) === 3;
  const provisionsLoss = winter ? PROVISIONS_LOSS_WINTER : PROVISIONS_LOSS;
  const attritionPct = winter ? ATTRITION_PCT_WINTER : ATTRITION_PCT;
  const playerId = state.playerFactionId;
  const messages: string[] = [];
  const stillActive: Siege[] = [];

  for (const siege of state.sieges) {
    const province = findProvince(state, siege.provinceId);
    if (!province) continue; // provincia inexistente: no debería pasar, descarta en silencio.

    const involvesPlayer = siege.attackerFactionId === playerId || province.ownerId === playerId;

    // Salvavidas: si ya no hay guerra que sostenga el cerco (paz firmada, o
    // la provincia cambió de dueño por otra vía), se levanta solo.
    if (province.ownerId === siege.attackerFactionId
      || province.ownerId === null
      || !isAtWar(state, siege.attackerFactionId, province.ownerId)) {
      if (involvesPlayer) {
        messages.push(`El cerco sobre ${province.name} se levanta: ya no hay guerra que lo sostenga.`);
      }
      continue;
    }

    const present = armiesPresent(state, siege.besiegerArmyIds, siege.provinceId);
    if (present.length === 0) {
      if (involvesPlayer) {
        messages.push(`El cerco sobre ${province.name} se levanta: la hueste sitiadora ya no está.`);
      }
      continue;
    }
    siege.besiegerArmyIds = present;

    // atrición del sitiador: el hambre también muerde a quien sitia.
    applyAttrition(state, present, attritionPct);
    siege.besiegerArmyIds = siege.besiegerArmyIds.filter(id => !!state.armies[id]);

    if (siege.besiegerArmyIds.length === 0) {
      if (involvesPlayer) {
        messages.push(`El cerco sobre ${province.name} se levanta: la hueste sitiadora pereció de hambre y fatiga.`);
      }
      continue;
    }

    siege.provisions -= provisionsLoss;

    if (siege.provisions <= 0) {
      const turnsElapsed = Math.max(1, state.turn - siege.startedTurn);
      const siegeFlavor = `tras ${turnsElapsed} estación${turnsElapsed === 1 ? '' : 'es'} de cerco, `
        + `${province.name} abrió sus puertas por hambre`;
      province.garrison = 0;
      occupyProvince(state, siege.attackerFactionId, province);
      state.chronicle.push({
        turn: state.turn,
        kind: 'guerra',
        text: `En ${chronicleDateText(state)}, ${siegeFlavor}.`,
      });
      if (involvesPlayer) {
        messages.push(`${siegeFlavor.charAt(0).toUpperCase()}${siegeFlavor.slice(1)}.`);
      }
      continue;
    }

    stillActive.push(siege);
  }

  state.sieges = stillActive;
  return messages;
}

/**
 * Asalto auto-resuelto: reutiliza `resolveBattleAt` tal cual (el bono de
 * fortificación ya vive en el motor de combate) contra la guarnición de la
 * plaza sitiada. Si gana el atacante, la plaza cae (ocupa y cierra el
 * asedio). Si pierde, el asedio continúa — salvo que la derrota se lleve
 * puesta a toda la hueste sitiadora, caso en que se levanta solo.
 */
export function assaultSiege(state: GameState, rng: Rng, siegeId: string): ActionResult {
  state.sieges ??= [];
  const siege = state.sieges.find(s => s.id === siegeId);
  if (!siege) return { ok: false, message: 'Ese asedio no existe.' };
  const province = findProvince(state, siege.provinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };

  const present = armiesPresent(state, siege.besiegerArmyIds, siege.provinceId);
  if (present.length === 0) {
    liftSiege(state, siegeId);
    return { ok: false, message: `No quedan huestes propias en ${province.name} para dar el asalto.` };
  }

  const battle = resolveBattleAt(state, rng, siege.attackerFactionId, siege.provinceId);

  if (battle.winner === 'attacker') {
    if (province.ownerId !== siege.attackerFactionId) {
      occupyProvince(state, siege.attackerFactionId, province);
    }
    liftSiege(state, siegeId);
    return { ok: true, message: `El asalto rompe las murallas de ${province.name}: la plaza cae.`, battle };
  }

  siege.besiegerArmyIds = armiesPresent(state, siege.besiegerArmyIds, siege.provinceId);
  if (siege.besiegerArmyIds.length === 0) {
    liftSiege(state, siegeId);
    return {
      ok: true,
      message: `El asalto a ${province.name} fracasa y la hueste sitiadora es rechazada del todo: el cerco se levanta.`,
      battle,
    };
  }
  return {
    ok: true,
    message: `El asalto a ${province.name} fracasa: el cerco continúa, exhausto pero firme.`,
    battle,
  };
}

/**
 * Aplica el desenlace de un asalto de asedio TÁCTICO: mismo criterio que la
 * rama post-`resolveBattleAt` de `assaultSiege` (ganar y guarnición a 0 →
 * ocupa y cierra; perder → el cerco sigue, salvo que ya no quede sitiador),
 * pero separado de `assaultSiegeTactical` para poder testearlo sin DOM ni
 * Phaser — mismo patrón que `game/battleFlow.ts::finishTacticalOnMap`.
 */
export function finishSiegeAssaultTactical(
  state: GameState, siegeId: string, report: BattleReport,
): void {
  const siege = (state.sieges ?? []).find(s => s.id === siegeId);
  if (!siege) return;
  const province = findProvince(state, siege.provinceId);
  if (!province) return;

  if (report.winner === 'attacker') {
    if (province.ownerId !== siege.attackerFactionId) {
      occupyProvince(state, siege.attackerFactionId, province);
    }
    liftSiege(state, siegeId);
    return;
  }

  siege.besiegerArmyIds = armiesPresent(state, siege.besiegerArmyIds, province.id);
  if (siege.besiegerArmyIds.length === 0) liftSiege(state, siegeId);
}

/**
 * Asalto "en persona": abre la batalla táctica a pantalla completa (mismo
 * patrón que `game/battleFlow.ts::launchTacticalBattle`, que es del
 * integrador y no se toca) y, al terminar, aplica `finishSiegeAssaultTactical`.
 * Vive en este módulo por instrucción explícita del encargo — es la ÚNICA
 * función de `core/systems/siege.ts` que toca DOM/import dinámico de render;
 * el resto del archivo es núcleo puro. Se resuelve cuando el jugador cierra
 * la batalla táctica (onDone).
 */
export async function assaultSiegeTactical(store: GameStore, siegeId: string): Promise<void> {
  const siege = (store.state.sieges ?? []).find(s => s.id === siegeId);
  if (!siege) return;
  const { provinceId, attackerFactionId } = siege;
  const province = store.state.provinces.find(p => p.id === provinceId);
  if (!province) return;

  const present = armiesPresent(store.state, siege.besiegerArmyIds, provinceId);
  if (present.length === 0) {
    store.mutate(s => liftSiege(s, siegeId), { type: 'map-changed' });
    return;
  }

  const { openTacticalBattle } = await import('../../render/battle/battleScene');

  const overlay = document.createElement('div');
  overlay.setAttribute('aria-label', 'Asalto de asedio');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100',
    background: '#14110f',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);

  const rng = store.rng();

  await new Promise<void>(resolve => {
    openTacticalBattle({
      container: overlay,
      state: store.state,
      rng,
      attackerFactionId,
      provinceId,
      playerFactionId: store.state.playerFactionId,
      onDone: report => {
        store.mutate(s => finishSiegeAssaultTactical(s, siegeId, report), { type: 'map-changed' });
        overlay.remove();
        store.emit({ type: 'battle', report });
        resolve();
      },
    });
  });
}
