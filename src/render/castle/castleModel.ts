/**
 * Modelo procedural de la SEDE DE PODER: un castillo low-poly digno como
 * protagonista sobre una colina suave, con muralla almenada y puerta con arco,
 * torres cilíndricas de techo cónico en el color de la casa, torreón de dos
 * cuerpos con ventanas emisivas cálidas, estandartes heráldicos, caserío,
 * camino de tierra, arbolado instanciado y partículas de estación (pájaros /
 * copos). Todo geometría de Three + canvas + instancing; CERO assets externos.
 *
 * Determinista: la aleatoriedad de sembrado sale de visualRng (nunca
 * Math.random). El tiempo de animación (performance.now) es puramente visual.
 *
 * Frontera de módulos: importa `three`, el contrato de tipos del core, el RNG
 * visual, la paleta del mundo (ART) y la heráldica (read-only). No toca la UI
 * ni los sistemas del core.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Season, Terrain } from '../../core/types';
import { visualRng } from '../../core/state/rng';
import { ART, darken, lighten } from '../world/palette';
import { makeBannerCanvas } from '../world/heraldry';

export type HotspotKey = 'trono' | 'cuartel' | 'tesoreria' | 'cronica' | 'salir';

export interface CastleModel {
  group: THREE.Group;
  /** puntos de anclaje (mundo) para los hotspots proyectados a pantalla. */
  anchors: Record<HotspotKey, THREE.Vector3>;
  /** color de fondo/niebla recomendado para la escena, según estación. */
  skyColor: THREE.Color;
  update(elapsedMs: number, reducedMotion: boolean): void;
  dispose(): void;
}

export interface CastleModelOpts {
  colorPrimary: string;
  colorSecondary: string;
  bannerSeed: number;
  initial: string;
  season: Season;
  terrain: Terrain;
  seed: number;
  reducedMotion: boolean;
}

// ---------- geometría: acumulador de piezas con color horneado por vértice ----------

class Kit {
  readonly parts: THREE.BufferGeometry[] = [];

  private bake(geo: THREE.BufferGeometry, col: THREE.Color): void {
    geo.deleteAttribute('uv');
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(geo);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, col: THREE.Color, ry = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.bake(g, col);
  }

  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, col: THREE.Color, seg = 10): void {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    this.bake(g, col);
  }

  cone(r: number, h: number, x: number, y: number, z: number, col: THREE.Color, seg = 10, ry = 0): void {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.bake(g, col);
  }

  /** disco vertical (cara hacia +z) para insinuar el arco oscuro de una puerta. */
  disc(r: number, x: number, y: number, z: number, col: THREE.Color, seg = 16): void {
    const g = new THREE.CircleGeometry(r, seg);
    g.translate(x, y, z);
    this.bake(g, col);
  }

  /** merlones repartidos por el perímetro de un anillo cuadrado (media hs). */
  merlonsRing(hs: number, y: number, per: number, size: number, col: THREE.Color): void {
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < per; i++) {
        const t = (i + 0.5) / per;
        const p = -hs + t * (hs * 2);
        let x = 0;
        let z = 0;
        if (s === 0) { x = p; z = -hs; }
        else if (s === 1) { x = p; z = hs; }
        else if (s === 2) { x = -hs; z = p; }
        else { x = hs; z = p; }
        this.box(size, size * 1.25, size, x, y, z, col);
      }
    }
  }

  /** fila de merlones a lo largo del eje x (para coronar la caseta de la puerta). */
  merlonsRow(cx: number, y: number, z: number, width: number, size: number, col: THREE.Color): void {
    const per = Math.max(2, Math.round(width / (size * 2)));
    for (let i = 0; i < per; i++) {
      const t = (i + 0.5) / per;
      const x = cx - width / 2 + t * width;
      this.box(size, size * 1.25, size, x, y, z, col);
    }
  }

  /** casita de aldea: muros + tejado piramidal. */
  house(w: number, h: number, d: number, x: number, y: number, z: number, wall: THREE.Color, roof: THREE.Color, ry = 0): void {
    this.box(w, h, d, x, y, z, wall, ry);
    this.cone(Math.max(w, d) * 0.72, h * 0.9, x, y + h, z, roof, 4, ry + Math.PI / 4);
  }

  /** torre redonda con tejado cónico del color de la casa. */
  tower(r: number, h: number, x: number, y: number, z: number, wall: THREE.Color, roof: THREE.Color, roofH: number): void {
    this.cyl(r, r * 1.06, h, x, y, z, wall, 12);
    this.merlonRingRound(r * 1.02, y + h, 10, r * 0.34, wall);
    this.cone(r * 1.34, roofH, x, y + h + r * 0.34 * 1.25, z, roof, 12);
  }

  /** merlones en anillo circular (para coronar torres). */
  private merlonRingRound(r: number, y: number, count: number, size: number, col: THREE.Color): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.box(size, size * 1.2, size, Math.cos(a) * r, y, Math.sin(a) * r, col);
    }
  }
}

// ---------- colores de estación y terreno ----------

function groundBaseColor(season: Season, terrain: Terrain): THREE.Color {
  // terreno árido / rocoso domina sobre la hierba estacional
  if (terrain === 'desert') return new THREE.Color('#b19e6b');
  if (terrain === 'steppe') return new THREE.Color('#a39262');
  if (terrain === 'mountain') return new THREE.Color('#8a827a');
  if (terrain === 'swamp') return new THREE.Color('#5b6450');
  // hierba por estación
  switch (season) {
    case 0: return new THREE.Color('#586b38'); // primavera
    case 1: return new THREE.Color('#63702f'); // verano
    case 2: return new THREE.Color('#8a7638'); // otoño
    default: return new THREE.Color('#dfe0d4'); // invierno (base nívea)
  }
}

function treeColor(season: Season, north: boolean, r: () => number): THREE.Color {
  if (season === 3) { // invierno: abetos oscuros con nieve
    const c = new THREE.Color(ART.firNorth).multiplyScalar(0.75 + r() * 0.2);
    return c.lerp(new THREE.Color(ART.snow), 0.22 + r() * 0.16);
  }
  if (season === 2) { // otoño: dorados/cobres
    const c = new THREE.Color('#9a6f2c').multiplyScalar(0.8 + r() * 0.35);
    return c;
  }
  const base = north ? new THREE.Color(ART.firNorth) : new THREE.Color(ART.firTemperate);
  return base.multiplyScalar(0.82 + r() * 0.3);
}

// ---------- ruido determinista simple para el relieve del suelo ----------

function makeNoise(seed: number): (x: number, z: number) => number {
  const r = visualRng(seed);
  const w = [0.09, 0.19, 0.4].map((f) => {
    const ang = r.next() * Math.PI * 2;
    return { ax: Math.cos(ang) * f, az: Math.sin(ang) * f, ph: r.next() * Math.PI * 2 };
  });
  const amps = [0.55, 0.28, 0.14];
  return (x, z) => {
    let n = 0;
    for (let i = 0; i < w.length; i++) n += amps[i] * Math.sin(w[i].ax * x + w[i].az * z + w[i].ph);
    return n;
  };
}

// ---------- disposición (constantes de layout, en unidades de mundo) ----------

const PLATEAU_R = 8.6;   // radio de la meseta plana donde se asienta el castillo
const SLOPE_R = 17;      // radio hasta el que baja la colina
const PLATEAU_H = 1.5;   // altura de la meseta sobre el llano
const GROUND_EXTENT = 34;
const HS = 7.4;          // media anchura de la muralla perimetral
const WALL_H = 3.2;
const WALL_T = 0.9;
const GATE_HALF = 1.85;  // media anchura del vano de la puerta

/** altura del terreno (colina suave) en (x,z). */
function makeGroundHeight(noise: (x: number, z: number) => number): (x: number, z: number) => number {
  return (x, z) => {
    const r = Math.hypot(x, z);
    let mound: number;
    if (r <= PLATEAU_R) mound = PLATEAU_H;
    else if (r >= SLOPE_R) mound = 0;
    else {
      const t = (r - PLATEAU_R) / (SLOPE_R - PLATEAU_R);
      const s = t * t * (3 - 2 * t);
      mound = PLATEAU_H * (1 - s);
    }
    // ondulación sutil solo fuera de la meseta (la meseta queda plana para el castillo)
    const rough = r > PLATEAU_R ? noise(x, z) * 0.35 * Math.min(1, (r - PLATEAU_R) / 3) : 0;
    return mound + rough;
  };
}

/** ¿está (x,z) dentro del corredor del camino que sale por la puerta (+z)? 0..1 */
function roadWeight(x: number, z: number): number {
  if (z < HS - 1) return 0;
  const halfWidth = 1.5;
  const d = Math.abs(x) / halfWidth;
  if (d > 1) return 0;
  const along = Math.min(1, (z - (HS - 1)) / 2); // se desvanece al arrancar en la puerta
  return (1 - d * d) * along;
}

export function buildCastleModel(opts: CastleModelOpts): CastleModel {
  const group = new THREE.Group();
  group.name = 'castle-model';
  const disposables: { dispose(): void }[] = [];

  const rng = visualRng(opts.seed ^ (opts.bannerSeed * 0x9e37) ^ 0xca57);
  const rand = (): number => rng.next();

  const primary = new THREE.Color(opts.colorPrimary);
  const roofCol = darken(opts.colorPrimary, 0.06);
  const stone = new THREE.Color(ART.stone);
  const stoneDark = new THREE.Color(ART.stoneDark);
  const timber = new THREE.Color(ART.timber);
  const dark = darken(ART.stoneDark, 0.55);
  const northish = opts.terrain === 'mountain' || opts.terrain === 'hills' || opts.season === 3;

  const noise = makeNoise(opts.seed ^ 0x2222);
  const groundHeight = makeGroundHeight(noise);
  const y0 = PLATEAU_H; // el castillo se asienta sobre la meseta

  // ============================================================ SUELO / COLINA
  {
    const geo = new THREE.PlaneGeometry(GROUND_EXTENT * 2, GROUND_EXTENT * 2, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = groundBaseColor(opts.season, opts.terrain);
    const snow = new THREE.Color(ART.snow);
    const road = new THREE.Color('#4f3d2a');
    const cNoise = makeNoise(opts.seed ^ 0x3333);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = groundHeight(x, z);
      pos.setY(i, h);
      tmp.copy(base).multiplyScalar(0.86 + (cNoise(x, z) + 0.6) * 0.2);
      if (opts.season === 3) tmp.lerp(snow, 0.55 + rand() * 0.1); // invierno: manto nieve
      const rw = roadWeight(x, z);
      if (rw > 0) tmp.lerp(road, rw * 0.85);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'castle-ground';
    group.add(mesh);
    disposables.push(geo, mat);
  }

  // ============================================================ CASTILLO (kit fusionado)
  const kit = new Kit();

  // -- basamento de piedra bajo el castillo (borde de la meseta) --
  kit.cyl(PLATEAU_R + 0.4, PLATEAU_R + 0.9, PLATEAU_H + 0.2, 0, -0.2, 0, stoneDark, 40);

  // -- muralla perimetral: 3 lienzos completos + frente partido por la puerta --
  // lienzos norte (−z), este (+x), oeste (−x)
  kit.box(HS * 2, WALL_H, WALL_T, 0, y0, -HS, stone);
  kit.box(WALL_T, WALL_H, HS * 2, -HS, y0, 0, stone);
  kit.box(WALL_T, WALL_H, HS * 2, HS, y0, 0, stone);
  // frente (+z) partido a ambos lados del vano
  const frontSeg = (HS - GATE_HALF) / 2;
  kit.box(HS - GATE_HALF, WALL_H, WALL_T, -(GATE_HALF + frontSeg), y0, HS, stone);
  kit.box(HS - GATE_HALF, WALL_H, WALL_T, GATE_HALF + frontSeg, y0, HS, stone);

  // almenas sobre los lienzos (anillo de merlones)
  kit.merlonsRing(HS, y0 + WALL_H, 7, 0.32, stone);

  // -- caseta de la puerta con arco --
  const gateW = GATE_HALF * 2 + 1.2;
  const gateHouseH = WALL_H + 1.7;
  kit.box(gateW, gateHouseH, WALL_T + 0.9, 0, y0, HS, stoneDark);
  kit.merlonsRow(0, y0 + gateHouseH, HS + (WALL_T + 0.9) / 2 - 0.16, gateW, 0.34, stoneDark);
  // vano oscuro (rectángulo + semidisco = arco) en la cara +z
  const zf = HS + (WALL_T + 0.9) / 2 + 0.02;
  kit.box(GATE_HALF * 2, WALL_H * 0.72, 0.12, 0, y0, zf, dark);
  kit.disc(GATE_HALF, 0, y0 + WALL_H * 0.72, zf, dark, 18);

  // -- 6 torres cilíndricas con techo cónico del color de la casa --
  const towerPositions: [number, number][] = [
    [-HS, -HS], [HS, -HS], [-HS, HS], [HS, HS], // esquinas
    [-HS, 0], [HS, 0],                           // medias en muros este/oeste
  ];
  const TOWER_H = 4.6;
  const TOWER_R = 1.15;
  const TOWER_ROOF_H = 2.4;
  for (const [tx, tz] of towerPositions) {
    kit.tower(TOWER_R, TOWER_H, tx, y0, tz, stone, roofCol, TOWER_ROOF_H);
  }
  // remate dorado/emisivo en la punta de cada torre lo hacemos con ventanas (abajo)

  // -- torreón central de dos cuerpos --
  const KEEP_A = 4.4; // lado del cuerpo inferior
  const KEEP_AH = 5.2;
  const KEEP_B = 3.0; // lado del cuerpo superior
  const KEEP_BH = 3.2;
  const KEEP_ROOF_H = 2.7;
  kit.box(KEEP_A, KEEP_AH, KEEP_A, 0, y0, 0, stone);
  kit.merlonsRing(KEEP_A / 2, y0 + KEEP_AH, 4, 0.36, stone);
  kit.box(KEEP_B, KEEP_BH, KEEP_B, 0, y0 + KEEP_AH, 0, lighten(ART.stone, 0.04));
  kit.merlonsRing(KEEP_B / 2, y0 + KEEP_AH + KEEP_BH, 3, 0.32, stone);
  kit.cone(KEEP_B * 0.82, KEEP_ROOF_H, 0, y0 + KEEP_AH + KEEP_BH, 0, roofCol, 4, Math.PI / 4);

  // -- edificio del CUARTEL (nave larga baja, cuadrante izquierdo) --
  kit.box(3.4, 2.0, 4.6, -4.4, y0, 1.6, stone);
  kit.cone(2.6, 1.5, -4.4, y0 + 2.0, 1.6, timber, 4, Math.PI / 4);

  // -- edificio de la TESORERÍA (torreón achaparrado, cuadrante derecho) --
  kit.box(2.8, 3.0, 2.8, 4.4, y0, 1.6, stone);
  kit.merlonsRing(1.4, y0 + 3.0, 3, 0.3, stone);
  kit.cone(1.9, 1.4, 4.4, y0 + 3.0, 1.6, roofCol, 4, Math.PI / 4);

  // -- caserío exterior (6-10 casitas siguiendo el camino, fuera de la muralla) --
  const houseCount = 6 + Math.floor(rand() * 5);
  let placedHouses = 0;
  let attempts = 0;
  while (placedHouses < houseCount && attempts < houseCount * 8) {
    attempts++;
    // franja a ambos lados del camino, en +z fuera de la muralla
    const side = rand() < 0.5 ? -1 : 1;
    const hx = side * (2.6 + rand() * 6.0);
    const hz = HS + 2.5 + rand() * 12;
    if (Math.hypot(hx, hz) < PLATEAU_R + 1) continue;
    const gy = groundHeight(hx, hz);
    const w = 1.1 + rand() * 0.7;
    const h = 0.8 + rand() * 0.4;
    const d = 1.0 + rand() * 0.6;
    kit.house(w, h, d, hx, gy, hz, stone, timber, (rand() - 0.5) * 0.6);
    placedHouses++;
  }

  // -- postes de estandarte (madera) en torreón y puerta --
  const bannerAnchors: { x: number; y: number; z: number }[] = [
    { x: -KEEP_A / 2 - 0.06, y: y0 + 1.6, z: KEEP_A / 2 - 0.4 },
    { x: KEEP_A / 2 + 0.06, y: y0 + 1.6, z: KEEP_A / 2 - 0.4 },
    { x: -GATE_HALF - 0.5, y: y0 + 0.6, z: zf + 0.05 },
    { x: GATE_HALF + 0.5, y: y0 + 0.6, z: zf + 0.05 },
  ];

  // fusiona todo el kit de piedra en UNA malla (vertex colors, un material)
  const stoneMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mergedStone = mergeGeometries(kit.parts, false);
  for (const g of kit.parts) g.dispose();
  if (mergedStone) {
    const mesh = new THREE.Mesh(mergedStone, stoneMat);
    mesh.name = 'castle-stone';
    group.add(mesh);
    disposables.push(mergedStone, stoneMat);
  } else {
    stoneMat.dispose();
  }

  // ============================================================ VENTANAS EMISIVAS
  // (malla aparte, MeshBasicMaterial cálido → resplandor sin luz, "hogar encendido")
  const windowGeos: THREE.BufferGeometry[] = [];
  const addWindow = (x: number, y: number, z: number, w: number, h: number, ry = 0): void => {
    const g = new THREE.BoxGeometry(w, h, 0.12);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    windowGeos.push(g);
  };
  // torreón, cara frontal (+z) del cuerpo inferior: dos filas
  const kf = KEEP_A / 2 + 0.02;
  for (const wy of [y0 + 1.6, y0 + 3.3]) {
    for (const wx of [-1.1, 0, 1.1]) addWindow(wx, wy, kf, 0.42, 0.72);
  }
  // torreón, caras laterales
  for (const wy of [y0 + 2.0, y0 + 3.6]) {
    addWindow(kf, wy, 0, 0.42, 0.72, Math.PI / 2);
    addWindow(-kf, wy, 0, 0.42, 0.72, Math.PI / 2);
  }
  // cuerpo superior del torreón
  addWindow(0, y0 + KEEP_AH + 1.6, KEEP_B / 2 + 0.02, 0.5, 0.8);
  // remate emisivo en cada punta de torre (pequeño farol)
  for (const [tx, tz] of towerPositions) {
    addWindow(tx, y0 + TOWER_H + 0.6, tz + TOWER_R * 0.4, 0.34, 0.5);
  }
  // tesorería y cuartel: un ventanuco cada uno
  addWindow(4.4, y0 + 1.4, 1.6 + 1.42, 0.4, 0.6);
  addWindow(-4.4, y0 + 1.0, 1.6 + 2.32, 0.5, 0.55);

  let windowMat: THREE.MeshBasicMaterial | null = null;
  const windowBaseA = new THREE.Color('#ffc879');
  const windowBaseB = new THREE.Color('#e79a3d');
  if (windowGeos.length) {
    const merged = mergeGeometries(windowGeos, false);
    for (const g of windowGeos) g.dispose();
    if (merged) {
      windowMat = new THREE.MeshBasicMaterial({ color: windowBaseA.clone() });
      const mesh = new THREE.Mesh(merged, windowMat);
      mesh.name = 'castle-windows';
      group.add(mesh);
      disposables.push(merged, windowMat);
    }
  }

  // ============================================================ ESTANDARTES (heráldica)
  const bannerCanvas = makeBannerCanvas({
    primary: opts.colorPrimary,
    secondary: opts.colorSecondary,
    seed: opts.bannerSeed,
    initial: opts.initial,
  });
  const bannerTex = new THREE.CanvasTexture(bannerCanvas);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, side: THREE.DoubleSide });
  const crossbarMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ART.bark) });
  const bannerGeo = new THREE.PlaneGeometry(1.15, 1.75);
  const crossGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.35, 6).rotateZ(Math.PI / 2);
  disposables.push(bannerTex, bannerMat, crossbarMat, bannerGeo, crossGeo);
  for (const a of bannerAnchors) {
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(a.x, a.y + 0.875, a.z);
    const cross = new THREE.Mesh(crossGeo, crossbarMat);
    cross.position.set(a.x, a.y + 1.78, a.z);
    group.add(cross, banner);
  }

  // ============================================================ ARBOLADO INSTANCIADO
  const trees: { x: number; z: number; y: number; s: number; tall: number; rot: number; color: THREE.Color }[] = [];
  {
    const treeCount = 44 + Math.floor(rand() * 22);
    let tPlaced = 0;
    let tAtt = 0;
    while (tPlaced < treeCount && tAtt < treeCount * 8) {
      tAtt++;
      const ang = rand() * Math.PI * 2;
      const rad = PLATEAU_R + 2.5 + rand() * (GROUND_EXTENT - PLATEAU_R - 5);
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      if (roadWeight(x, z) > 0.15) continue;          // no árboles en el camino
      if (z > HS && Math.abs(x) < 8 && z < HS + 15) continue; // deja sitio al caserío
      const y = groundHeight(x, z);
      tPlaced++;
      trees.push({
        x, z, y,
        s: 0.6 + rand() * 0.7,
        tall: northish ? 1.2 + rand() * 0.35 : 0.9 + rand() * 0.35,
        rot: rand() * Math.PI * 2,
        color: treeColor(opts.season, northish, rand),
      });
    }
  }
  if (trees.length) {
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const vScale = new THREE.Vector3();
    const vPos = new THREE.Vector3();

    const coneGeo = new THREE.ConeGeometry(0.9, 2.0, 6);
    coneGeo.translate(0, 1.7, 0);
    const coneMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const foliage = new THREE.InstancedMesh(coneGeo, coneMat, trees.length);
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.19, 0.7, 5);
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
    group.add(trunk, foliage);
    // disponer geometrías/materiales basta; disponer la geo libera sus instance buffers
    disposables.push(coneGeo, coneMat, trunkGeo, trunkMat);
  }

  // ============================================================ PARTÍCULAS DE ESTACIÓN
  // invierno → copos que caen; resto → pájaros que planean. reduced-motion las apaga.
  const SNOW_TOP = 24;
  let particles: THREE.Points | null = null;
  const particleKind: 'snow' | 'birds' = opts.season === 3 ? 'snow' : 'birds';
  // datos base por partícula (posiciones absolutas se recalculan cada frame)
  const pBaseX: number[] = [];
  const pBaseZ: number[] = [];
  const pAlt: number[] = [];    // copos: altura de reaparición; pájaros: altitud
  const pRad: number[] = [];    // pájaros: radio de la órbita
  const pPhase: number[] = [];
  const pSpeed: number[] = [];
  if (!opts.reducedMotion) {
    const isSnow = particleKind === 'snow';
    const count = isSnow ? 240 : 16;
    const arr = new Float32Array(count * 3);
    const pr = visualRng(opts.seed ^ 0x5107);
    for (let i = 0; i < count; i++) {
      if (isSnow) {
        const x = (pr.next() - 0.5) * GROUND_EXTENT * 1.6;
        const z = (pr.next() - 0.5) * GROUND_EXTENT * 1.6;
        const y = 0.5 + pr.next() * SNOW_TOP;
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
        pBaseX.push(x); pBaseZ.push(z); pAlt.push(y); pRad.push(0);
        pPhase.push(pr.next() * Math.PI * 2);
        pSpeed.push(1.1 + pr.next() * 1.4);
      } else {
        const rad = 10 + pr.next() * 16;
        const a = pr.next() * Math.PI * 2;
        const alt = 12 + pr.next() * 7;
        arr[i * 3] = Math.cos(a) * rad; arr[i * 3 + 1] = alt; arr[i * 3 + 2] = Math.sin(a) * rad;
        pBaseX.push(0); pBaseZ.push(0); pAlt.push(alt); pRad.push(rad);
        pPhase.push(a);
        pSpeed.push(0.08 + pr.next() * 0.08);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(isSnow ? '#f4f1e6' : '#2a2622'),
      size: isSnow ? 0.42 : 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: isSnow ? 0.85 : 0.7,
      depthWrite: false,
    });
    particles = new THREE.Points(geo, mat);
    particles.name = 'castle-particles';
    group.add(particles);
    disposables.push(geo, mat);
  }

  // ============================================================ ANCLAJES DE HOTSPOT
  const anchors: Record<HotspotKey, THREE.Vector3> = {
    trono: new THREE.Vector3(0, y0 + KEEP_AH + KEEP_BH + KEEP_ROOF_H * 0.4, 0),
    cuartel: new THREE.Vector3(-4.4, y0 + 3.0, 2.4),
    tesoreria: new THREE.Vector3(4.4, y0 + 3.4, 2.4),
    cronica: new THREE.Vector3(1.4, y0 + gateHouseH + 0.5, HS + 0.9),
    salir: new THREE.Vector3(-1.6, 1.4, HS + 8.5),
  };

  // color de cielo/niebla por estación
  const skyColor = new THREE.Color(opts.season === 3 ? '#2b3138' : '#23201d');

  return {
    group,
    anchors,
    skyColor,
    update(elapsedMs: number, reducedMotion: boolean): void {
      // resplandor cálido MUY sutil de las ventanas (no en reduced-motion)
      if (windowMat && !reducedMotion) {
        const p = 0.5 + 0.5 * Math.sin(elapsedMs * 0.0011);
        windowMat.color.copy(windowBaseA).lerp(windowBaseB, p * 0.35);
      }
      if (!particles || reducedMotion) return;
      const posAttr = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = elapsedMs * 0.001;
      if (particleKind === 'snow') {
        for (let i = 0; i < posAttr.count; i++) {
          let y = pAlt[i] - ((t * pSpeed[i]) % SNOW_TOP);
          if (y < 0.2) y += SNOW_TOP;
          const x = pBaseX[i] + Math.sin(t * 0.5 + pPhase[i]) * 0.6;
          posAttr.setX(i, x);
          posAttr.setY(i, y);
          posAttr.setZ(i, pBaseZ[i]);
        }
      } else {
        for (let i = 0; i < posAttr.count; i++) {
          const rad = pRad[i];
          const a = pPhase[i] + t * pSpeed[i];
          posAttr.setX(i, Math.cos(a) * rad);
          posAttr.setZ(i, Math.sin(a) * rad);
          posAttr.setY(i, pAlt[i] + Math.sin(t * 0.7 + i) * 0.35);
        }
      }
      posAttr.needsUpdate = true;
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
