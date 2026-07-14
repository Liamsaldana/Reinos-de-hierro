/**
 * Capa política por provincia:
 *  - relleno plano sutil (tinte del dueño) que además es el objetivo de picking
 *    (userData.provinceId),
 *  - BORDE en cinta con el color del dueño: las aristas EXTERIORES de reino
 *    (vecino de otro dueño o mar) van más gruesas y claras que las internas,
 *  - HALO aditivo: doble filo del jugador en su color de casa; pulso rojo lento
 *    en provincias en guerra contigo; realce pergamino en la seleccionada.
 */
import * as THREE from 'three';
import type { FactionId, Province, ProvinceId } from '../../core/types';
import { ART, lighten, darken } from './palette';

const FILL_BASE = 0.14;
const FILL_HOVER = 0.30;
const FILL_SELECTED = 0.42;
const W_INT = 0.55;
const W_EXT = 1.4;
const W_HALO = 1.5;

export interface NeighborCenter { id: ProvinceId; center: [number, number] }

export interface BorderContext {
  ownerHex: string;
  selfOwner: FactionId | null;
  isPlayer: boolean;
  isEnemyAtWar: boolean;
  ownerOf: (id: ProvinceId) => FactionId | null;
}

interface EdgeInfo {
  ax: number; az: number; bx: number; bz: number;
  nx: number; nz: number; // normal exterior unitaria
  neighborId: ProvinceId; // -1 = mar / frontera del mundo
}

function centroidOf(poly: [number, number][]): [number, number] {
  let sx = 0;
  let sz = 0;
  for (const [x, z] of poly) { sx += x; sz += z; }
  return [sx / poly.length, sz / poly.length];
}

export class ProvinceOverlay {
  readonly id: ProvinceId;
  readonly fill: THREE.Mesh;
  readonly border: THREE.Mesh;
  readonly halo: THREE.Mesh;
  readonly objects: THREE.Object3D[];

  hover = false;
  selected = false;
  moveTarget = false;

  private readonly edges: EdgeInfo[];
  private readonly y: number;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly borderMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly borderBase = new THREE.Color();
  private readonly houseColor = new THREE.Color();
  private isPlayer = false;
  private isEnemyAtWar = false;

  constructor(province: Province, centerH: number, ownerColor: string, neighbors: NeighborCenter[]) {
    this.id = province.id;
    const poly = province.polygon;
    const centroid = centroidOf(poly);
    this.y = centerH + 0.5;

    // aristas con normal exterior y provincia vecina (por sondeo hacia afuera)
    this.edges = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      let nx = mx - centroid[0];
      let nz = mz - centroid[1];
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const px = mx + nx * 3.0;
      const pz = mz + nz * 3.0;
      let neighborId: ProvinceId = -1;
      let best = 16 * 16;
      for (const nb of neighbors) {
        const d = (nb.center[0] - px) ** 2 + (nb.center[1] - pz) ** 2;
        if (d < best) { best = d; neighborId = nb.id; }
      }
      this.edges.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx, nz, neighborId });
    }

    // relleno (picking)
    const shape = new THREE.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
    shape.closePath();
    const fillGeo = new THREE.ShapeGeometry(shape);
    fillGeo.rotateX(Math.PI / 2);
    this.fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(ownerColor),
      transparent: true,
      opacity: FILL_BASE,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(fillGeo, this.fillMat);
    this.fill.position.y = centerH + 0.42;
    this.fill.renderOrder = 1;
    this.fill.userData.provinceId = province.id;

    this.borderMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    });
    this.border = new THREE.Mesh(new THREE.BufferGeometry(), this.borderMat);
    this.border.renderOrder = 3;

    this.haloMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(new THREE.BufferGeometry(), this.haloMat);
    this.halo.renderOrder = 2;
    this.halo.visible = false;

    this.objects = [this.fill, this.halo, this.border];
  }

  /** ¿es exterior de reino esta arista? (vecino de otro dueño o mar). */
  private isExterior(e: EdgeInfo, ctx: BorderContext): boolean {
    if (e.neighborId < 0) return true;
    return ctx.ownerOf(e.neighborId) !== ctx.selfOwner;
  }

  /**
   * Anillo continuo (mitered) alrededor del contorno: ancho y color por VÉRTICE,
   * sin solapes en las esquinas (evita los "puntos" que produce una cinta por
   * arista). El ancho de esquina se corrige por el ángulo del miter.
   */
  private ring(widthAt: number[], colorAt: THREE.Color[]): THREE.BufferGeometry {
    const n = this.edges.length;
    const inner: [number, number][] = [];
    const outer: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const eA = this.edges[(i - 1 + n) % n];
      const eB = this.edges[i];
      let mx = eA.nx + eB.nx;
      let mz = eA.nz + eB.nz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const cosHalf = Math.max(0.4, mx * eB.nx + mz * eB.nz);
      const w = widthAt[i] / cosHalf;
      const vx = eB.ax;
      const vz = eB.az;
      inner.push([vx - mx * w * 0.32, vz - mz * w * 0.32]);
      outer.push([vx + mx * w * 0.68, vz + mz * w * 0.68]);
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const push = (p: [number, number], c: THREE.Color): void => {
      positions.push(p[0], this.y, p[1]);
      colors.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ci = colorAt[i];
      const cj = colorAt[j];
      push(inner[i], ci); push(outer[i], ci); push(outer[j], cj);
      push(inner[i], ci); push(outer[j], cj); push(inner[j], cj);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }

  /** reconstruye los bordes según el estado de propiedad y guerra actual. */
  rebuild(ctx: BorderContext): void {
    this.fillMat.color.set(ctx.ownerHex);
    this.borderBase.copy(lighten(ctx.ownerHex, 0.28));
    this.houseColor.copy(lighten(ctx.ownerHex, 0.18));
    this.isPlayer = ctx.isPlayer;
    this.isEnemyAtWar = ctx.isEnemyAtWar;

    const extColor = lighten(ctx.ownerHex, 0.5);
    const intColor = darken(ctx.ownerHex, 0.12);
    const n = this.edges.length;
    const ext = this.edges.map((e) => this.isExterior(e, ctx));

    // ancho/color por vértice: exterior si cualquiera de sus dos aristas lo es
    const widths: number[] = [];
    const cols: THREE.Color[] = [];
    for (let i = 0; i < n; i++) {
      const isExt = ext[(i - 1 + n) % n] || ext[i];
      widths.push(isExt ? W_EXT : W_INT);
      cols.push(isExt ? extColor : intColor);
    }
    this.border.geometry.dispose();
    this.border.geometry = this.ring(widths, cols);

    this.halo.geometry.dispose();
    if (ctx.isPlayer || ctx.isEnemyAtWar) {
      const hw = new Array(n).fill(W_HALO);
      const hc = new Array(n).fill(this.houseColor);
      this.halo.geometry = this.ring(hw, hc);
    } else {
      this.halo.geometry = new THREE.BufferGeometry();
    }
  }

  /** aplica el estado visual del fotograma. `pulse` en [0,1] (para pulsos lentos). */
  apply(pulse: number): void {
    let opacity = FILL_BASE;
    if (this.hover) opacity = FILL_HOVER;
    if (this.moveTarget) opacity = 0.35 + pulse * 0.3;
    if (this.selected) opacity = FILL_SELECTED;
    this.fillMat.opacity = opacity;

    // color/brillo del borde
    if (this.selected) {
      this.borderMat.color.set(ART.selected);
    } else if (this.moveTarget) {
      this.borderMat.color.set(ART.moveRed);
    } else if (this.isEnemyAtWar) {
      this.borderMat.color.copy(new THREE.Color(ART.warRed).lerp(this.borderBase, 0.35));
    } else {
      this.borderMat.color.setRGB(1, 1, 1);
    }

    // halo aditivo
    if (this.selected) {
      this.haloMat.color.set(ART.selected);
      this.haloMat.opacity = 0.28 + pulse * 0.22;
      this.halo.visible = true;
    } else if (this.isEnemyAtWar) {
      this.haloMat.color.set(ART.warRed);
      this.haloMat.opacity = 0.18 + pulse * 0.34; // pulso rojo lento
      this.halo.visible = true;
    } else if (this.isPlayer) {
      this.haloMat.color.copy(this.houseColor);
      this.haloMat.opacity = 0.26;
      this.halo.visible = true;
    } else {
      this.haloMat.opacity = 0;
      this.halo.visible = false;
    }
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.border.geometry.dispose();
    this.halo.geometry.dispose();
    this.fillMat.dispose();
    this.borderMat.dispose();
    this.haloMat.dispose();
  }
}
