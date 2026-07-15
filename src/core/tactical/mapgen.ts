/**
 * Generación del campo de batalla táctico (GDD §8.1): terreno según la
 * provincia estratégica, clima según la estación, mapeo de las tropas de la
 * capa estratégica a TacticalUnit y despliegue inicial automático en zonas.
 * AGENTE F.
 */
import type {
  Army, Character, FactionId, GameState, Province, Season, Terrain, UnitType, UnitTypeId,
} from '../types';
import type { Rng } from '../state/rng';
import { UNIT_TYPES } from '../content/units';
import type {
  GeneralMod, HexCoord, TacticalCell, TacticalSide, TacticalState, TacticalUnit,
} from './types';
import { buildCellMap, cellKey, offsetToAxial } from './grid';

export const COLS = 16;
export const ROWS = 12;

/** Stats de milicia por defecto si el registro de contenido aún está vacío. */
const MILICIA_FALLBACK: UnitType = {
  id: 'milicia', name: 'Milicia', category: 'infantry', tier: 1, culture: null,
  attack: 6, defense: 7, armor: 2, rangedPower: 0, initiative: 8, speed: 8,
  moraleMax: 9, menMax: 100, cost: { gold: 0, manpower: 0 }, upkeep: 0,
};

function miliciaType(): UnitType {
  return UNIT_TYPES['milicia'] ?? MILICIA_FALLBACK;
}

// ---------------------------------------------------------------- terreno/clima

function makeCell(col: number, row: number): TacticalCell {
  return { coord: offsetToAxial(col, row), terrain: 'llano', elevation: 0, blocked: false };
}

/** ¿fila dentro de una zona de despliegue? (se mantiene despejada de bloqueos) */
function inDeployRow(row: number): boolean {
  return row <= 2 || row >= ROWS - 3;
}

/**
 * Genera celdas + clima. Determinista dado el rng. Los bloqueos (roca, río)
 * se restringen a las filas centrales para no tapar las zonas de despliegue.
 */
export function generateBattlefield(
  terrain: Terrain, season: Season, rng: Rng,
): { cells: TacticalCell[]; weather: string } {
  const cells: TacticalCell[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) cells.push(makeCell(col, row));
  }
  const map = buildCellMap(cells);
  const at = (col: number, row: number) => map.get(cellKey(offsetToAxial(col, row)))!;

  switch (terrain) {
    case 'forest':
      for (const c of cells) if (rng.chance(0.30)) c.terrain = 'bosque';
      break;
    case 'hills':
      for (const c of cells) {
        if (rng.chance(0.35)) { c.terrain = 'colina'; c.elevation = 1; }
        else if (!inDeployRow(c.coord.r) && rng.chance(0.10)) { c.terrain = 'roca'; c.elevation = 1; c.blocked = true; }
      }
      break;
    case 'mountain':
      for (const c of cells) {
        if (!inDeployRow(c.coord.r) && rng.chance(0.16)) {
          c.terrain = 'roca'; c.elevation = 2; c.blocked = true;
        } else if (rng.chance(0.45)) {
          c.terrain = 'colina'; c.elevation = rng.chance(0.4) ? 2 : 1;
        }
      }
      break;
    case 'swamp':
      for (const c of cells) if (rng.chance(0.35)) c.terrain = 'pantano';
      break;
    case 'coast': {
      // un río horizontal en el centro parte el campo; 1-2 vados transitables
      const riverRow = 6;
      const vadoCount = rng.int(1, 2);
      const vados = new Set<number>();
      while (vados.size < vadoCount) vados.add(rng.int(2, COLS - 3));
      for (let col = 0; col < COLS; col++) {
        const c = at(col, riverRow);
        c.terrain = 'rio';
        c.elevation = 0;
        c.blocked = !vados.has(col); // vado = río NO bloqueado (coste 2)
      }
      break;
    }
    case 'plains':
    case 'steppe':
    case 'desert':
    default:
      // llano puro
      break;
  }

  const weather = rollWeather(season, rng);
  return { cells, weather };
}

function rollWeather(season: Season, rng: Rng): string {
  const r = rng.next();
  switch (season) {
    case 0: return r < 0.35 ? 'lluvia' : 'despejado';           // primavera
    case 1: return r < 0.30 ? 'niebla' : 'despejado';           // verano
    case 2: return r < 0.45 ? 'lluvia' : (r < 0.60 ? 'niebla' : 'despejado'); // otoño
    case 3: default: return r < 0.60 ? 'nieve' : 'despejado';   // invierno
  }
}

// ---------------------------------------------------------------- mapeo tropas

function isBallesteros(t: UnitType): boolean {
  return /ballester/i.test(t.id) || /ballester/i.test(t.name);
}

function rangeFor(t: UnitType): number {
  if (t.category === 'ranged') return isBallesteros(t) ? 4 : 3;
  if (t.category === 'cavalry' && t.rangedPower > 0) return 2;
  return 0;
}

function speedHexes(t: UnitType): number {
  let s = Math.min(5, 2 + Math.floor(t.speed / 7));
  if (t.category === 'cavalry') s = Math.max(4, s);
  return s;
}

function mkUnit(
  t: UnitType, id: string, side: TacticalSide, sourceArmyId: string | null,
  men: number, menMax: number, morale: number, xp: number,
): TacticalUnit {
  return {
    id, side, typeId: t.id, name: t.name, sourceArmyId,
    men, menMax, morale, moraleMax: t.moraleMax,
    attack: t.attack, defense: t.defense, armor: t.armor, rangedPower: t.rangedPower,
    range: rangeFor(t), initiative: t.initiative, speed: speedHexes(t),
    formation: 'linea', coord: { q: 0, r: 0 }, hasMoved: false, hasActed: false,
    routed: false, xp,
  };
}

function typeOf(typeId: UnitTypeId): UnitType | null {
  return UNIT_TYPES[typeId] ?? null;
}

/** Construye TacticalUnit de un ejército (una por UnitInstance). */
export function unitsFromArmy(army: Army, side: TacticalSide): TacticalUnit[] {
  const out: TacticalUnit[] = [];
  army.units.forEach((inst, i) => {
    const t = typeOf(inst.typeId);
    if (!t) return; // tipo desconocido: se ignora (no debería ocurrir)
    const morale = inst.morale > 0 ? inst.morale : t.moraleMax;
    out.push(mkUnit(t, `u:${army.id}:${i}`, side, army.id, inst.men, t.menMax, morale, inst.xp));
  });
  return out;
}

/** Divide la guarnición en pelotones de milicia de ≤200 hombres. */
export function garrisonUnits(provinceId: number, garrison: number): TacticalUnit[] {
  const out: TacticalUnit[] = [];
  const t = miliciaType();
  let remaining = Math.floor(garrison);
  let idx = 0;
  while (remaining > 0) {
    const size = Math.min(200, remaining);
    out.push(mkUnit(t, `g:${provinceId}:${idx}`, 'defender', null, size, size, t.moraleMax, 0));
    remaining -= size;
    idx++;
  }
  return out;
}

// ------------------------------------------------------------------- generales

export function generalFrom(state: GameState, armies: Army[]): { mod: GeneralMod | null; charId: string | null } {
  for (const army of armies) {
    if (!army.generalId) continue;
    const ch: Character | undefined = state.characters[army.generalId];
    if (ch && ch.alive) {
      return {
        mod: { name: ch.name, martial: ch.attributes.martial, traits: [...ch.traits], abilityCharges: 2 },
        charId: ch.id,
      };
    }
  }
  return { mod: null, charId: null };
}

// -------------------------------------------------------------------- deploy

function categoryOfType(typeId: UnitTypeId): string {
  return UNIT_TYPES[typeId]?.category ?? 'infantry';
}

/** rol de despliegue: 'front' (línea), 'back' (proyectiles), 'flank' (caballería) */
function deployRole(u: TacticalUnit): 'front' | 'back' | 'flank' {
  const cat = categoryOfType(u.typeId);
  if (cat === 'cavalry') return 'flank';
  if (cat === 'ranged' || cat === 'siege') return 'back';
  return 'front';
}

interface CellGrid { at(col: number, row: number): TacticalCell | undefined; occupied: Set<string>; }

function buildGrid(cells: TacticalCell[]): CellGrid {
  const map = buildCellMap(cells);
  return {
    at: (col, row) => map.get(cellKey(offsetToAxial(col, row))),
    occupied: new Set<string>(),
  };
}

function claimCell(grid: CellGrid, prefCol: number, rows: number[]): HexCoord | null {
  for (const row of rows) {
    for (let d = 0; d < COLS; d++) {
      for (const col of d === 0 ? [prefCol] : [prefCol - d, prefCol + d]) {
        if (col < 0 || col >= COLS) continue;
        const cell = grid.at(col, row);
        if (!cell || cell.blocked) continue;
        const k = cellKey(cell.coord);
        if (grid.occupied.has(k)) continue;
        grid.occupied.add(k);
        return { ...cell.coord };
      }
    }
  }
  return null;
}

/**
 * Coloca las unidades de un bando en su zona: línea al frente, proyectiles
 * detrás, caballería en los flancos. Atacante al sur (filas 9-11, frente=9),
 * defensor al norte (filas 0-2, frente=2). Determinista.
 */
export function deploySide(grid: CellGrid, units: TacticalUnit[], side: TacticalSide): void {
  const rows = side === 'attacker'
    ? { front: 9, mid: 10, back: 11 }
    : { front: 2, mid: 1, back: 0 };

  const front = units.filter(u => deployRole(u) === 'front');
  const back = units.filter(u => deployRole(u) === 'back');
  const flank = units.filter(u => deployRole(u) === 'flank');

  const spread = (list: TacticalUnit[], rowOrder: number[]) => {
    const n = Math.max(1, list.length);
    list.forEach((u, i) => {
      const prefCol = Math.round(((i + 1) * COLS) / (n + 1));
      const c = claimCell(grid, prefCol, rowOrder);
      if (c) u.coord = c;
    });
  };

  spread(front, [rows.front, rows.mid, rows.back]);
  spread(back, [rows.back, rows.mid, rows.front]);

  // caballería a los flancos: mitad izquierda, mitad derecha
  flank.forEach((u, i) => {
    const left = i % 2 === 0;
    const prefCol = left ? Math.floor(i / 2) : COLS - 1 - Math.floor(i / 2);
    const c = claimCell(grid, prefCol, [rows.mid, rows.front, rows.back]);
    if (c) u.coord = c;
  });
}

export function autoDeploy(cells: TacticalCell[], units: TacticalUnit[]): void {
  const grid = buildGrid(cells);
  deploySide(grid, units.filter(u => u.side === 'attacker'), 'attacker');
  deploySide(grid, units.filter(u => u.side === 'defender'), 'defender');
}

// ---------------------------------------------------------------- selección bandos

/** facciones en guerra con la facción dada */
export function enemiesOf(state: GameState, factionId: FactionId): Set<FactionId> {
  const set = new Set<FactionId>();
  for (const w of state.wars) {
    if (w.attackerId === factionId) set.add(w.defenderId);
    else if (w.defenderId === factionId) set.add(w.attackerId);
  }
  return set;
}

export interface SideArmies {
  attackerArmies: Army[];
  defenderArmies: Army[];
  garrisonCounts: boolean;
  defenderFactionId: FactionId | null;
}

/** mismo criterio que resolveBattleAt: atacante vs hostiles + guarnición */
export function selectSides(
  state: GameState, attackerFactionId: FactionId, province: Province,
): SideArmies {
  const enemies = enemiesOf(state, attackerFactionId);
  const armies = Object.values(state.armies)
    .filter(a => a.provinceId === province.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const attackerArmies = armies.filter(a => a.factionId === attackerFactionId);
  const defenderArmies = armies.filter(a => a.factionId !== attackerFactionId && enemies.has(a.factionId));

  // la guarnición cuenta si la provincia no es del atacante y es hostil (enemiga) o neutral
  const ownerHostile = province.ownerId !== null && enemies.has(province.ownerId);
  const ownerNeutral = province.ownerId === null;
  const garrisonCounts = province.ownerId !== attackerFactionId
    && province.garrison > 0 && (ownerHostile || ownerNeutral);

  let defenderFactionId: FactionId | null = null;
  if (ownerHostile) defenderFactionId = province.ownerId;
  else if (defenderArmies.length > 0) defenderFactionId = defenderArmies[0].factionId;

  return { attackerArmies, defenderArmies, garrisonCounts, defenderFactionId };
}
