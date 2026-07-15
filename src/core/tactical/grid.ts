/**
 * Utilidades de rejilla hexagonal (pointy-top, coords axiales) para el motor
 * táctico (GDD §8). SIN estado propio: funciones puras sobre HexCoord/celdas.
 * AGENTE F.
 */
import type { HexCoord, TacticalCell, TacticalTerrain } from './types';

/** vecinos axiales (pointy-top) */
export function hexNeighbors(c: HexCoord): HexCoord[] {
  const d = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  return d.map(([dq, dr]) => ({ q: c.q + dq, r: c.r + dr }));
}

/** distancia hexagonal (número de pasos) */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** clave estable para indexar celdas por coordenada */
export function cellKey(c: HexCoord): string {
  return `${c.q},${c.r}`;
}

/**
 * Convierte (col, row) de un rectángulo con offset a axial pointy-top.
 * q = col - floor(row/2), r = row. Produce adyacencias correctas con
 * hexNeighbors: cada celda conecta con 2 en su fila y 2 arriba / 2 abajo.
 */
export function offsetToAxial(col: number, row: number): HexCoord {
  return { q: col - Math.floor(row / 2), r: row };
}

/** coste de entrar en una celda (Infinity = intransitable) */
export function terrainCost(cell: TacticalCell): number {
  if (cell.blocked) return Infinity;
  return moveCostOf(cell.terrain);
}

export function moveCostOf(t: TacticalTerrain): number {
  switch (t) {
    case 'bosque':
    case 'pantano':
    case 'rio':
      return 2;
    case 'llano':
    case 'colina':
    default:
      return 1;
  }
}

/** índice celda→objeto por clave axial */
export function buildCellMap(cells: TacticalCell[]): Map<string, TacticalCell> {
  const m = new Map<string, TacticalCell>();
  for (const c of cells) m.set(cellKey(c.coord), c);
  return m;
}
