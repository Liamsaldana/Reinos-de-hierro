/**
 * Terreno del mapa estratégico. Ya no es una mesa rectangular: la tierra se
 * recorta contra la silueta del continente (LandField) y todo lo demás es MAR
 * profundo. Aporta:
 *   - `ground`  malla de relieve + fondo marino, coloreada por vértice (terreno,
 *               nieve norteña/cumbres, dunas de desierto, tono húmedo de pantano,
 *               ruido de detalle multi-octava y un filo de espuma en la costa),
 *   - `water`   plano de mar translúcido con deriva MUY lenta (respeta
 *               prefers-reduced-motion) sobre un degradado de profundidad,
 *   - `sampleHeight(x,z)` puro y determinista para colocar castillos/labels/flora.
 */
import * as THREE from 'three';
import type { Province, Terrain } from '../../core/types';
import { visualRng } from '../../core/state/rng';
import { TERRAIN_COLORS, ART } from './palette';
import { LandField } from './landfield';

export interface TerrainBuild {
  ground: THREE.Mesh;
  water: THREE.Mesh;
  objects: THREE.Object3D[];
  sampleHeight(x: number, z: number): number;
  maxLandHeight: number;
  /** anima la superficie del mar; no hace nada bajo reduced-motion. */
  update(elapsedMs: number): void;
  dispose(): void;
}

const PLANE_W = 234;
const PLANE_D = 166;
const SEG_W = 204;
const SEG_D = 146;
const SIGMA = 8;        // radio gaussiano de influencia por provincia
const PEAK = 9;         // contribución de altura por provincia (elevation × PEAK)
const MAX_H = 7;        // saturación de la tierra (~montañas)
const LAND_BASE = 0.55; // suelo mínimo de tierra firme sobre el nivel del mar
const SEABED = -3.6;    // fondo marino más profundo
export const WATER_Y = 0;

interface Wave { ax: number; az: number; ph: number; amp: number }

function makeNoise(seed: number, freqs: number[], baseAmp: number, decay = 0.5): (x: number, z: number) => number {
  const r = visualRng(seed);
  const waves: Wave[] = [];
  let amp = baseAmp;
  for (const f of freqs) {
    const ang = r.next() * Math.PI * 2;
    waves.push({ ax: Math.cos(ang) * f, az: Math.sin(ang) * f, ph: r.next() * Math.PI * 2, amp });
    amp *= decay;
  }
  return (x, z) => {
    let n = 0;
    for (const w of waves) n += w.amp * Math.sin(w.ax * x + w.az * z + w.ph);
    return n;
  };
}

/** textura canvas del mar: degradado de profundidad + moteado tenue, teselable. */
function makeSeaTexture(): HTMLCanvasElement {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  const shallow = new THREE.Color(ART.seaShallow);
  const deep = new THREE.Color(ART.seaDeep);
  const base = deep.clone().lerp(shallow, 0.42);
  ctx.fillStyle = `rgb(${(base.r * 255) | 0},${(base.g * 255) | 0},${(base.b * 255) | 0})`;
  ctx.fillRect(0, 0, S, S);

  const r = visualRng(0x5ea0);
  // moteado suave de olas: manchas grandes ligeramente más claras
  for (let i = 0; i < 60; i++) {
    const x = r.next() * S;
    const y = r.next() * S;
    const rad = 26 + r.next() * 60;
    const t = 0.28 + r.next() * 0.28;
    const c = deep.clone().lerp(shallow, t);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},0.5)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return canvas;
}

export function buildTerrain(provinces: Province[], seed: number, field: LandField): TerrainBuild {
  const heightDetail = makeNoise(seed ^ 0x2222, [0.06, 0.13, 0.27, 0.5], 0.34);
  const colorNoise = makeNoise(seed ^ 0x3333, [0.09, 0.19, 0.4], 0.5);
  const duneNoise = makeNoise(seed ^ 0x4444, [0.55], 1.0);

  const centers = provinces.map((p) => ({
    x: p.center[0],
    z: p.center[1],
    e: p.elevation,
    terrain: p.terrain,
    north: LandField.isNorth(p.center),
  }));
  const fallbackTerrain: Terrain = provinces.length ? provinces[0].terrain : 'plains';

  const reliefRaw = (x: number, z: number): number => {
    let sum = 0;
    for (const c of centers) {
      const dx = x - c.x;
      const dz = z - c.z;
      sum += c.e * PEAK * Math.exp(-(dx * dx + dz * dz) / (2 * SIGMA * SIGMA));
    }
    return MAX_H * (1 - Math.exp(-sum / MAX_H)); // saturación suave hacia MAX_H
  };

  const sampleHeight = (x: number, z: number): number => {
    const mask = field.landMask(x, z);
    const relief = reliefRaw(x, z);
    const islet = field.isletPeak(x, z);
    const landH = LAND_BASE + relief + islet + heightDetail(x, z) * mask;
    return SEABED + (landH - SEABED) * mask;
  };

  const nearest = (x: number, z: number): { terrain: Terrain; north: boolean } => {
    let best = Infinity;
    let terrain = fallbackTerrain;
    let north = false;
    for (const c of centers) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        terrain = c.terrain;
        north = c.north;
      }
    }
    return { terrain, north };
  };

  // ----- geometría del suelo -----
  const geo = new THREE.PlaneGeometry(PLANE_W, PLANE_D, SEG_W, SEG_D);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const snow = new THREE.Color(ART.snow);
  const foam = new THREE.Color(ART.foam);
  const shore = new THREE.Color(ART.shore);
  const seaShallow = new THREE.Color(ART.seaShallow);
  const seaDeep = new THREE.Color(ART.seaDeep);
  const tmp = new THREE.Color();
  let maxLandHeight = 0;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = sampleHeight(x, z);
    pos.setY(i, h);
    if (h > maxLandHeight) maxLandHeight = h;

    const mask = field.landMask(x, z);
    const { terrain, north } = nearest(x, z);

    // color de tierra
    tmp.set(TERRAIN_COLORS[terrain]);
    const cn = colorNoise(x, z); // ~[-0.6,0.6]
    tmp.multiplyScalar(0.86 + (cn + 0.6) * 0.22);

    if (terrain === 'desert') {
      const band = 0.5 + 0.5 * Math.sin(duneNoise(x, z) * 3.1);
      tmp.multiplyScalar(0.9 + band * 0.16); // dunas: bandas de brillo
    }
    if (terrain === 'swamp') tmp.lerp(seaDeep, 0.12); // tono húmedo/apagado
    // nieve: cumbres y todo el norte
    const snowT = Math.min(0.75, Math.max(0, (h - 4.2) / 2.6)) + (north ? 0.28 : 0);
    if (snowT > 0) tmp.lerp(snow, Math.min(0.8, snowT));

    // filo de costa: playa cálida + espuma justo en la orilla
    if (h > 0.02 && h < 1.3) {
      const beach = 1 - Math.min(1, Math.abs(h - 0.5) / 0.7);
      tmp.lerp(shore, beach * 0.55);
      if (h < 0.62) tmp.lerp(foam, (1 - h / 0.62) * 0.62); // filo luminoso de espuma
    }

    // color de mar por profundidad (bajo el agua)
    const depth = Math.min(1, Math.max(0, -h / 3.4));
    const seaCol = seaShallow.clone().lerp(seaDeep, depth);

    // fundido tierra <-> mar con la máscara (transición nítida en la orilla)
    let landW = mask;
    landW = landW * landW * (3 - 2 * landW);
    tmp.lerp(seaCol, 1 - landW);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.name = 'terrain-ground';
  ground.renderOrder = 0;

  // ----- plano de mar translúcido -----
  const seaCanvas = makeSeaTexture();
  const seaTex = new THREE.CanvasTexture(seaCanvas);
  seaTex.colorSpace = THREE.SRGBColorSpace;
  seaTex.wrapS = THREE.RepeatWrapping;
  seaTex.wrapT = THREE.RepeatWrapping;
  seaTex.repeat.set(3.5, 2.4);
  const waterGeo = new THREE.PlaneGeometry(PLANE_W * 1.6, PLANE_D * 1.6);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshBasicMaterial({
    map: seaTex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'terrain-water';
  water.position.y = WATER_Y;
  water.renderOrder = 0;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    ground,
    water,
    objects: [ground, water],
    sampleHeight,
    maxLandHeight,
    update(elapsedMs: number): void {
      if (reducedMotion) return;
      const t = elapsedMs * 0.0000075; // deriva muy lenta
      seaTex.offset.set(t % 1, (t * 0.6) % 1);
    },
    dispose(): void {
      geo.dispose();
      groundMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      seaTex.dispose();
    },
  };
}
