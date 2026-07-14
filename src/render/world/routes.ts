/**
 * Flechas de ruta punteadas: del ejército seleccionado a cada provincia destino
 * cuando hay órdenes de movimiento activas. Cinta arqueada elevada con textura
 * de guiones + punta de flecha. Color pergamino; destinos hostiles en rojo sangre.
 */
import * as THREE from 'three';
import { ART } from './palette';

export interface RoutesBuild {
  group: THREE.Group;
  dispose(): void;
}

export interface RouteTarget {
  x: number;
  z: number;
  hostile: boolean;
}

/** textura blanca de guiones sobre transparente, teselable en U. */
function makeDashTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  // guion ~62% + hueco
  ctx.beginPath();
  ctx.roundRect(2, H * 0.28, W * 0.6, H * 0.44, H * 0.22);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildRoutes(
  from: { x: number; z: number },
  targets: RouteTarget[],
  baseY: number,
): RoutesBuild {
  const group = new THREE.Group();
  group.name = 'routes';
  const dashTex = makeDashTexture();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const parchment = new THREE.Color(ART.parchment);
  const red = new THREE.Color(ART.warRed);
  const HALF_W = 0.6;
  const STEPS = 26;

  for (const t of targets) {
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const arc = Math.min(6, 2 + len * 0.12); // altura del arco

    // muestreo de la curva (cuadrática) y su tangente en XZ
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const s = i / STEPS;
      const x = from.x + dx * s;
      const z = from.z + dz * s;
      const y = baseY + Math.sin(Math.PI * s) * arc;
      pts.push(new THREE.Vector3(x, y, z));
    }

    // cinta a lo largo de la curva
    const positions: number[] = [];
    const uvs: number[] = [];
    const nrm = new THREE.Vector3();
    for (let i = 0; i <= STEPS; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(STEPS, i + 1)];
      nrm.set(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(HALF_W);
      positions.push(p.x - nrm.x, p.y, p.z - nrm.z);
      positions.push(p.x + nrm.x, p.y, p.z + nrm.z);
      const u = (i / STEPS) * (len / 3.2);
      uvs.push(u, 0, u, 1);
    }
    const idx: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      map: dashTex,
      color: t.hostile ? red : parchment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(geo, mat);
    ribbon.renderOrder = 14;
    group.add(ribbon);
    geos.push(geo);
    mats.push(mat);

    // punta de flecha
    const tip = pts[STEPS];
    const before = pts[STEPS - 1];
    const dir = new THREE.Vector3().subVectors(tip, before).normalize();
    const headGeo = new THREE.ConeGeometry(1.0, 2.0, 10);
    const headMat = new THREE.MeshBasicMaterial({
      color: t.hostile ? red : parchment,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.copy(tip);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    head.quaternion.copy(q);
    head.renderOrder = 15;
    group.add(head);
    geos.push(headGeo);
    mats.push(headMat);
  }

  return {
    group,
    dispose(): void {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      dashTex.dispose();
      group.clear();
    },
  };
}
