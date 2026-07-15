/**
 * API del motor táctico (GDD §8). El render de batalla (Phaser) SOLO llama
 * estas funciones; la lógica vive aquí (core puro, testeable). AGENTE F.
 */
import type { BattleReport, FactionId, GameState, ProvinceId } from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import type { Formation, HexCoord, TacticalSide, TacticalState, TacticalUnit } from './types';
import { buildCellMap, cellKey, hexDistance, hexNeighbors } from './grid';
import {
  COLS, ROWS, autoDeploy, garrisonUnits, generalFrom, generateBattlefield, selectSides, unitsFromArmy,
} from './mapgen';
import {
  active, resolveAttack, reachableHexes, sideHasActive, targetsFor, unitById, winnerByState,
} from './rules';
import { aiActivate } from './ai';

// re-exporta las utilidades hexagonales con las firmas del contrato
export { hexNeighbors, hexDistance };

// ---------------------------------------------------------------------------
// tracker efímero de hexes movidos en la activación actual (para la carga en
// cuña). Fuera del estado serializable → no afecta al determinismo del JSON.
const movedTracker = new WeakMap<TacticalState, Map<string, number>>();
function setMoved(ts: TacticalState, id: string, hexes: number): void {
  let m = movedTracker.get(ts);
  if (!m) { m = new Map(); movedTracker.set(ts, m); }
  m.set(id, hexes);
}
function getMoved(ts: TacticalState, id: string): number {
  return movedTracker.get(ts)?.get(id) ?? 0;
}
function clearMoved(ts: TacticalState, id: string): void {
  movedTracker.get(ts)?.delete(id);
}

// ---------------------------------------------------------------------------

export function createTacticalBattle(
  state: GameState, rng: Rng, attackerFactionId: FactionId, provinceId: ProvinceId,
): TacticalState {
  const province = state.provinces.find(p => p.id === provinceId);
  if (!province) throw new Error(`Provincia desconocida: ${provinceId}`);

  const { attackerArmies, defenderArmies, garrisonCounts, defenderFactionId } =
    selectSides(state, attackerFactionId, province);

  const units: TacticalUnit[] = [];
  for (const army of attackerArmies) units.push(...unitsFromArmy(army, 'attacker'));
  for (const army of defenderArmies) units.push(...unitsFromArmy(army, 'defender'));
  if (garrisonCounts) units.push(...garrisonUnits(province.id, province.garrison));

  const season = seasonOf(state.turn);
  const { cells, weather } = generateBattlefield(province.terrain, season, rng);
  autoDeploy(cells, units);

  const attackerGeneral = generalFrom(state, attackerArmies).mod;
  const defenderGeneral = generalFrom(state, defenderArmies).mod;

  let playerSide: TacticalSide = 'attacker';
  if (attackerFactionId === state.playerFactionId) playerSide = 'attacker';
  else if (defenderFactionId !== null && defenderFactionId === state.playerFactionId) playerSide = 'defender';

  return {
    provinceId: province.id,
    provinceName: province.name,
    strategicTerrain: province.terrain,
    season,
    weather,
    cols: COLS,
    rows: ROWS,
    cells,
    units,
    phase: 'deployment',
    round: 0,
    turnQueue: [],
    activeUnitId: null,
    attackerFactionId,
    defenderFactionId,
    playerSide,
    attackerGeneral,
    defenderGeneral,
    log: [],
    winner: null,
    rngState: rng.state,
  };
}

export function deployUnit(ts: TacticalState, unitId: string, to: HexCoord): boolean {
  if (ts.phase !== 'deployment') return false;
  const u = unitById(ts, unitId);
  if (!u) return false;
  const inZone = u.side === 'attacker' ? to.r >= ROWS - 3 : to.r <= 2;
  if (!inZone) return false;
  const cell = buildCellMap(ts.cells).get(cellKey(to));
  if (!cell || cell.blocked) return false;
  if (ts.units.some(o => o !== u && active(o) && o.coord.q === to.q && o.coord.r === to.r)) return false;
  u.coord = { q: to.q, r: to.r };
  return true;
}

export function finishDeployment(ts: TacticalState): void {
  if (ts.phase !== 'deployment') return;
  ts.phase = 'battle';
  ts.round = 0;
  ts.log.push('Los ejércitos toman posiciones; suenan los cuernos de guerra.');
  startNewRound(ts);
  checkVictory(ts);
}

export function legalMoveHexes(ts: TacticalState, unitId: string): HexCoord[] {
  const u = unitById(ts, unitId);
  if (!u || !active(u) || u.hasMoved || ts.phase !== 'battle') return [];
  return reachableHexes(ts, u);
}

export function legalTargets(ts: TacticalState, unitId: string): string[] {
  const u = unitById(ts, unitId);
  if (!u || !active(u) || u.hasActed || ts.phase !== 'battle') return [];
  return targetsFor(ts, u).map(t => t.id);
}

export function moveUnit(ts: TacticalState, unitId: string, to: HexCoord): boolean {
  const u = unitById(ts, unitId);
  if (!u || !active(u) || u.hasMoved || ts.phase !== 'battle') return false;
  const legal = reachableHexes(ts, u);
  if (!legal.some(h => h.q === to.q && h.r === to.r)) return false;
  const from = u.coord;
  u.coord = { q: to.q, r: to.r };
  u.hasMoved = true;
  setMoved(ts, unitId, hexDistance(from, to));
  return true;
}

export function attackUnit(ts: TacticalState, attackerUnitId: string, targetUnitId: string): string[] {
  const a = unitById(ts, attackerUnitId);
  const v = unitById(ts, targetUnitId);
  if (!a || !v || !active(a) || !active(v) || a.hasActed || ts.phase !== 'battle') return [];
  if (!targetsFor(ts, a).some(t => t.id === targetUnitId)) return [];
  const start = ts.log.length;
  resolveAttack(ts, a, v, false, getMoved(ts, attackerUnitId));
  a.hasActed = true;
  checkVictory(ts);
  return ts.log.slice(start);
}

export function setFormation(ts: TacticalState, unitId: string, f: Formation): boolean {
  const u = unitById(ts, unitId);
  if (!u || !active(u) || u.hasActed || ts.phase !== 'battle') return false;
  u.formation = f;
  u.hasActed = true;
  ts.log.push(`${u.name} adopta formación ${formationName(f)}.`);
  return true;
}

function formationName(f: Formation): string {
  switch (f) {
    case 'muro_escudos': return 'muro de escudos';
    case 'cuna': return 'cuña';
    case 'dispersa': return 'dispersa';
    default: return 'en línea';
  }
}

export function useGeneralAbility(ts: TacticalState): string[] {
  const u = unitById(ts, ts.activeUnitId);
  if (!u || ts.phase !== 'battle') return [];
  const gen = u.side === 'attacker' ? ts.attackerGeneral : ts.defenderGeneral;
  if (!gen || gen.abilityCharges <= 0 || u.hasActed) return [];
  gen.abilityCharges -= 1;
  u.hasActed = true;
  const start = ts.log.length;
  let n = 0;
  for (const f of ts.units) {
    if (f.side !== u.side || !active(f)) continue;
    if (hexDistance(f.coord, u.coord) <= 3) {
      f.morale = Math.min(f.moraleMax, f.morale + 3);
      n++;
    }
  }
  ts.log.push(`${gen.name} alza el estandarte: ${n} pelotones recobran el ánimo.`);
  return ts.log.slice(start);
}

export function endActivation(ts: TacticalState): void {
  if (ts.phase !== 'battle') return;
  const finished = ts.activeUnitId;
  if (ts.turnQueue.length > 0) ts.turnQueue.shift();
  if (finished) clearMoved(ts, finished);
  // salta unidades ya fuera de combate al frente de la cola
  while (ts.turnQueue.length > 0) {
    const u = unitById(ts, ts.turnQueue[0]);
    if (u && active(u)) break;
    ts.turnQueue.shift();
  }
  if (ts.turnQueue.length === 0) startNewRound(ts);
  else ts.activeUnitId = ts.turnQueue[0];
  checkVictory(ts);
  if (ts.phase !== 'battle') ts.activeUnitId = null;
}

function startNewRound(ts: TacticalState): void {
  const next = ts.round + 1;
  if (next > 12) { finishByStrength(ts); return; }
  ts.round = next;
  const order = ts.units.filter(active).sort((a, b) =>
    (b.initiative - a.initiative) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const u of order) { u.hasMoved = false; u.hasActed = false; }
  ts.turnQueue = order.map(u => u.id);
  ts.activeUnitId = ts.turnQueue[0] ?? null;
  ts.log.push(`— Ronda ${ts.round} —`);
}

function checkVictory(ts: TacticalState): void {
  if (ts.phase !== 'battle') return;
  const att = sideHasActive(ts, 'attacker');
  const def = sideHasActive(ts, 'defender');
  if (att && def) return;
  ts.winner = winnerByState(ts);
  ts.phase = 'finished';
  ts.activeUnitId = null;
  ts.log.push(`El campo queda para ${ts.winner === 'attacker' ? 'el atacante' : 'el defensor'}.`);
}

function finishByStrength(ts: TacticalState): void {
  ts.winner = winnerByState(ts);
  ts.phase = 'finished';
  ts.activeUnitId = null;
  ts.log.push(`Cae la noche sin ruptura; vence ${ts.winner === 'attacker' ? 'el atacante' : 'el defensor'} por la fuerza que aún se sostiene en pie.`);
}

export function isPlayerTurn(ts: TacticalState): boolean {
  if (ts.phase !== 'battle') return false;
  const u = unitById(ts, ts.activeUnitId);
  return !!u && u.side === ts.playerSide;
}

export function runAIActivation(ts: TacticalState): void {
  if (ts.phase !== 'battle') return;
  const u = unitById(ts, ts.activeUnitId);
  if (!u || !active(u)) { endActivation(ts); return; }
  try {
    aiActivate(ts, u);
  } catch {
    // robustez: una activación de IA nunca debe colgar la batalla
  }
  endActivation(ts);
}

// ---------------------------------------------------------------------------
// volcado a la capa estratégica

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}
function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

export function applyTacticalResult(state: GameState, rng: Rng, ts: TacticalState): BattleReport {
  const province = state.provinces.find(p => p.id === ts.provinceId);
  const winner: TacticalSide = ts.winner ?? winnerByState(ts);
  const loserSide: TacticalSide = winner === 'attacker' ? 'defender' : 'attacker';

  const attackerArmyIds = uniq(ts.units.filter(u => u.side === 'attacker' && u.sourceArmyId).map(u => u.sourceArmyId!));
  const defenderArmyIds = uniq(ts.units.filter(u => u.side === 'defender' && u.sourceArmyId).map(u => u.sourceArmyId!));

  const genIds = (ids: string[]) =>
    uniq(ids.map(id => state.armies[id]?.generalId).filter((x): x is string => !!x)).sort();
  const attackerGenIds = genIds(attackerArmyIds);
  const defenderGenIds = genIds(defenderArmyIds);

  const sumArmyMen = (ids: string[]) =>
    ids.reduce((s, id) => {
      const a = state.armies[id];
      return s + (a ? a.units.reduce((t, u) => t + u.men, 0) : 0);
    }, 0);
  const garrisonBefore = province ? province.garrison : 0;
  const menBeforeAtt = sumArmyMen(attackerArmyIds);
  const menBeforeDef = sumArmyMen(defenderArmyIds) + garrisonBefore;

  const menAfterAtt = ts.units.filter(u => u.side === 'attacker').reduce((s, u) => s + Math.max(0, u.men), 0);
  const menAfterDef = ts.units.filter(u => u.side === 'defender').reduce((s, u) => s + Math.max(0, u.men), 0);
  const lossesAtt = Math.max(0, menBeforeAtt - menAfterAtt);
  const lossesDef = Math.max(0, menBeforeDef - menAfterDef);

  // 1) bajas -> UnitInstance (mapeo 1:1 por índice codificado en el id)
  for (const tu of ts.units) {
    if (!tu.sourceArmyId) continue;
    const army = state.armies[tu.sourceArmyId];
    if (!army) continue;
    const idx = Number(tu.id.slice(tu.id.lastIndexOf(':') + 1));
    const inst = army.units[idx];
    if (!inst) continue;
    inst.men = Math.max(0, Math.floor(tu.men));
    inst.morale = Math.max(0, Math.min(inst.morale, tu.morale));
    if (tu.side === winner && inst.men > 0) inst.xp = Math.min(3, inst.xp + 1);
  }
  for (const id of Object.keys(state.armies)) {
    state.armies[id].units = state.armies[id].units.filter(u => u.men > 0);
  }

  // 2) guarnición
  if (province) {
    if (winner === 'attacker') province.garrison = 0;
    else {
      province.garrison = ts.units
        .filter(u => u.side === 'defender' && u.sourceArmyId === null)
        .reduce((s, u) => s + Math.max(0, Math.floor(u.men)), 0);
    }
  }

  // 3) retirada de perdedores / eliminación de ejércitos vacíos
  const loserArmyIds = loserSide === 'attacker' ? attackerArmyIds : defenderArmyIds;
  const winnerArmyIds = winner === 'attacker' ? attackerArmyIds : defenderArmyIds;
  for (const id of loserArmyIds) {
    const army = state.armies[id];
    if (!army) continue;
    if (army.units.length === 0) { delete state.armies[id]; continue; }
    const dest = province
      ? [...province.neighbors].sort((a, b) => a - b).find(nid => {
          const np = state.provinces.find(p => p.id === nid);
          return !!np && np.ownerId === army.factionId;
        })
      : undefined;
    if (dest !== undefined) army.provinceId = dest;
    else delete state.armies[id];
  }
  for (const id of winnerArmyIds) {
    const army = state.armies[id];
    if (army && army.units.length === 0) delete state.armies[id];
  }

  // 4) suerte de los generales (rng): perdedor 6% muere / 6% herido; ganador 2% muere
  for (const gid of loserGenIdsSorted(loserSide, attackerGenIds, defenderGenIds)) {
    const ch = state.characters[gid];
    if (!ch || !ch.alive) continue;
    if (rng.chance(0.06)) ch.alive = false;
    else if (rng.chance(0.06) && !ch.traits.includes('herido')) ch.traits.push('herido');
  }
  for (const gid of winner === 'attacker' ? attackerGenIds : defenderGenIds) {
    const ch = state.characters[gid];
    if (!ch || !ch.alive) continue;
    if (rng.chance(0.02)) ch.alive = false;
  }

  // 5) guerra
  const attackerFactionId = ts.attackerFactionId;
  const defenderFactionId = ts.defenderFactionId;
  const totalLosses = lossesAtt + lossesDef;
  const delta = clamp(4, 25, Math.round(4 + totalLosses / 25));
  let warScoreDelta = 0;
  if (defenderFactionId) {
    const war = state.wars.find(w =>
      (w.attackerId === attackerFactionId && w.defenderId === defenderFactionId) ||
      (w.attackerId === defenderFactionId && w.defenderId === attackerFactionId));
    if (war) {
      const winnerFaction = winner === 'attacker' ? attackerFactionId : defenderFactionId;
      const loserFaction = winner === 'attacker' ? defenderFactionId : attackerFactionId;
      const signed = winnerFaction === war.attackerId ? delta : -delta;
      war.warScore = clamp(-100, 100, war.warScore + signed);
      warScoreDelta = signed;
      if (loserFaction === war.attackerId) { war.exhaustionAttacker += 5; war.exhaustionDefender += 2; }
      else { war.exhaustionDefender += 5; war.exhaustionAttacker += 2; }
    }
  }

  // 6) crónica
  const season = seasonOf(state.turn);
  const winnerFactionId = winner === 'attacker' ? attackerFactionId : defenderFactionId;
  const winnerName = winnerFactionId ? (state.factions[winnerFactionId]?.name ?? winnerFactionId) : 'la guarnición local';
  state.chronicle.push({
    turn: state.turn,
    kind: 'batalla',
    text: `En ${SEASON_NAMES[season]} del año ${yearOf(state.turn)}, ${winnerName} venció en la batalla de ${ts.provinceName}.`,
  });

  // 7) reporte
  const report: BattleReport = {
    provinceId: ts.provinceId,
    provinceName: ts.provinceName,
    turn: state.turn,
    season,
    terrain: ts.strategicTerrain,
    weather: ts.weather,
    attacker: {
      factionId: attackerFactionId,
      menBefore: menBeforeAtt,
      losses: lossesAtt,
      moraleBroke: brokeSide(ts, 'attacker'),
    },
    defender: {
      factionId: defenderFactionId,
      menBefore: menBeforeDef,
      losses: lossesDef,
      moraleBroke: brokeSide(ts, 'defender'),
    },
    winner,
    narrative: distill(ts, winner),
    warScoreDelta,
  };
  state.lastBattle = report;
  return report;
}

function loserGenIdsSorted(loserSide: TacticalSide, att: string[], def: string[]): string[] {
  return loserSide === 'attacker' ? att : def;
}

function brokeSide(ts: TacticalState, side: TacticalSide): boolean {
  return ts.units.some(u => u.side === side && u.routed && u.men > 0);
}

function distill(ts: TacticalState, winner: TacticalSide): string[] {
  const body = ts.log.filter(l => l.length > 0);
  const target = 7;
  const picks: string[] = [];
  if (body.length <= target) {
    picks.push(...body);
  } else {
    const step = body.length / target;
    for (let i = 0; i < target; i++) picks.push(body[Math.floor(i * step)]);
  }
  const lines = picks.filter((l, i) => i === 0 || l !== picks[i - 1]);
  lines.push(`Al caer la tarde, ${winner === 'attacker' ? 'el atacante' : 'el defensor'} domina el campo de ${ts.provinceName}.`);
  while (lines.length < 6) lines.push('El fragor de las armas se apaga sobre la tierra revuelta.');
  return lines.slice(0, 10);
}
