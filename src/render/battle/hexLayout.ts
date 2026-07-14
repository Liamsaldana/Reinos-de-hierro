/**
 * Geometría de la rejilla hexagonal pointy-top (coordenadas axiales q,r).
 * Calcula tamaño y offset para encajar toda la rejilla en el lienzo y ofrece
 * conversiones pixel↔hex. Puro (sin Phaser, sin DOM).
 */
import type { HexCoord, TacticalCell } from '../../core/tactical/types';

const SQRT3 = Math.sqrt(3);

export interface Pt { x: number; y: number }

export interface LayoutInsets {
  top: number;
  bottom: number;
  x: number;
}

/** coordenada de un hex en unidades de tamaño 1 (sin escala ni offset). */
function unitX(q: number, r: number): number { return SQRT3 * (q + r / 2); }
function unitY(r: number): number { return 1.5 * r; }

/** redondeo axial via coordenadas cúbicas. */
export function axialRound(qf: number, rf: number): HexCoord {
  const xf = qf;
  const zf = rf;
  const yf = -qf - rf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function hexKey(c: HexCoord): string { return `${c.q},${c.r}`; }

export class HexLayout {
  size = 12;
  ox = 0;
  oy = 0;

  constructor(cells: TacticalCell[], viewW: number, viewH: number, insets: LayoutInsets) {
    this.fit(cells, viewW, viewH, insets);
  }

  /** recalcula tamaño y offset para centrar y encajar la rejilla. */
  fit(cells: TacticalCell[], viewW: number, viewH: number, insets: LayoutInsets): void {
    if (cells.length === 0) { this.size = 12; this.ox = viewW / 2; this.oy = viewH / 2; return; }
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const c of cells) {
      const x = unitX(c.coord.q, c.coord.r);
      const y = unitY(c.coord.r);
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    // extensión de medio hex (pointy-top): medio ancho = √3/2, media altura = 1.
    minx -= SQRT3 / 2; maxx += SQRT3 / 2;
    miny -= 1; maxy += 1;
    const uw = Math.max(maxx - minx, 0.001);
    const uh = Math.max(maxy - miny, 0.001);
    const availW = Math.max(viewW - insets.x * 2, 40);
    const availH = Math.max(viewH - insets.top - insets.bottom, 40);
    this.size = Math.max(6, Math.min(availW / uw, availH / uh));
    const gw = uw * this.size;
    const gh = uh * this.size;
    this.ox = insets.x + (availW - gw) / 2 - minx * this.size;
    this.oy = insets.top + (availH - gh) / 2 - miny * this.size;
  }

  toPixel(c: HexCoord): Pt {
    return {
      x: this.ox + unitX(c.q, c.r) * this.size,
      y: this.oy + unitY(c.r) * this.size,
    };
  }

  /** las 6 esquinas del hex (pointy-top). */
  corners(c: HexCoord): Pt[] {
    const center = this.toPixel(c);
    const pts: Pt[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      pts.push({ x: center.x + this.size * Math.cos(ang), y: center.y + this.size * Math.sin(ang) });
    }
    return pts;
  }

  pixelToHex(px: number, py: number): HexCoord {
    const dx = (px - this.ox) / this.size;
    const dy = (py - this.oy) / this.size;
    const q = (SQRT3 / 3) * dx - (1 / 3) * dy;
    const r = (2 / 3) * dy;
    return axialRound(q, r);
  }

  /** radio recomendado para las fichas de unidad. */
  unitRadius(): number {
    return Math.max(9, Math.min(22, this.size * 0.46));
  }
}
