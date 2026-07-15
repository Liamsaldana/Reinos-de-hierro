/**
 * Castillos 3D low-poly procedurales: sustituyen el sprite de asentamiento por
 * mini-arquitectura de piedra según el nivel (aldea → pueblo → ciudad → capital)
 * con tejados cónicos del color de la casa, almenas y estandarte heráldico. Las
 * tierras sin señor reciben una atalaya gris.
 *
 * Cada castillo es UNA malla fusionada (vertex colors, material compartido) más,
 * si tiene señor, un plano-estandarte con textura heráldica. Se reconstruye solo
 * cuando cambia su firma (dueño/nivel/fortificación).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameState, Province, ProvinceId } from '../../core/types';
import { ART, darken } from './palette';
import { makeBannerCanvas } from './heraldry';

export interface CastleBuild {
  group: THREE.Group;
  /** reconstruye los castillos cuyo estado cambió. */
  update(
    state: GameState,
    sampleHeight: (x: number, z: number) => number,
    texture: (key: string, make: () => HTMLCanvasElement) => THREE.Texture,
  ): void;
  /** altura (mundo) a la que debe flotar el escudo sobre el castillo. */
  topY(id: ProvinceId): number;
  setDetailVisible(v: boolean): void;
  dispose(): void;
}

/** acumulador de piezas de un castillo; cada pieza es una geo con color horneado. */
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

  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, col: THREE.Color, seg = 8): void {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    this.bake(g, col);
  }

  cone(r: number, h: number, x: number, y: number, z: number, col: THREE.Color, seg = 8, ry = 0): void {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.bake(g, col);
  }

  /** almenas: pequeños merlones repartidos por el perímetro de un anillo cuadrado. */
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
        this.box(size, size * 1.2, size, x, y, z, col);
      }
    }
  }

  /** casita: caja de muros + tejado piramidal. */
  house(w: number, h: number, d: number, x: number, y: number, z: number, wall: THREE.Color, roof: THREE.Color, ry = 0): void {
    this.box(w, h, d, x, y, z, wall, ry);
    this.cone(Math.max(w, d) * 0.72, h * 0.85, x, y + h, z, roof, 4, ry + Math.PI / 4);
  }

  /** torre redonda con tejado cónico. */
  tower(r: number, h: number, x: number, y: number, z: number, wall: THREE.Color, roof: THREE.Color, roofH: number): void {
    this.cyl(r, r * 1.08, h, x, y, z, wall, 8);
    this.cone(r * 1.28, roofH, x, y + h, z, roof, 8);
  }
}

function assemble(p: Province, faction: GameState['factions'][string] | undefined): { kit: Kit; topH: number } {
  const kit = new Kit();
  const stone = new THREE.Color(ART.stone);
  const stoneDark = new THREE.Color(ART.stoneDark);
  const timber = new THREE.Color(ART.timber);
  const roof = faction ? darken(faction.colorPrimary, 0.08) : new THREE.Color(ART.greyTower);
  const level = faction ? p.settlement.level : 0;
  const y0 = -0.25;

  if (!faction) {
    // atalaya sin señor
    kit.tower(0.9, 3.0, 0, y0, 0, stone, new THREE.Color(ART.greyTower), 1.2);
    kit.merlonsRing(0.62, y0 + 3.0, 3, 0.28, stone);
    kit.box(0.6, 0.5, 0.6, 0, y0, 0, stoneDark);
    return { kit, topH: y0 + 3.0 + 1.2 };
  }

  switch (level) {
    case 1: { // aldea: 2-3 casitas
      kit.house(1.3, 0.9, 1.1, -0.9, y0, 0.3, stone, timber, 0.2);
      kit.house(1.2, 0.85, 1.0, 0.8, y0, -0.4, stone, timber, -0.3);
      kit.house(1.0, 0.75, 0.9, 0.2, y0, 1.0, stone, roof, 0.1);
      return { kit, topH: y0 + 1.7 };
    }
    case 2: { // pueblo: casitas + torre
      kit.house(1.2, 0.85, 1.0, -1.3, y0, 0.6, stone, timber, 0.15);
      kit.house(1.1, 0.8, 0.95, -0.4, y0, -1.1, stone, timber, -0.2);
      kit.tower(0.85, 2.7, 0.9, y0, 0.2, stone, roof, 1.2);
      kit.merlonsRing(0.5, y0 + 2.7, 3, 0.22, stone);
      return { kit, topH: y0 + 2.7 + 1.2 };
    }
    case 3: { // ciudad: muralla baja + torres
      const hs = 2.4;
      const wh = 1.6;
      const th = 0.5;
      // 4 lienzos de muralla
      kit.box(hs * 2, wh, th, 0, y0, -hs, stone);
      kit.box(hs * 2, wh, th, 0, y0, hs, stone);
      kit.box(th, wh, hs * 2, -hs, y0, 0, stone);
      kit.box(th, wh, hs * 2, hs, y0, 0, stone);
      kit.merlonsRing(hs, y0 + wh, 5, 0.26, stone);
      // torres de esquina
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        kit.tower(0.7, 2.4, sx * hs, y0, sz * hs, stone, roof, 1.0);
      }
      // casas dentro
      kit.house(1.1, 0.8, 0.95, 0, y0, 0.4, stone, timber, 0.2);
      kit.house(0.9, 0.7, 0.85, -0.9, y0, -0.7, stone, timber, -0.2);
      return { kit, topH: y0 + 2.4 + 1.0 };
    }
    default: { // capital: castillo con torreón + 4 torres + estandarte
      const hs = 3.0;
      const wh = 1.9;
      const th = 0.55;
      kit.box(hs * 2, wh, th, 0, y0, -hs, stone);
      kit.box(hs * 2, wh, th, 0, y0, hs, stone);
      kit.box(th, wh, hs * 2, -hs, y0, 0, stone);
      kit.box(th, wh, hs * 2, hs, y0, 0, stone);
      kit.merlonsRing(hs, y0 + wh, 6, 0.3, stone);
      // 4 torres de esquina con tejado cónico de la casa
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        kit.tower(0.85, 3.4, sx * hs, y0, sz * hs, stone, roof, 1.35);
      }
      // caseta de la puerta
      kit.box(1.6, 2.2, 0.7, 0, y0, hs, stoneDark);
      // torreón central
      kit.box(2.0, 4.2, 2.0, 0, y0, 0, stone, Math.PI / 4);
      kit.merlonsRing(1.15, y0 + 4.2, 4, 0.34, stone);
      kit.cone(1.6, 1.5, 0, y0 + 4.2, 0, roof, 4, Math.PI / 4);
      return { kit, topH: y0 + 4.2 + 1.5 };
    }
  }
}

export function buildCastles(): CastleBuild {
  const group = new THREE.Group();
  group.name = 'castles';
  const stoneMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const woodMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ART.bark) });

  interface Entry { node: THREE.Group; sig: string; topH: number; bannerMat: THREE.Material | null; geos: THREE.BufferGeometry[] }
  const entries = new Map<ProvinceId, Entry>();
  const topYById = new Map<ProvinceId, number>();

  function disposeEntry(e: Entry): void {
    for (const g of e.geos) g.dispose();
    if (e.bannerMat) e.bannerMat.dispose();
    group.remove(e.node);
  }

  return {
    group,
    topY(id: ProvinceId): number {
      return topYById.get(id) ?? 6;
    },
    setDetailVisible(v: boolean): void {
      group.visible = v;
    },
    update(state, sampleHeight, texture): void {
      const present = new Set<ProvinceId>();
      for (const p of state.provinces) {
        present.add(p.id);
        const faction = p.ownerId ? state.factions[p.ownerId] : undefined;
        const sig = faction
          ? `own:${p.ownerId}:${p.settlement.level}:${p.settlement.fortLevel}:${faction.bannerSeed}`
          : 'neutral';
        const prev = entries.get(p.id);
        if (prev && prev.sig === sig) continue;
        if (prev) {
          disposeEntry(prev);
          entries.delete(p.id);
        }

        const { kit, topH } = assemble(p, faction);
        const merged = mergeGeometries(kit.parts, false);
        for (const g of kit.parts) g.dispose();
        if (!merged) continue;
        const geos: THREE.BufferGeometry[] = [merged];
        const mesh = new THREE.Mesh(merged, stoneMat);
        const node = new THREE.Group();
        node.add(mesh);

        let bannerMat: THREE.Material | null = null;
        if (faction && p.settlement.level >= 2) {
          const key = `banner:${p.ownerId}:${faction.bannerSeed}`;
          const tex = texture(key, () =>
            makeBannerCanvas({
              primary: faction.colorPrimary,
              secondary: faction.colorSecondary,
              seed: faction.bannerSeed,
              initial: (faction.dynastyName || faction.name || '?').slice(0, 1),
            }),
          );
          bannerMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
          const bw = 1.1;
          const bh = 1.6;
          const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, bh + 0.9, 5);
          const bannerGeo = new THREE.PlaneGeometry(bw, bh);
          geos.push(poleGeo, bannerGeo);
          const banner = new THREE.Mesh(bannerGeo, bannerMat);
          const pole = new THREE.Mesh(poleGeo, woodMat);
          const poleY = topH + 0.6;
          pole.position.set(0.0, poleY, 0.0);
          banner.position.set(bw / 2 + 0.06, poleY + 0.25, 0);
          banner.userData.isBanner = true;
          node.add(pole, banner);
        }

        const ch = sampleHeight(p.center[0], p.center[1]);
        node.position.set(p.center[0], ch, p.center[1]);
        node.userData.provinceId = p.id;
        group.add(node);

        const shieldTop = ch + topH + 1.4;
        topYById.set(p.id, shieldTop);
        entries.set(p.id, { node, sig, topH, bannerMat, geos });
      }

      for (const [id, e] of entries) {
        if (!present.has(id)) {
          disposeEntry(e);
          entries.delete(id);
          topYById.delete(id);
        }
      }
    },
    dispose(): void {
      for (const e of entries.values()) disposeEntry(e);
      entries.clear();
      topYById.clear();
      stoneMat.dispose();
      woodMat.dispose();
      group.clear();
    },
  };
}
