/**
 * Terreno del mapa estratégico: PlaneGeometry con relieve procedural derivado
 * de la elevación de las provincias, coloreado por vértice según el terreno de
 * la provincia más cercana, con caída suave al mar en los bordes.
 *
 * El mundo de juego ocupa x ∈ [-80,80], z ∈ [-50,50]; el plano es algo mayor
 * (175 × 112) para dejar un margen de mar alrededor.
 */
import * as THREE from 'three';
import type { Province, Terrain } from '../../core/types';
import { visualRng } from '../../core/state/rng';
import { TERRAIN_COLORS, ART } from './palette';

export interface TerrainBuild {
  mesh: THREE.Mesh;
  /** altura del terreno en coordenadas de mundo (x, z); pura y determinista. */
  sampleHeight(x: number, z: number): number;
  dispose(): void;
}

const PLANE_W = 175;
const PLANE_D = 112;
const SEG_W = 120;
const SEG_D = 76;
const GAME_HALF_X = 80;
const GAME_HALF_Z = 50;
const SIGMA = 8;            // radio gaussiano de influencia por provincia
const PEAK = 9;            // contribución de altura por provincia (elevation × PEAK)
const MAX_H = 7;           // saturación de la tierra (~montañas)
const SEA_Y = -2;          // fondo marino
const SEA_FALLOFF = 8;     // ancho de la banda de costa fuera del rectángulo de juego

interface Wave { ax: number; az: number; ph: number; amp: number }

/** ruido suave y determinista (suma de senos con fase sembrada). */
function makeNoise(seed: number): (x: number, z: number) => number {
  const r = visualRng(seed ^ 0x1111);
  const waves: Wave[] = [];
  let amp = 0.35;
  for (const f of [0.05, 0.09, 0.17, 0.28]) {
    const ang = r.next() * Math.PI * 2;
    waves.push({ ax: Math.cos(ang) * f, az: Math.sin(ang) * f, ph: r.next() * Math.PI * 2, amp });
    amp *= 0.5;
  }
  return (x, z) => {
    let n = 0;
    for (const w of waves) n += w.amp * Math.sin(w.ax * x + w.az * z + w.ph);
    return n;
  };
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function buildTerrain(provinces: Province[], seed: number): TerrainBuild {
  const noise = makeNoise(seed);
  const centers = provinces.map((p) => ({
    x: p.center[0],
    z: p.center[1],
    e: p.elevation,
    terrain: p.terrain,
  }));
  const fallbackTerrain: Terrain = provinces.length ? provinces[0].terrain : 'plains';

  const rawHeight = (x: number, z: number): number => {
    let sum = 0;
    for (const c of centers) {
      const dx = x - c.x;
      const dz = z - c.z;
      sum += c.e * PEAK * Math.exp(-(dx * dx + dz * dz) / (2 * SIGMA * SIGMA));
    }
    // saturación suave: crece ~lineal en valores bajos, se aplana cerca de MAX_H.
    return MAX_H * (1 - Math.exp(-sum / MAX_H));
  };

  const seaBlend = (x: number, z: number): number => {
    const ex = Math.max(0, Math.abs(x) - GAME_HALF_X);
    const ez = Math.max(0, Math.abs(z) - GAME_HALF_Z);
    return smoothstep(Math.hypot(ex, ez) / SEA_FALLOFF);
  };

  const sampleHeight = (x: number, z: number): number => {
    const t = seaBlend(x, z);
    const land = rawHeight(x, z) + noise(x, z) * (1 - t);
    return land * (1 - t) + SEA_Y * t;
  };

  const nearestTerrain = (x: number, z: number): Terrain => {
    let best = Infinity;
    let terrain = fallbackTerrain;
    for (const c of centers) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        terrain = c.terrain;
      }
    }
    return terrain;
  };

  const geo = new THREE.PlaneGeometry(PLANE_W, PLANE_D, SEG_W, SEG_D);
  geo.rotateX(-Math.PI / 2); // al plano horizontal; +Y local → -Z de mundo

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const jit = visualRng(seed ^ 0x2222);
  const seaColor = new THREE.Color(ART.sea);
  const snowColor = new THREE.Color(ART.snow);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = sampleHeight(x, z);
    pos.setY(i, h);

    const t = seaBlend(x, z);
    const terrain = nearestTerrain(x, z);
    tmp.set(TERRAIN_COLORS[terrain]);
    if (terrain === 'mountain') {
      tmp.lerp(snowColor, Math.min(0.6, Math.max(0, (h - 4) / 3)));
    }
    tmp.multiplyScalar(0.9 + jit.next() * 0.18); // jitter de brillo determinista
    tmp.lerp(seaColor, t);                       // fundido a mar en la costa

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';

  return {
    mesh,
    sampleHeight,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
