/**
 * Acciones del jugador y de la IA (comandos sobre el estado).
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type {
  Army, ArmyId, BattleReport, CasusBelli, DiploRelation, FactionId, GameState, Province,
  ProvinceId, UnitInstance, UnitTypeId, War,
} from '../types';
import { SEASON_NAMES, relKey, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import { getUnitType } from '../content/units';
import { resolveBattleAt } from '../combat/autoresolve';
import { startSiege } from './siege';
import { canDeclareWar, joinAlliesToWar } from './diplomacy';
import { isUnitUnlocked } from './research';
import { clamp, factionHasResource } from './economy';

export interface ActionResult {
  ok: boolean;
  /** mensaje en español para la UI ("No hay oro suficiente") */
  message: string;
  battle?: BattleReport | null;
}

// ---------- helpers internos ----------

function findProvince(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find(p => p.id === id);
}

function uniqueArmyId(state: GameState, factionId: FactionId): ArmyId {
  let n = 1;
  let id = `army_${factionId}_${n}`;
  while (state.armies[id]) {
    n += 1;
    id = `army_${factionId}_${n}`;
  }
  return id;
}

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(
    w => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

function findWar(state: GameState, a: FactionId, b: FactionId): War | undefined {
  return state.wars.find(
    w => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
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

/** true si hay algo que defienda la provincia frente a `movingFactionId`. */
function hasDefense(state: GameState, province: Province, movingFactionId: FactionId): boolean {
  if (province.garrison > 0) return true;
  return Object.values(state.armies).some(
    a => a.provinceId === province.id && a.factionId !== movingFactionId,
  );
}

/**
 * Fortificación mínima que abre asedio en vez de batalla instantánea.
 * CALIBRACIÓN (evidence/dogfood_atelier.md del runtime de construcción, ver
 * reporte del Agente O): `content/mapgen.ts` sortea `fortLevel` 0/1 para
 * TODA provincia normal (nunca 2/3); solo las capitales llegan a fortLevel 2
 * (`content/newGame.ts`). Con el umbral en 1 (el de la spec original), el
 * harness de simulación (`tests/simulation.test.ts`, sin jugador) se
 * atascaba en la semilla 47: sin `tickSieges` todavía cableado en
 * `turn.ts:endTurn` (tarea del integrador — ver KERNEL.md v.s. este reporte),
 * un asedio nunca se resuelve solo, y el BFS de `factionAI.ts` siempre repite
 * el objetivo enemigo MÁS CERCANO — si ese objetivo es una `empalizada`
 * (fortLevel 1) con guarnición, TODOS los ejércitos de esa facción se
 * apilan ahí para siempre (una semilla mostró 11 sitiadores en un único
 * cerco muerto) y la facción no vuelve a conquistar nada en 30 turnos.
 * Subir el umbral a 2 (muralla/ciudadela: solo capitales) deja intacta la
 * velocidad de conquista de siempre para el 90% del mapa (empalizadas caen
 * en batalla instantánea, como antes de esta feature) y reserva el asedio
 * de verdad para el blanco narrativamente correcto — la capital enemiga —
 * sin bloquear al mundo sin jugador. Candidato a bajar a 1 en cuanto el
 * integrador cablee `tickSieges` en `endTurn` (con eso, un asedio SÍ se
 * resuelve solo en unos turnos y este riesgo desaparece).
 */
const SIEGE_MIN_FORT_LEVEL = 1; // tickSieges ya vive en endTurn: empalizadas también sitian

/** true si hay ejércitos de otra facción físicamente en la provincia (fuera de los muros). */
function hasFieldArmies(state: GameState, provinceId: ProvinceId, movingFactionId: FactionId): boolean {
  return Object.values(state.armies).some(
    a => a.provinceId === provinceId && a.factionId !== movingFactionId,
  );
}

/**
 * true si entrar en `province` con `movingFactionId` abre un ASEDIO (Fase 2,
 * GDD §9.2) en vez de una batalla instantánea: la provincia tiene dueño
 * enemigo (nunca tierra sin señor — `legalMoves` ya garantiza que si hay
 * dueño distinto es porque hay guerra), está fortificada, la defiende su
 * guarnición, y NO hay ejércitos hostiles en campo (esos sí dan batalla
 * campal normal, como hoy).
 */
function triggersSiege(state: GameState, province: Province, movingFactionId: FactionId): boolean {
  const hostileOwned = province.ownerId !== null && province.ownerId !== movingFactionId;
  if (!hostileOwned) return false;
  if (province.settlement.fortLevel < SIEGE_MIN_FORT_LEVEL || province.garrison <= 0) return false;
  return !hasFieldArmies(state, province.id, movingFactionId);
}

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

/** Cambia el dueño de la provincia, registra crónica y ajusta warScore si aplica. */
export function occupyProvince(state: GameState, factionId: FactionId, province: Province): void {
  const prevOwnerId = province.ownerId;
  province.ownerId = factionId;
  const conqueror = state.factions[factionId];
  const flavor = prevOwnerId
    ? `la Casa ${conqueror.dynastyName} tomó ${province.name}`
    : `la Casa ${conqueror.dynastyName} reclamó las tierras sin señor de ${province.name}`;
  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, ${flavor}.`,
  });

  if (prevOwnerId) {
    const war = findWar(state, factionId, prevOwnerId);
    if (war) {
      const magnitude = province.settlement.level === 4 ? 25 : 15;
      const delta = war.attackerId === factionId ? magnitude : -magnitude;
      war.warScore = clamp(war.warScore + delta, -100, 100);
    }
  }
}

// ---------- acciones exportadas ----------

/**
 * Recluta una unidad en una provincia propia: cobra coste, valida recursos
 * estratégicos del reino (hierro/caballos), y la añade al ejército propio
 * estacionado ahí (o crea uno nuevo).
 */
export function recruitUnit(
  state: GameState, rng: Rng,
  factionId: FactionId, provinceId: ProvinceId, typeId: UnitTypeId,
): ActionResult {
  void rng;
  const faction = state.factions[factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };

  const province = findProvince(state, provinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };
  if (province.ownerId !== factionId) {
    return { ok: false, message: `No controlas ${province.name}: no puedes reclutar ahí.` };
  }

  let unitType;
  try {
    unitType = getUnitType(typeId);
  } catch {
    return { ok: false, message: `Tipo de unidad desconocido: ${typeId}` };
  }
  if (!isUnitUnlocked(state, factionId, typeId)) {
    return { ok: false, message: `Aún no se ha investigado la tecnología que permite reclutar ${unitType.name}.` };
  }
  const cost = unitType.cost;

  if (faction.gold < cost.gold) {
    return {
      ok: false,
      message: `No hay oro suficiente: cuesta ${cost.gold}, tienes ${faction.gold}`,
    };
  }
  if (faction.manpower < cost.manpower) {
    return {
      ok: false,
      message: `No hay levas suficientes: cuesta ${cost.manpower}, tienes ${faction.manpower}`,
    };
  }
  if (cost.iron && cost.iron > 0 && !factionHasResource(state, factionId, 'iron')) {
    return {
      ok: false,
      message: `Se necesita una provincia con hierro para reclutar ${unitType.name}.`,
    };
  }
  if (cost.horses && cost.horses > 0 && !factionHasResource(state, factionId, 'horses')) {
    return {
      ok: false,
      message: `Se necesita una provincia con caballos para reclutar ${unitType.name}.`,
    };
  }

  faction.gold -= cost.gold;
  faction.manpower -= cost.manpower;

  const instance: UnitInstance = {
    typeId, men: unitType.menMax, morale: unitType.moraleMax, xp: 0,
  };

  let army: Army | undefined = Object.values(state.armies).find(
    a => a.factionId === factionId && a.provinceId === provinceId,
  );
  if (!army) {
    army = {
      id: uniqueArmyId(state, factionId),
      name: `Hueste de ${faction.dynastyName}`,
      factionId,
      provinceId,
      units: [],
      generalId: null,
      movement: 0,
      movementMax: 2,
    };
    state.armies[army.id] = army;
  }
  army.units.push(instance);

  return { ok: true, message: `Reclutado: ${unitType.name} en ${province.name}.` };
}

/** Provincias a las que el ejército puede moverse este turno (para UI/IA). */
export function legalMoves(state: GameState, armyId: ArmyId): ProvinceId[] {
  const army = state.armies[armyId];
  if (!army || army.movement <= 0) return [];
  const current = findProvince(state, army.provinceId);
  if (!current) return [];
  return current.neighbors.filter(nid => {
    const p = findProvince(state, nid);
    if (!p) return false;
    if (p.ownerId === null) return true;
    if (p.ownerId === army.factionId) return true;
    return isAtWar(state, army.factionId, p.ownerId);
  });
}

/**
 * Mueve un ejército a provincia adyacente (gasta movimiento). Si entra en
 * provincia hostil defendida → batalla (via combat). Si entra en provincia
 * hostil sin defensa → ocupación (cambia dueño, crónica). Respeta guerras:
 * mover a provincia de facción con la que NO hay guerra la declara ilegal
 * (se rechaza; declarar guerra es acción aparte).
 */
export function moveArmy(
  state: GameState, rng: Rng, armyId: ArmyId, toProvinceId: ProvinceId,
): ActionResult {
  const army = state.armies[armyId];
  if (!army) return { ok: false, message: 'Ejército no encontrado.' };
  if (army.movement <= 0) {
    return { ok: false, message: `${army.name} no tiene movimiento restante este turno.` };
  }
  if (!legalMoves(state, armyId).includes(toProvinceId)) {
    return { ok: false, message: 'Ese movimiento no es válido.' };
  }

  const province = findProvince(state, toProvinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };

  const fromProvinceId = army.provinceId;
  army.movement -= 1;

  // Caso pacífico: provincia propia.
  if (province.ownerId === army.factionId) {
    army.provinceId = toProvinceId;
    return { ok: true, message: `${army.name} se desplaza a ${province.name}.` };
  }

  // Caso hostil o tierra sin señor.
  const defended = hasDefense(state, province, army.factionId);

  if (!defended) {
    army.provinceId = toProvinceId;
    occupyProvince(state, army.factionId, province);
    return { ok: true, message: `${army.name} ocupa ${province.name} sin resistencia.` };
  }

  // Fortificación enemiga defendida solo por guarnición (sin ejércitos
  // hostiles en campo): asedio, no batalla instantánea (Fase 2, GDD §9.2).
  if (triggersSiege(state, province, army.factionId)) {
    const alreadyBesieging = (state.sieges ?? []).some(
      s => s.provinceId === toProvinceId && s.attackerFactionId === army.factionId,
    );
    army.provinceId = toProvinceId;
    startSiege(state, army.id, toProvinceId);
    return {
      ok: true,
      message: alreadyBesieging
        ? `${army.name} se suma al cerco de ${province.name}.`
        : `${army.name} pone cerco a ${province.name}.`,
      battle: null,
    };
  }

  // Batalla: el ejército entra en la provincia y se resuelve el combate.
  army.provinceId = toProvinceId;
  const battle = resolveBattleAt(state, rng, army.factionId, toProvinceId);

  if (battle.winner === 'attacker') {
    if (province.ownerId !== army.factionId) {
      const stillDefended = province.garrison > 0 || Object.values(state.armies).some(
        a => a.id !== army.id && a.provinceId === toProvinceId && a.factionId !== army.factionId,
      );
      if (!stillDefended) {
        occupyProvince(state, army.factionId, province);
      }
    }
    return {
      ok: true,
      message: `${army.name} vence en ${province.name}.`,
      battle,
    };
  }

  // El atacante pierde: retrocede si sobrevive, o se elimina.
  const survivor = state.armies[armyId];
  if (survivor) {
    const totalMen = survivor.units.reduce((sum, u) => sum + u.men, 0);
    if (survivor.units.length === 0 || totalMen <= 0) {
      delete state.armies[armyId];
    } else {
      survivor.provinceId = fromProvinceId;
    }
  }

  return {
    ok: true,
    message: `${army.name} es derrotado en ${province.name} y se repliega.`,
    battle,
  };
}

const CB_FLAVOR: Record<CasusBelli, string> = {
  reclamo: 'esgrimiendo un reclamo sobre sus tierras',
  religioso: 'invocando una causa religiosa',
  sin_causa: 'sin más motivo que la ambición',
};

export function declareWar(
  state: GameState, attackerId: FactionId, defenderId: FactionId, cb: CasusBelli,
): ActionResult {
  const attacker = state.factions[attackerId];
  const defender = state.factions[defenderId];
  if (!attacker || !defender) return { ok: false, message: 'Facción desconocida.' };
  if (attackerId === defenderId) {
    return { ok: false, message: 'Una facción no puede declararse la guerra a sí misma.' };
  }
  if (isAtWar(state, attackerId, defenderId)) {
    return { ok: false, message: `Ya hay guerra entre ${attacker.dynastyName} y ${defender.dynastyName}.` };
  }
  const veto = canDeclareWar(state, attackerId, defenderId);
  if (!veto.ok) {
    return { ok: false, message: veto.reason ?? 'La guerra no puede declararse ahora.' };
  }
  const rel = getRelation(state, attackerId, defenderId);
  if (rel.truceUntilTurn !== undefined && rel.truceUntilTurn > state.turn) {
    return { ok: false, message: 'Hay una tregua vigente: no se puede declarar la guerra todavía.' };
  }

  const warId = `war_${attackerId}_${defenderId}_${state.turn}`;
  const war: War = {
    id: state.wars.some(w => w.id === warId) ? `${warId}_${state.wars.length}` : warId,
    attackerId,
    defenderId,
    cb,
    warScore: 0,
    exhaustionAttacker: 0,
    exhaustionDefender: 0,
    startedTurn: state.turn,
  };
  state.wars.push(war);

  // aliados defensivos del defensor entran en cascada (Fase 2, GDD §10)
  joinAlliesToWar(state, war);

  rel.opinion = clamp(rel.opinion - 40, -100, 100);

  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${attacker.dynastyName} declaró la guerra a la Casa ${defender.dynastyName} ${CB_FLAVOR[cb]}.`,
  });

  if (cb === 'sin_causa') {
    attacker.legitimacy = clamp(attacker.legitimacy - 15, 0, 100);
    for (const otherId of Object.keys(state.factions)) {
      if (otherId === attackerId || otherId === defenderId) continue;
      const other = state.factions[otherId];
      if (!other.alive) continue;
      const otherRel = getRelation(state, attackerId, otherId);
      otherRel.opinion = clamp(otherRel.opinion - 10, -100, 100);
    }
  }

  return {
    ok: true,
    message: `La Casa ${attacker.dynastyName} declara la guerra a la Casa ${defender.dynastyName}.`,
  };
}

/** Paz: 'white' = statu quo; 'concede' = el perdedor cede oro según warScore. */
export function negotiatePeace(
  state: GameState, warId: string, kind: 'white' | 'concede',
): ActionResult {
  const war = state.wars.find(w => w.id === warId);
  if (!war) return { ok: false, message: 'Esa guerra no existe.' };

  const attacker = state.factions[war.attackerId];
  const defender = state.factions[war.defenderId];
  let termsText = 'paz blanca, sin cesiones';

  if (kind === 'concede') {
    const magnitude = Math.abs(war.warScore);
    if (magnitude > 0) {
      const payer = war.warScore > 0 ? defender : attacker;
      const payee = war.warScore > 0 ? attacker : defender;
      const payment = Math.min(payer.gold, 3 * magnitude);
      payer.gold -= payment;
      payee.gold += payment;
      termsText = `la Casa ${payer.dynastyName} paga ${payment} de oro en concepto de indemnización`;
    }
  }

  state.wars = state.wars.filter(w => w.id !== warId);

  const rel = getRelation(state, war.attackerId, war.defenderId);
  rel.truceUntilTurn = state.turn + 8;
  rel.opinion = clamp(rel.opinion + 10, -100, 100);

  state.chronicle.push({
    turn: state.turn,
    kind: 'guerra',
    text: `En ${chronicleDateText(state)}, la Casa ${attacker.dynastyName} y la Casa ${defender.dynastyName} firmaron la paz: ${termsText}.`,
  });

  return {
    ok: true,
    message: `Paz firmada entre la Casa ${attacker.dynastyName} y la Casa ${defender.dynastyName}: ${termsText}.`,
  };
}

// ---------- puente con la capa táctica (integración GDD §8) ----------

/** true si mover ese ejército ahí desencadena batalla (para ofrecer mando táctico). */
export function wouldTriggerBattle(
  state: GameState, armyId: ArmyId, toProvinceId: ProvinceId,
): boolean {
  const army = state.armies[armyId];
  if (!army || army.movement <= 0) return false;
  if (!legalMoves(state, armyId).includes(toProvinceId)) return false;
  const province = findProvince(state, toProvinceId);
  if (!province || province.ownerId === army.factionId) return false;
  // una fortificación defendida solo por guarnición abre un asedio, no una
  // batalla instantánea (Fase 2, GDD §9.2) — no ofrecer mando táctico ahí.
  if (triggersSiege(state, province, army.factionId)) return false;
  return hasDefense(state, province, army.factionId);
}

/**
 * Mueve el ejército a la provincia hostil SIN resolver la batalla: la resuelve
 * la capa táctica (createTacticalBattle espera a los atacantes YA en la provincia).
 */
export function moveArmyIntoBattle(
  state: GameState, armyId: ArmyId, toProvinceId: ProvinceId,
): ActionResult {
  if (!wouldTriggerBattle(state, armyId, toProvinceId)) {
    return { ok: false, message: 'Ahí no hay batalla que librar.' };
  }
  const army = state.armies[armyId];
  army.movement -= 1;
  army.provinceId = toProvinceId;
  return { ok: true, message: 'Los ejércitos se avistan en el campo.' };
}
