/**
 * Vegetación y detalle del terreno, todo procedural e instanciado (un draw call
 * por familia): BOSQUES (cono + tronco), ROCAS (icosaedro deformado) y JUNCOS de
 * pantano. Sembrado con visualRng por provincia → determinista. Se apaga a
 * distancia (LOD) desde la escena.
 */
import * as THREE from 'three';
import type { Province, Terrain } from '../../core/types';
import { visualRng } from '../../core/state/rng';
import { ART } from './palette';
import { LandField } from './landfield';

export interface FloraBuild {
  group: THREE.Group;
  setDetailVisible(v: boolean): void;
  dispose(): void;
}

interface TreeInst { x: number; z: number; y: number; s: number; tall: number; rot: number; color: THREE.Color }
interface RockInst { x: number; z: number; y: number; s: number; rx: number; ry: number; rz: number; shade: number }
interface ReedInst { x: number; z: number; y: number; s: number }

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(poly: [number, number][]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** ¿cuántos árboles y de qué carácter siembra este terreno? */
function treeBudget(terrain: Terrain): { min: number; max: number } {
  switch (terrain) {
    case 'forest': return { min: 40, max: 90 };
    case 'hills': return { min: 10, max: 22 };
    case 'plains': return { min: 6, max: 16 };
    case 'coast': return { min: 4, max: 10 };
    case 'swamp': return { min: 3, max: 8 };
    default: return { min: 0, max: 0 };
  }
}

function rockBudget(terrain: Terrain): { min: number; max: number } {
  switch (terrain) {
    case 'mountain': return { min: 14, max: 26 };
    case 'hills': return { min: 6, max: 14 };
    case 'desert': return { min: 3, max: 7 };
    case 'steppe': return { min: 2, max: 5 };
    default: return { min: 0, max: 0 };
  }
}

export function buildFlora(
  provinces: Province[],
  field: LandField,
  sampleHeight: (x: number, z: number) => number,
  seed: number,
): FloraBuild {
  const trees: TreeInst[] = [];
  const rocks: RockInst[] = [];
  const reeds: ReedInst[] = [];

  const firNorth = new THREE.Color(ART.firNorth);
  const firTemp = new THREE.Color(ART.firTemperate);
  const snow = new THREE.Color(ART.snow);

  for (const p of provinces) {
    const north = LandField.isNorth(p.center);
    const box = bbox(p.polygon);
    const r = visualRng(seed ^ (p.id * 0x9e37) ^ 0xf10);

    // ---- árboles ----
    const tb = treeBudget(p.terrain);
    const nTrees = tb.max > 0 ? r.int(tb.min, tb.max) : 0;
    let placed = 0;
    let attempts = 0;
    while (placed < nTrees && attempts < nTrees * 6) {
      attempts++;
      const x = box.minX + r.next() * (box.maxX - box.minX);
      const z = box.minZ + r.next() * (box.maxZ - box.minZ);
      if (!pointInPolygon(x, z, p.polygon)) continue;
      const y = sampleHeight(x, z);
      if (y < 0.35) continue; // no árboles en la orilla/agua
      placed++;
      const base = north ? firNorth.clone() : firTemp.clone();
      base.multiplyScalar(0.82 + r.next() * 0.3);
      if (north) base.lerp(snow, 0.12 + r.next() * 0.16); // abetos nevados
      trees.push({
        x, z, y,
        s: 0.62 + r.next() * 0.7,
        tall: north ? 1.25 + r.next() * 0.35 : 0.9 + r.next() * 0.35,
        rot: r.next() * Math.PI * 2,
        color: base,
      });
    }

    // ---- rocas ----
    const rb = rockBudget(p.terrain);
    const nRocks = rb.max > 0 ? r.int(rb.min, rb.max) : 0;
    let rPlaced = 0;
    let rAtt = 0;
    while (rPlaced < nRocks && rAtt < nRocks * 6) {
      rAtt++;
      const x = box.minX + r.next() * (box.maxX - box.minX);
      const z = box.minZ + r.next() * (box.maxZ - box.minZ);
      if (!pointInPolygon(x, z, p.polygon)) continue;
      const y = sampleHeight(x, z);
      if (y < 0.35) continue;
      rPlaced++;
      rocks.push({
        x, z, y,
        s: 0.4 + r.next() * 1.05,
        rx: r.next() * Math.PI, ry: r.next() * Math.PI, rz: r.next() * Math.PI,
        shade: 0.78 + r.next() * 0.4,
      });
    }

    // ---- juncos (pantano) ----
    if (p.terrain === 'swamp') {
      const nReed = r.int(30, 55);
      let reedP = 0;
      let reedAtt = 0;
      while (reedP < nReed && reedAtt < nReed * 6) {
        reedAtt++;
        const x = box.minX + r.next() * (box.maxX - box.minX);
        const z = box.minZ + r.next() * (box.maxZ - box.minZ);
        if (!pointInPolygon(x, z, p.polygon)) continue;
        const y = sampleHeight(x, z);
        if (y < 0.3) continue;
        reedP++;
        reeds.push({ x, z, y, s: 0.55 + r.next() * 0.7 });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'flora';
  const disposables: { dispose(): void }[] = [];
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const vScale = new THREE.Vector3();
  const vPos = new THREE.Vector3();

  // ---- follaje (conos) ----
  if (trees.length > 0) {
    const coneGeo = new THREE.ConeGeometry(0.95, 2.0, 6);
    coneGeo.translate(0, 1.7, 0); // base del cono sobre el tronco (0.7) + medio cono (1.0)
    const coneMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const foliage = new THREE.InstancedMesh(coneGeo, coneMat, trees.length);
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.7, 5);
    trunkGeo.translate(0, 0.35, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ART.bark) });
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);

    trees.forEach((t, i) => {
      eul.set(0, t.rot, 0);
      quat.setFromEuler(eul);
      vPos.set(t.x, t.y, t.z);
      vScale.set(t.s, t.s * t.tall, t.s);
      mat4.compose(vPos, quat, vScale);
      foliage.setMatrixAt(i, mat4);
      foliage.setColorAt(i, t.color);
      trunk.setMatrixAt(i, mat4);
    });
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    trunk.instanceMatrix.needsUpdate = true;
    foliage.castShadow = false;
    group.add(trunk, foliage);
    disposables.push(coneGeo, coneMat, trunkGeo, trunkMat);
  }

  // ---- rocas (icosaedro deformado, compartido) ----
  if (rocks.length > 0) {
    const rockGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const rr = visualRng(seed ^ 0xa0c1);
    const rpos = rockGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rpos.count; i++) {
      const f = 0.7 + rr.next() * 0.7;
      rpos.setXYZ(i, rpos.getX(i) * f, rpos.getY(i) * (0.6 + rr.next() * 0.5), rpos.getZ(i) * f);
    }
    rockGeo.computeVertexNormals();
    rockGeo.translate(0, 0.32, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    const rockBase = new THREE.Color(ART.rock);
    const rc = new THREE.Color();
    rocks.forEach((rk, i) => {
      eul.set(rk.rx, rk.ry, rk.rz);
      quat.setFromEuler(eul);
      vPos.set(rk.x, rk.y, rk.z);
      vScale.set(rk.s, rk.s * 0.8, rk.s);
      mat4.compose(vPos, quat, vScale);
      rockMesh.setMatrixAt(i, mat4);
      rc.copy(rockBase).multiplyScalar(rk.shade);
      rockMesh.setColorAt(i, rc);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    group.add(rockMesh);
    disposables.push(rockGeo, rockMat);
  }

  // ---- juncos ----
  if (reeds.length > 0) {
    const reedGeo = new THREE.ConeGeometry(0.09, 1.3, 4);
    reedGeo.translate(0, 0.65, 0);
    const reedMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ART.reed) });
    const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, reeds.length);
    reeds.forEach((rd, i) => {
      eul.set(0, 0, 0);
      quat.setFromEuler(eul);
      vPos.set(rd.x, rd.y, rd.z);
      vScale.set(rd.s, rd.s, rd.s);
      mat4.compose(vPos, quat, vScale);
      reedMesh.setMatrixAt(i, mat4);
    });
    reedMesh.instanceMatrix.needsUpdate = true;
    group.add(reedMesh);
    disposables.push(reedGeo, reedMat);
  }

  return {
    group,
    setDetailVisible(v: boolean): void {
      group.visible = v;
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
