/**
 * IA táctica de una activación (GDD §8.2): proyectiles mantienen distancia y
 * disparan al mejor blanco; melee avanza al enemigo más cercano; caballería
 * busca flanco y carga en cuña; el general usa su aura si la moral flaquea.
 * SIEMPRE termina (no llama endActivation: eso lo hace runAIActivation). AGENTE F.
 */
import type { HexCoord, TacticalState, TacticalUnit } from './types';
import { hexDistance } from './grid';
import { active, categoryOf, targetsFor } from './rules';
import { attackUnit, legalMoveHexes, moveUnit, setFormation, useGeneralAbility } from './api';

function enemies(ts: TacticalState, u: TacticalUnit): TacticalUnit[] {
  return ts.units.filter(e => e.side !== u.side && active(e));
}

function friendlyAdjacentCount(ts: TacticalState, target: TacticalUnit, side: string): number {
  let n = 0;
  for (const f of ts.units) {
    if (f.side !== side || !active(f)) continue;
    if (hexDistance(f.coord, target.coord) === 1) n++;
  }
  return n;
}

function nearest(u: TacticalUnit, list: TacticalUnit[]): TacticalUnit {
  let best = list[0];
  let bd = hexDistance(u.coord, best.coord);
  for (const e of list) {
    const d = hexDistance(u.coord, e.coord);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** blanco más "castigable": menos hombres, luego menos armadura */
function bestShot(list: TacticalUnit[]): TacticalUnit {
  return [...list].sort((a, b) => (a.men - b.men) || (a.armor - b.armor))[0];
}

function minDistToEnemies(coord: HexCoord, es: TacticalUnit[]): number {
  let m = Infinity;
  for (const e of es) m = Math.min(m, hexDistance(coord, e.coord));
  return m;
}

/** Ejecuta la activación de la unidad de IA. NO llama endActivation. */
export function aiActivate(ts: TacticalState, u: TacticalUnit): void {
  const es = enemies(ts, u);
  if (es.length === 0) return;

  // habilidad de general si la moral media del bando cae por debajo del 50%
  const gen = u.side === 'attacker' ? ts.attackerGeneral : ts.defenderGeneral;
  if (gen && gen.abilityCharges > 0 && !u.hasActed) {
    const side = ts.units.filter(x => x.side === u.side && active(x));
    const avg = side.reduce((s, x) => s + x.morale / x.moraleMax, 0) / Math.max(1, side.length);
    if (avg < 0.5) { useGeneralAbility(ts); return; }
  }

  const ranged = u.rangedPower > 0 && u.range >= 2;
  if (ranged) aiRanged(ts, u, es);
  else aiMelee(ts, u, es, categoryOf(u) === 'cavalry');
}

function tryShoot(ts: TacticalState, u: TacticalUnit): boolean {
  const tgts = targetsFor(ts, u).filter(t => hexDistance(u.coord, t.coord) >= 1);
  if (tgts.length === 0) return false;
  // prefiere disparar a distancia (evita el melee) si hay blanco lejano
  const ranged = tgts.filter(t => hexDistance(u.coord, t.coord) >= 2);
  const pool = ranged.length > 0 ? ranged : tgts;
  const t = bestShot(pool);
  attackUnit(ts, u.id, t.id);
  return true;
}

function aiRanged(ts: TacticalState, u: TacticalUnit, es: TacticalUnit[]): void {
  const near = nearest(u, es);
  const adjacent = hexDistance(u.coord, near.coord) <= 1;

  if (adjacent && !u.hasMoved) {
    // kite: moverse al hex que maximiza la distancia mínima a enemigos
    const moves = legalMoveHexes(ts, u.id);
    let bestHex: HexCoord | null = null;
    let bestScore = minDistToEnemies(u.coord, es);
    for (const h of moves) {
      const sc = minDistToEnemies(h, es);
      if (sc > bestScore) { bestScore = sc; bestHex = h; }
    }
    if (bestHex) moveUnit(ts, u.id, bestHex);
    if (!u.hasActed) tryShoot(ts, u);
    return;
  }

  if (tryShoot(ts, u)) return;

  // sin blanco a alcance: acercarse
  if (!u.hasMoved) {
    const moves = legalMoveHexes(ts, u.id);
    if (moves.length > 0) {
      const bestHex = moves.reduce((b, h) =>
        hexDistance(h, near.coord) < hexDistance(b, near.coord) ? h : b, moves[0]);
      moveUnit(ts, u.id, bestHex);
    }
  }
  if (!u.hasActed) tryShoot(ts, u);
}

function aiMelee(ts: TacticalState, u: TacticalUnit, es: TacticalUnit[], cavalry: boolean): void {
  // objetivo: caballería busca flanco (enemigo con amigas adyacentes), resto el más cercano
  let target: TacticalUnit;
  if (cavalry) {
    target = [...es].sort((a, b) => {
      const fa = friendlyAdjacentCount(ts, a, u.side);
      const fb = friendlyAdjacentCount(ts, b, u.side);
      if (fb !== fa) return fb - fa;
      return hexDistance(u.coord, a.coord) - hexDistance(u.coord, b.coord);
    })[0];
  } else {
    target = nearest(u, es);
  }

  if (hexDistance(u.coord, target.coord) === 1) {
    attackUnit(ts, u.id, target.id);
    return;
  }

  // avanzar hacia el objetivo
  if (!u.hasMoved) {
    const moves = legalMoveHexes(ts, u.id);
    if (moves.length > 0) {
      // minimiza distancia al objetivo; a igualdad, maximiza el trecho recorrido (favorece la carga)
      const start = u.coord;
      const bestHex = moves.reduce((b, h) => {
        const dh = hexDistance(h, target.coord);
        const db = hexDistance(b, target.coord);
        if (dh !== db) return dh < db ? h : b;
        return hexDistance(start, h) > hexDistance(start, b) ? h : b;
      }, moves[0]);
      moveUnit(ts, u.id, bestHex);
    }
  }

  if (hexDistance(u.coord, target.coord) === 1) {
    attackUnit(ts, u.id, target.id);
  } else if (cavalry && u.formation !== 'cuna' && !u.hasActed) {
    // aún lejos: adopta cuña para cargar en la próxima activación
    setFormation(ts, u.id, 'cuna');
  }
}
