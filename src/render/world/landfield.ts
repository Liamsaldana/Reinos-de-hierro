/**
 * Campo de tierra (land field): convierte la unión de polígonos de provincia en
 * una silueta de continente real. Da, para cualquier punto del plano:
 *  - `distanceToLand`  distancia al polígono de provincia más cercano (0 dentro),
 *  - `landMask`        [0,1] con transición de costa ruidosa (bahías / cabos),
 *  - clasificación de REGIÓN (bandas del mapgen) y sus centroides.
 *
 * Todo determinista: el ruido de costa y los islotes decorativos salen de
 * `visualRng(seed)`. Módulo interno del renderer del mundo (Agente K).
 */
import type { Province, ProvinceId } from '../../core/types';
import { visualRng } from '../../core/state/rng';

export type RegionKey = 'norte' | 'costa' | 'estepa' | 'arenas' | 'corazon';

export interface RegionInfo {
  key: RegionKey;
  name: string;
  center: [number, number];
  provinceIds: ProvinceId[];
}

export interface Islet {
  x: number;
  z: number;
  r: number;
  /** altura de la cima del islote sobre el nivel del mar */
  peak: number;
}

const REGION_NAMES: Record<RegionKey, string> = {
  norte: 'El Norte',
  costa: 'La Costa',
  estepa: 'La Estepa',
  arenas: 'Las Arenas',
  corazon: 'El Corazón',
};

/** distancia² de un punto al segmento AB. */
function distSqToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? (apx * abx + apz * abz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** ruido fbm suave y determinista (suma de senos con fase sembrada). */
function makeFbm(seed: number, freqs: number[], baseAmp: number): (x: number, z: number) => number {
  const r = visualRng(seed);
  const waves: { ax: number; az: number; ph: number; amp: number }[] = [];
  let amp = baseAmp;
  for (const f of freqs) {
    const ang = r.next() * Math.PI * 2;
    waves.push({ ax: Math.cos(ang) * f, az: Math.sin(ang) * f, ph: r.next() * Math.PI * 2, amp });
    amp *= 0.55;
  }
  return (x, z) => {
    let n = 0;
    for (const w of waves) n += w.amp * Math.sin(w.ax * x + w.az * z + w.ph);
    return n;
  };
}

/** Recupera (row, col) de rejilla desde el centro con jitter (spacing 20). */
function gridOf(center: [number, number]): { row: number; col: number } {
  const col = Math.max(0, Math.min(7, Math.round((center[0] + 70) / 20)));
  const row = Math.max(0, Math.min(4, Math.round((center[1] + 40) / 20)));
  return { row, col };
}

/** Clasifica una provincia en su banda-región (misma precedencia que zoneOf del mapgen). */
function regionKeyOf(center: [number, number]): RegionKey {
  const { row, col } = gridOf(center);
  if (col === 0) return 'costa';
  if (row === 0) return 'norte';
  if (row === 4) return 'arenas';
  if (col >= 5) return 'estepa';
  return 'corazon';
}

export class LandField {
  /** margen de tierra más allá de los polígonos, antes de fundir a mar. */
  static readonly COAST_MARGIN = 5.0;
  /** ancho de la transición de costa. */
  static readonly COAST_W = 3.2;
  /** radio del disco por provincia que RELLENA el interior del continente
   *  (une los huecos diagonales entre provincias). Dimensionado para cubrir el
   *  punto medio diagonal (~14 con jitter) y dejar el continente SÓLIDO. */
  static readonly DISK_R = 16;

  private readonly polys: [number, number][][];
  private readonly centers: [number, number][];
  private readonly coastNoise: (x: number, z: number) => number;
  readonly islets: Islet[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(provinces: Province[], seed: number) {
    this.polys = provinces.map((p) => p.polygon);
    this.centers = provinces.map((p) => p.center);
    this.coastNoise = makeFbm(seed ^ 0x0c0a57, [0.08, 0.16, 0.31], 2.2);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const poly of this.polys) {
      for (const [x, z] of poly) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.islets = this.seedIslets(seed);
  }

  /** islotes decorativos sueltos, mar afuera de la silueta principal. */
  private seedIslets(seed: number): Islet[] {
    const r = visualRng(seed ^ 0x15efab);
    const out: Islet[] = [];
    const cx = (this.bounds.minX + this.bounds.maxX) / 2;
    const cz = (this.bounds.minZ + this.bounds.maxZ) / 2;
    const spanX = (this.bounds.maxX - this.bounds.minX) / 2;
    const spanZ = (this.bounds.maxZ - this.bounds.minZ) / 2;
    let tries = 0;
    while (out.length < 7 && tries < 80) {
      tries++;
      const ang = r.next() * Math.PI * 2;
      // anillo mar afuera: entre 1.18 y 1.5 del semieje
      const rad = 1.18 + r.next() * 0.32;
      const x = cx + Math.cos(ang) * spanX * rad;
      const z = cz + Math.sin(ang) * spanZ * rad;
      if (this.rawDistanceToLand(x, z) < 12) continue; // demasiado cerca del continente
      out.push({ x, z, r: 2.4 + r.next() * 3.2, peak: 0.7 + r.next() * 1.3 });
    }
    return out;
  }

  /**
   * distancia efectiva a tierra: mínimo entre
   *  (a) distancia al polígono de provincia más cercano (0 dentro) — costa tensa,
   *  (b) distancia al disco de centro más cercano (radio DISK_R) — relleno interior.
   * Así la costa EXTERIOR sigue el contorno de las provincias mientras el interior
   * del continente queda sólido (sin huecos diagonales).
   */
  private rawDistanceToLand(x: number, z: number): number {
    let best = Infinity;
    for (const poly of this.polys) {
      if (pointInPolygon(x, z, poly)) return 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const d = distSqToSegment(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
        if (d < best) best = d;
      }
    }
    let polyDist = Math.sqrt(best);

    let cbest = Infinity;
    for (const c of this.centers) {
      const d = (x - c[0]) ** 2 + (z - c[1]) ** 2;
      if (d < cbest) cbest = d;
    }
    const diskDist = Math.max(0, Math.sqrt(cbest) - LandField.DISK_R);
    if (diskDist < polyDist) polyDist = diskDist;
    return polyDist;
  }

  /** distancia efectiva a tierra teniendo en cuenta islotes (0 dentro de un islote). */
  distanceToLand(x: number, z: number): number {
    let d = this.rawDistanceToLand(x, z);
    for (const is of this.islets) {
      const dd = Math.hypot(x - is.x, z - is.z) - is.r;
      if (dd < d) d = Math.max(0, dd);
    }
    return d;
  }

  /** máscara de tierra en [0,1] con orilla ruidosa. 1 = tierra firme, 0 = mar abierto. */
  landMask(x: number, z: number): number {
    const d = this.rawDistanceToLand(x, z);
    const n = this.coastNoise(x, z);
    // signed<0 => tierra ; signed>0 => mar
    const signed = d - LandField.COAST_MARGIN - n;
    let m = 0.5 - signed / (2 * LandField.COAST_W);
    if (m < 0) m = 0;
    else if (m > 1) m = 1;
    let mask = m * m * (3 - 2 * m); // smoothstep

    // islotes: unión suave
    for (const is of this.islets) {
      const dd = Math.hypot(x - is.x, z - is.z) - is.r;
      let mi = 0.5 - dd / (2 * 1.8);
      if (mi < 0) mi = 0;
      else if (mi > 1) mi = 1;
      mi = mi * mi * (3 - 2 * mi);
      if (mi > mask) mask = mi;
    }
    return mask;
  }

  /** altura extra aportada por el islote más cercano (0 fuera de islotes). */
  isletPeak(x: number, z: number): number {
    let h = 0;
    for (const is of this.islets) {
      const dd = Math.hypot(x - is.x, z - is.z);
      if (dd < is.r) h = Math.max(h, is.peak * (1 - dd / is.r));
    }
    return h;
  }

  /** ¿este punto cae dentro de algún polígono de provincia (tierra firme segura)? */
  insideAnyProvince(x: number, z: number): boolean {
    for (const poly of this.polys) if (pointInPolygon(x, z, poly)) return true;
    return false;
  }

  /** clasificación de región de una provincia por su centro. */
  static regionOf(center: [number, number]): RegionKey {
    return regionKeyOf(center);
  }

  /** ¿la provincia pertenece a la banda norte (fila 0)? útil para abetos nevados. */
  static isNorth(center: [number, number]): boolean {
    return gridOf(center).row === 0;
  }

  /** regiones con su centroide (media de centros de las provincias de la banda). */
  static regions(provinces: Province[]): RegionInfo[] {
    const groups = new Map<RegionKey, { sx: number; sz: number; ids: ProvinceId[] }>();
    for (const p of provinces) {
      const key = regionKeyOf(p.center);
      const g = groups.get(key) ?? { sx: 0, sz: 0, ids: [] };
      g.sx += p.center[0];
      g.sz += p.center[1];
      g.ids.push(p.id);
      groups.set(key, g);
    }
    const out: RegionInfo[] = [];
    for (const [key, g] of groups) {
      const n = g.ids.length;
      out.push({
        key,
        name: REGION_NAMES[key],
        center: [g.sx / n, g.sz / n],
        provinceIds: g.ids,
      });
    }
    return out;
  }
}
