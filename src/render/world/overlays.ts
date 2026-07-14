/**
 * Capa política: por provincia, un relleno plano (THREE.Shape del polígono) y su
 * borde, con estados hover / seleccionada / destino-de-movimiento. Cada relleno
 * lleva userData.provinceId para el picking.
 */
import * as THREE from 'three';
import type { Province, ProvinceId } from '../../core/types';
import { ART, lighten } from './palette';

const FILL_BASE = 0.30;
const FILL_HOVER = 0.48;
const FILL_SELECTED = 0.55;

function centroidOf(poly: [number, number][]): [number, number] {
  let sx = 0;
  let sz = 0;
  for (const [x, z] of poly) {
    sx += x;
    sz += z;
  }
  return [sx / poly.length, sz / poly.length];
}

/** LineLoop cerrado del polígono a una altura fija, opcionalmente expandido desde el centroide. */
function buildLoop(
  poly: [number, number][],
  y: number,
  centroid: [number, number],
  expand: number,
  material: THREE.LineBasicMaterial,
): THREE.LineLoop {
  const pts: number[] = [];
  for (const [x, z] of poly) {
    pts.push(centroid[0] + (x - centroid[0]) * expand, y, centroid[1] + (z - centroid[1]) * expand);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineLoop(geo, material);
}

/**
 * Overlay de una provincia. `objects` son los Object3D que la escena añade al
 * grafo; `fill` es además el objetivo de raycast (userData.provinceId).
 */
export class ProvinceOverlay {
  readonly id: ProvinceId;
  readonly fill: THREE.Mesh;
  readonly border: THREE.LineLoop;
  readonly moveBorder: THREE.LineLoop;
  readonly objects: THREE.Object3D[];

  hover = false;
  selected = false;
  moveTarget = false;

  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly borderMat: THREE.LineBasicMaterial;
  private readonly moveMat: THREE.LineBasicMaterial;
  private readonly borderBase = new THREE.Color();

  constructor(province: Province, centerH: number, ownerColor: string) {
    this.id = province.id;
    const poly = province.polygon;
    const centroid = centroidOf(poly);

    // relleno
    const shape = new THREE.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
    shape.closePath();
    const fillGeo = new THREE.ShapeGeometry(shape);
    fillGeo.rotateX(Math.PI / 2); // (x, z, 0) → (x, 0, z)

    this.fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(ownerColor),
      transparent: true,
      opacity: FILL_BASE,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(fillGeo, this.fillMat);
    this.fill.position.y = centerH + 0.45;
    this.fill.renderOrder = 1;
    this.fill.userData.provinceId = province.id;

    // bordes
    this.borderMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    this.moveMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(ART.moveRed),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.border = buildLoop(poly, centerH + 0.51, centroid, 1.0, this.borderMat);
    this.border.renderOrder = 2;
    this.moveBorder = buildLoop(poly, centerH + 0.55, centroid, 1.02, this.moveMat);
    this.moveBorder.renderOrder = 3;
    this.moveBorder.visible = false;

    this.setOwnerColor(ownerColor);
    this.objects = [this.fill, this.border, this.moveBorder];
  }

  setOwnerColor(hex: string): void {
    this.fillMat.color.set(hex);
    this.borderBase.copy(lighten(hex, 0.35));
  }

  /** aplica el estado visual actual. `pulse` es la opacidad del relleno pulsante para destinos. */
  apply(pulse: number): void {
    let opacity = FILL_BASE;
    if (this.hover) opacity = FILL_HOVER;
    if (this.moveTarget) opacity = pulse;
    if (this.selected) opacity = FILL_SELECTED;
    this.fillMat.opacity = opacity;

    if (this.selected) {
      this.borderMat.color.set(ART.selected);
      this.borderMat.opacity = 1;
    } else if (this.moveTarget) {
      this.borderMat.color.set(ART.moveRed);
      this.borderMat.opacity = 0.95;
    } else {
      this.borderMat.color.copy(this.borderBase);
      this.borderMat.opacity = 0.9;
    }
    this.moveBorder.visible = this.moveTarget;
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.border.geometry.dispose();
    this.moveBorder.geometry.dispose();
    this.fillMat.dispose();
    this.borderMat.dispose();
    this.moveMat.dispose();
  }
}
