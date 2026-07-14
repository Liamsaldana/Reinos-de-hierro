/**
 * Reglas de resolución de la batalla táctica (GDD §8.2): movimiento con coste y
 * ZoC, alcances, daño con flanqueo/altura/formación/clima, moral y ruptura,
 * contraataque y condición de victoria. Determinista (sin rng en combate).
 * AGENTE F.
 */
import { UNIT_TYPES } from '../content/units';
import type { HexCoord, TacticalCell, TacticalSide, TacticalState, TacticalUnit } from './types';
import { buildCellMap, cellKey, hexDistance, hexNeighbors, terrainCost } from './grid';

// --- constantes de calibración (ajustadas para batallas de ~4-8 rondas) ---
const CASUALTY_SCALE = 0.62;   // escala global de bajas por golpe
const RATIO_CAP = 2.5;         // techo de (men/menMax) para evitar golpes de un solo turno
const MORALE_PER_PCT = 12;     // pérdida de moral por %bajas (fracción × 12)
const FLANK_MORALE = 4;        // moral extra perdida al ser flanqueada
const ROUT_CASCADE = 3;        // moral perdida por unidad a ≤2 hexes de una amiga que huye

export function active(u: TacticalUnit): boolean {
  return !u.routed && u.men > 0;
}

export function unitById(ts: TacticalState, id: string | null): TacticalUnit | undefined {
  if (id === null) return undefined;
  return ts.units.find(u => u.id === id);
}

export function categoryOf(u: TacticalUnit): string {
  const cat = UNIT_TYPES[u.typeId]?.category;
  if (cat) return cat;
  if (u.range >= 3) return 'ranged';
  if (u.rangedPower > 0 && u.range === 2) return 'cavalry';
  return 'infantry';
}

export function isCavalry(u: TacticalUnit): boolean {
  return categoryOf(u) === 'cavalry';
}

export function elevationAt(ts: TacticalState, coord: HexCoord): number {
  const cell = buildCellMap(ts.cells).get(cellKey(coord));
  return cell ? cell.elevation : 0;
}

function cellMapOf(ts: TacticalState): Map<string, TacticalCell> {
  return buildCellMap(ts.cells);
}

// ------------------------------------------------------------------- movimiento

/** hexes en ZoC enemiga (adyacentes a alguna unidad enemiga activa) */
function enemyZoC(ts: TacticalState, u: TacticalUnit): Set<string> {
  const set = new Set<string>();
  for (const e of ts.units) {
    if (e.side === u.side || !active(e)) continue;
    for (const n of hexNeighbors(e.coord)) set.add(cellKey(n));
  }
  return set;
}

function occupancy(ts: TacticalState, exclude: TacticalUnit): Set<string> {
  const set = new Set<string>();
  for (const o of ts.units) {
    if (o === exclude || !active(o)) continue;
    set.add(cellKey(o.coord));
  }
  return set;
}

/** Dijkstra de coste ≤ speed; ZoC hace terminal el hex donde se entra. */
export function reachableHexes(ts: TacticalState, u: TacticalUnit): HexCoord[] {
  const cells = cellMapOf(ts);
  const occ = occupancy(ts, u);
  const zoc = enemyZoC(ts, u);
  const budget = u.speed;
  const startKey = cellKey(u.coord);
  const best = new Map<string, number>([[startKey, 0]]);
  const coordOf = new Map<string, HexCoord>([[startKey, u.coord]]);

  // frontera ordenada por coste (Dijkstra simple; costes 1-2, tamaño pequeño)
  const frontier: { key: string; coord: HexCoord; cost: number }[] = [{ key: startKey, coord: u.coord, cost: 0 }];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const node = frontier.shift()!;
    if (node.cost > (best.get(node.key) ?? Infinity)) continue;
    for (const n of hexNeighbors(node.coord)) {
      const nk = cellKey(n);
      const cell = cells.get(nk);
      if (!cell || cell.blocked) continue;
      if (occ.has(nk)) continue;
      const step = terrainCost(cell);
      const nc = node.cost + step;
      if (nc > budget) continue;
      if (nc >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, nc);
      coordOf.set(nk, { ...n });
      // sólo se puede seguir avanzando si el hex NO está en ZoC enemiga
      if (!zoc.has(nk)) frontier.push({ key: nk, coord: { ...n }, cost: nc });
    }
  }
  best.delete(startKey);
  return [...best.keys()].map(k => coordOf.get(k)!);
}

// -------------------------------------------------------------------- alcances

export function effectiveRangeTo(ts: TacticalState, u: TacticalUnit, target: TacticalUnit): number {
  if (u.range <= 0) return 1; // sólo melee
  let r = u.range;
  if (elevationAt(ts, u.coord) > elevationAt(ts, target.coord)) r += 1; // altura: +1 alcance
  if (ts.weather === 'niebla') r = Math.min(r, 2); // niebla limita alcance a 2
  return r;
}

export function targetsFor(ts: TacticalState, u: TacticalUnit): TacticalUnit[] {
  if (!active(u)) return [];
  const out: TacticalUnit[] = [];
  for (const e of ts.units) {
    if (e.side === u.side || !active(e)) continue;
    const d = hexDistance(u.coord, e.coord);
    if (d < 1) continue;
    if (d === 1) { out.push(e); continue; } // melee siempre posible adyacente
    if (u.range > 0 && d <= effectiveRangeTo(ts, u, e)) out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------------ daño

function friendliesAdjacentTo(ts: TacticalState, target: TacticalUnit, side: TacticalSide): number {
  let n = 0;
  const adj = new Set(hexNeighbors(target.coord).map(cellKey));
  for (const u of ts.units) {
    if (u.side !== side || !active(u)) continue;
    if (adj.has(cellKey(u.coord))) n++;
  }
  return n;
}

function generalOf(ts: TacticalState, side: TacticalSide) {
  return side === 'attacker' ? ts.attackerGeneral : ts.defenderGeneral;
}

/**
 * Resuelve un ataque de `a` contra `v`. Muta men/morale, narra en ts.log,
 * gestiona ruptura + cascada de moral y contraataque melee. `movedHexes` =
 * hexes que movió el atacante en esta activación (para la carga en cuña).
 */
export function resolveAttack(
  ts: TacticalState, a: TacticalUnit, v: TacticalUnit, isCounter: boolean, movedHexes: number,
): void {
  const dist = hexDistance(a.coord, v.coord);
  const melee = dist === 1;
  const base = melee ? a.attack : a.rangedPower;
  if (base <= 0 || !active(a) || !active(v)) return;

  let mods = 1;

  // clima (penaliza proyectiles)
  if (!melee) {
    if (ts.weather === 'lluvia') mods *= 0.65;
    else if (ts.weather === 'nieve') mods *= 0.70;
    else if (ts.weather === 'niebla') mods *= 0.50;
  }

  // altura
  if (elevationAt(ts, a.coord) > elevationAt(ts, v.coord)) mods *= melee ? 1.20 : 1.25;

  // flanqueo (melee): +25% por cada amiga adyacente al objetivo más allá de la primera, cap +50%
  let flanked = false;
  if (melee) {
    const adj = friendliesAdjacentTo(ts, v, a.side); // incluye al propio atacante
    const bonus = Math.min(0.50, 0.25 * Math.max(0, adj - 1));
    mods *= 1 + bonus;
    flanked = adj >= 2;
  }

  // carga en cuña (caballería que movió ≥2 y ataca melee)
  const charge = melee && !isCounter && a.formation === 'cuna' && isCavalry(a) && movedHexes >= 2;
  if (charge) mods *= 1.35;

  // formación de la víctima frente a proyectiles
  if (!melee) {
    if (v.formation === 'muro_escudos') mods *= 0.80;
    else if (v.formation === 'dispersa') mods *= 0.60;
  }

  // general (martial)
  const gen = generalOf(ts, a.side);
  const genMult = 1 + (gen ? gen.martial : 0) * 0.03;

  const ratio = Math.min(RATIO_CAP, a.men / a.menMax);
  let power = base * ratio * mods * genMult;
  if (isCounter) power *= 0.5;

  // defensa de la víctima (formación afecta melee)
  let def = v.defense;
  if (melee) {
    if (v.formation === 'muro_escudos') def *= 1.40;
    else if (v.formation === 'dispersa') def *= 0.80;
  }
  const defRating = def + v.armor * 1.5;

  let casualties = Math.round(CASUALTY_SCALE * power * (power / (power + defRating)));
  casualties = Math.max(0, Math.min(v.men, casualties));

  const menBefore = v.men;
  v.men -= casualties;

  // moral por %bajas
  let moraleLoss = (casualties / Math.max(1, menBefore)) * MORALE_PER_PCT;
  if (flanked) moraleLoss += FLANK_MORALE;
  v.morale -= moraleLoss;

  narrateAttack(ts, a, v, casualties, melee, charge, flanked, isCounter);

  routCheck(ts, v);

  // contraataque melee al 50% si la víctima sobrevive y no está rota
  if (melee && !isCounter && active(v)) {
    resolveAttack(ts, v, a, true, 0);
  }
}

function narrateAttack(
  ts: TacticalState, a: TacticalUnit, v: TacticalUnit, casualties: number,
  melee: boolean, charge: boolean, flanked: boolean, isCounter: boolean,
): void {
  const verb = isCounter ? 'responde el golpe y'
    : charge ? 'carga en cuña y'
    : melee ? 'choca contra' : 'dispara sobre';
  const flank = flanked && !isCounter ? ', rodeándola por el flanco,' : '';
  ts.log.push(`${a.name} ${verb} ${v.name}${flank} — ${casualties} bajas.`);
}

/** Comprueba ruptura de moral (con clima) y encadena la cascada a las amigas. */
export function routCheck(ts: TacticalState, u: TacticalUnit): void {
  const queue: TacticalUnit[] = [u];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.routed) continue;
    const snowPenalty = ts.weather === 'nieve' ? cur.moraleMax * 0.10 : 0;
    const dead = cur.men <= 0;
    if (!dead && cur.morale - snowPenalty > 0) continue;

    cur.routed = true;
    if (dead) ts.log.push(`${cur.name} es aniquilada.`);
    else ts.log.push(`¡${cur.name} rompe filas y huye del campo!`);

    // cascada: amigas a ≤2 hexes pierden moral (+ puede encadenar rupturas)
    if (!dead) {
      for (const f of ts.units) {
        if (f === cur || f.side !== cur.side || !active(f)) continue;
        if (hexDistance(f.coord, cur.coord) <= 2) {
          f.morale -= ROUT_CASCADE;
          if (f.morale <= 0) queue.push(f);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------- victoria

export function sideStrength(ts: TacticalState, side: TacticalSide): number {
  let s = 0;
  for (const u of ts.units) {
    if (u.side !== side || !active(u)) continue;
    s += u.men * (u.attack + u.defense + u.rangedPower);
  }
  return s;
}

export function sideHasActive(ts: TacticalState, side: TacticalSide): boolean {
  return ts.units.some(u => u.side === side && active(u));
}

/** Determina ganador por eliminación; si ambos quedan, por fuerza restante. */
export function winnerByState(ts: TacticalState): TacticalSide {
  const att = sideHasActive(ts, 'attacker');
  const def = sideHasActive(ts, 'defender');
  if (att && !def) return 'attacker';
  if (def && !att) return 'defender';
  return sideStrength(ts, 'attacker') >= sideStrength(ts, 'defender') ? 'attacker' : 'defender';
}
