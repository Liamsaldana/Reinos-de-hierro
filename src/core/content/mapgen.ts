/**
 * Generador procedural del continente Valdemar (GDD §2.1, §4.2, §17.2.3):
 * rejilla 8×5 (40 provincias), geografía por zona, recursos, asentamientos,
 * nombres y adyacencia. Módulo INTERNO del Agente B — no forma parte del
 * contrato público del core; solo lo consume newGame.ts.
 *
 * TODO determinista: cada número sale de `rng`, nunca de Math.random/Date.now.
 * El orden de consumo del Rng es fijo (ver generateProvinces): mismo seed →
 * mismo mapa, siempre.
 */
import type { Province, ProvinceId, Settlement, Terrain } from '../types';
import type { Rng } from '../state/rng';
import {
  NORTH_PROVINCE_NAMES, COAST_PROVINCE_NAMES, SOUTH_PROVINCE_NAMES, FAUCES_NAME,
  STEPPE_PROVINCE_NAMES, CENTER_PROVINCE_NAMES, takeNames, settlementName,
} from './names';

export const GRID_COLS = 8;
export const GRID_ROWS = 5;
const SPACING = 20;
const ORIGIN_X = -70;
const ORIGIN_Z = -40;
const CENTER_JITTER = 4;
/** Las Fauces: única provincia de montaña volcánica en la fila sur (GDD §2.5). */
const FAUCES_ROW = 4;
const FAUCES_COL = 4;
/** margen de seguridad: el mundo de juego es [-80,80]x[-50,50] (ver Province.polygon). */
const WORLD_X_MAX = 82;
const WORLD_Z_MAX = 52;

export function idAt(row: number, col: number): ProvinceId { return row * GRID_COLS + col; }
export function rowOf(id: ProvinceId): number { return Math.floor(id / GRID_COLS); }
export function colOf(id: ProvinceId): number { return id % GRID_COLS; }

/** ¿cae `id` dentro del rectángulo de rejilla [rowMin,rowMax]×[colMin,colMax]? */
export function inRect(id: ProvinceId, rowMin: number, rowMax: number, colMin: number, colMax: number): boolean {
  const r = rowOf(id);
  const c = colOf(id);
  return r >= rowMin && r <= rowMax && c >= colMin && c <= colMax;
}

type Zone = 'coast' | 'north' | 'south' | 'fauces' | 'steppe' | 'center';

function zoneOf(row: number, col: number): Zone {
  if (row === FAUCES_ROW && col === FAUCES_COL) return 'fauces';
  if (col === 0) return 'coast';
  if (row === 0) return 'north';
  if (row === GRID_ROWS - 1) return 'south';
  if (col >= 5) return 'steppe';
  return 'center';
}

function randIn(rng: Rng, lo: number, hi: number): number { return lo + rng.next() * (hi - lo); }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

interface Cell {
  id: ProvinceId;
  row: number;
  col: number;
  zone: Zone;
  terrain: Terrain;
  elevation: number;
}

/** geografía base por zona (GDD §2.1): terreno + elevación (ver spec del agente). */
function buildCells(rng: Rng): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const zone = zoneOf(row, col);
      let terrain: Terrain;
      let elevation: number;
      switch (zone) {
        case 'fauces':
          terrain = 'mountain'; elevation = randIn(rng, 0.8, 0.95);
          break;
        case 'coast':
          terrain = 'coast'; elevation = randIn(rng, 0.10, 0.18);
          break;
        case 'north':
          if (rng.chance(0.55)) { terrain = 'mountain'; elevation = randIn(rng, 0.8, 0.95); }
          else { terrain = 'hills'; elevation = randIn(rng, 0.55, 0.7); }
          break;
        case 'south':
          terrain = 'desert'; elevation = randIn(rng, 0.27, 0.33);
          break;
        case 'steppe':
          terrain = 'steppe'; elevation = randIn(rng, 0.25, 0.35);
          break;
        case 'center':
        default: {
          const roll = rng.next();
          if (roll < 0.34) { terrain = 'plains'; elevation = randIn(rng, 0.25, 0.35); }
          else if (roll < 0.67) { terrain = 'forest'; elevation = randIn(rng, 0.4, 0.5); }
          else { terrain = 'hills'; elevation = randIn(rng, 0.55, 0.7); }
          break;
        }
      }
      cells.push({ id: idAt(row, col), row, col, zone, terrain, elevation });
    }
  }
  return cells;
}

function assignResources(rng: Rng, cells: Cell[]): { iron: Set<ProvinceId>; horses: Set<ProvinceId> } {
  const iron = new Set<ProvinceId>();
  const horses = new Set<ProvinceId>();

  const fauces = cells.find(c => c.zone === 'fauces');
  if (fauces) iron.add(fauces.id);

  // hierro: montaña/colinas (norte sobre todo) + Las Fauces, ~6 en total.
  const ironCandidates = cells.filter(c => c.zone !== 'fauces' && (c.terrain === 'mountain' || c.terrain === 'hills'));
  for (const c of rng.shuffle([...ironCandidates]).slice(0, 5)) iron.add(c.id);

  // caballos: estepa sobre todo, ~6 en total.
  const horseCandidates = cells.filter(c => c.terrain === 'steppe');
  for (const c of rng.shuffle([...horseCandidates]).slice(0, 6)) horses.add(c.id);

  return { iron, horses };
}

function assignNames(rng: Rng, cells: Cell[]): Map<ProvinceId, string> {
  const names = new Map<ProvinceId, string>();
  const byZone = (zone: Zone) => cells.filter(c => c.zone === zone);

  for (const c of byZone('fauces')) names.set(c.id, FAUCES_NAME);

  const coast = byZone('coast');
  takeNames(rng, COAST_PROVINCE_NAMES, coast.length).forEach((n, i) => names.set(coast[i].id, n));

  const north = byZone('north');
  takeNames(rng, NORTH_PROVINCE_NAMES, north.length).forEach((n, i) => names.set(north[i].id, n));

  const south = byZone('south');
  takeNames(rng, SOUTH_PROVINCE_NAMES, south.length).forEach((n, i) => names.set(south[i].id, n));

  const steppe = byZone('steppe');
  takeNames(rng, STEPPE_PROVINCE_NAMES, steppe.length).forEach((n, i) => names.set(steppe[i].id, n));

  const center = byZone('center');
  takeNames(rng, CENTER_PROVINCE_NAMES, center.length).forEach((n, i) => names.set(center[i].id, n));

  return names;
}

function centerOf(rng: Rng, row: number, col: number): [number, number] {
  const nominalX = ORIGIN_X + col * SPACING;
  const nominalZ = ORIGIN_Z + row * SPACING;
  const jx = (rng.next() * 2 - 1) * CENTER_JITTER;
  const jz = (rng.next() * 2 - 1) * CENTER_JITTER;
  return [nominalX + jx, nominalZ + jz];
}

/**
 * Hexágono irregular (6–7 vértices) en sentido horario alrededor del centro,
 * radio 8–9.5 con jitter angular suave. Se recorta al margen de seguridad del
 * mundo de juego para blindar contra el caso extremo (jitter de centro +
 * radio máximo alineados) sin renunciar al rango de radio pedido.
 */
function makePolygon(rng: Rng, cx: number, cz: number): [number, number][] {
  const n = rng.int(6, 7);
  const step = (Math.PI * 2) / n;
  const jitterAmp = step * 0.15;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = i * step + (rng.next() * 2 - 1) * jitterAmp;
    const radius = 8 + rng.next() * 1.5; // [8, 9.5)
    const x = clamp(cx + Math.cos(angle) * radius, -WORLD_X_MAX, WORLD_X_MAX);
    const z = clamp(cz + Math.sin(angle) * radius, -WORLD_Z_MAX, WORLD_Z_MAX);
    pts.push([x, z]);
  }
  return pts;
}

/** vecindad de rejilla: ortogonal siempre + diagonal ~35% determinista, simétrica. */
function buildNeighbors(rng: Rng): Map<ProvinceId, Set<ProvinceId>> {
  const neighbors = new Map<ProvinceId, Set<ProvinceId>>();
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      neighbors.set(idAt(row, col), new Set());
    }
  }
  const link = (a: ProvinceId, b: ProvinceId): void => {
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const id = idAt(row, col);
      if (col + 1 < GRID_COLS) link(id, idAt(row, col + 1)); // este
      if (row + 1 < GRID_ROWS) link(id, idAt(row + 1, col)); // sur
      // diagonales: se visita cada par sin ordenar exactamente una vez
      // (siempre "hacia abajo" desde la celda de arriba) para no romper la simetría.
      if (row + 1 < GRID_ROWS && col + 1 < GRID_COLS && rng.chance(0.35)) {
        link(id, idAt(row + 1, col + 1)); // sureste
      }
      if (row + 1 < GRID_ROWS && col - 1 >= 0 && rng.chance(0.35)) {
        link(id, idAt(row + 1, col - 1)); // suroeste
      }
    }
  }
  return neighbors;
}

function makeSettlement(rng: Rng, provinceName: string, terrain: Terrain): Settlement {
  return {
    name: settlementName(rng, provinceName, terrain, false),
    level: rng.int(1, 3) as 1 | 2 | 3,
    fortLevel: rng.int(0, 1) as 0 | 1,
  };
}

function economyFor(rng: Rng, terrain: Terrain): { baseTax: number; baseFood: number; baseManpower: number } {
  let tax = rng.int(3, 6);
  if (terrain === 'coast') tax += 2;
  else if (terrain === 'plains') tax += 1;
  tax = clamp(tax, 3, 8);

  let food = rng.int(5, 8);
  if (terrain === 'plains' || terrain === 'coast') food += 2;
  else if (terrain === 'mountain' || terrain === 'desert') food -= 2;
  food = clamp(food, 4, 10);

  const manpower = rng.int(80, 200);

  return { baseTax: tax, baseFood: food, baseManpower: manpower };
}

/** Genera las 40 provincias de Valdemar. Todas empiezan sin dueño (ownerId null). */
export function generateProvinces(rng: Rng): Province[] {
  const cells = buildCells(rng);

  // pantano aislado: exactamente una provincia del centro se convierte en swamp.
  const centerCells = cells.filter(c => c.zone === 'center');
  const swampCell = rng.pick(centerCells);
  swampCell.terrain = 'swamp';
  swampCell.elevation = randIn(rng, 0.15, 0.20);

  const names = assignNames(rng, cells);
  const { iron, horses } = assignResources(rng, cells);
  const neighborMap = buildNeighbors(rng);

  return cells.map((c): Province => {
    const [cx, cz] = centerOf(rng, c.row, c.col);
    const name = names.get(c.id)!;
    const econ = economyFor(rng, c.terrain);
    return {
      id: c.id,
      name,
      terrain: c.terrain,
      elevation: c.elevation,
      center: [cx, cz],
      polygon: makePolygon(rng, cx, cz),
      neighbors: [...neighborMap.get(c.id)!].sort((a, b) => a - b),
      ownerId: null,
      settlement: makeSettlement(rng, name, c.terrain),
      iron: iron.has(c.id),
      horses: horses.has(c.id),
      baseTax: econ.baseTax,
      baseFood: econ.baseFood,
      baseManpower: econ.baseManpower,
      // tierra sin señor por defecto; newGame.ts reasigna si acaba con dueño.
      garrison: rng.int(300, 800),
    };
  });
}

/**
 * Crece un bloque de provincias contiguas desde una capital semilla,
 * prefiriendo las que caen dentro de `inZone` (barajado determinista) y solo
 * saliendo de la zona si hace falta para llegar a `targetCount`. Garantiza
 * contigüidad por construcción (solo añade vecinos de lo ya reclamado).
 */
export function growBlock(
  provinces: Province[],
  seedId: ProvinceId,
  targetCount: number,
  inZone: (id: ProvinceId) => boolean,
  claimedGlobally: Set<ProvinceId>,
  rng: Rng,
): ProvinceId[] {
  const byId = new Map(provinces.map(p => [p.id, p]));
  const claimed: ProvinceId[] = [seedId];
  const claimedSet = new Set<ProvinceId>([seedId]);
  claimedGlobally.add(seedId);

  while (claimed.length < targetCount) {
    const frontier = new Set<ProvinceId>();
    for (const cid of claimed) {
      for (const nid of byId.get(cid)!.neighbors) {
        if (!claimedSet.has(nid) && !claimedGlobally.has(nid)) frontier.add(nid);
      }
    }
    if (frontier.size === 0) break; // sin más territorio contiguo libre (no debería pasar en la rejilla 8x5)

    const inZoneList = rng.shuffle([...frontier].filter(inZone));
    const outZoneList = rng.shuffle([...frontier].filter(id => !inZone(id)));
    const pick = inZoneList.length > 0 ? inZoneList[0] : outZoneList[0];

    claimed.push(pick);
    claimedSet.add(pick);
    claimedGlobally.add(pick);
  }
  return claimed;
}
