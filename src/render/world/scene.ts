/**
 * WorldScene — escena Three.js del mapa estratégico 3D (GDD §4.1).
 * Dirección de arte "mapa político sobre mesa de guerra": un CONTINENTE de silueta
 * real sobre mar profundo, relieve con bosques/rocas/nieve, CASTILLOS low-poly como
 * sedes de poder, bordes de reino que hablan (color del dueño, halo del jugador,
 * pulso de guerra), rótulos de región/provincia con LOD y flechas de ruta.
 *
 * Frontera de módulos: solo importa `three`, el contrato de tipos del core y el
 * RNG visual (vía submódulos del renderer). Nunca importa UI ni sistemas del core.
 *
 * API PÚBLICA ESTABLE (main.ts + minimapa dependen de ella): constructor,
 * onSelect, setState, refresh, focusProvince, setMoveTargets, setSelected, dispose.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  GameState, Province, ProvinceId, ArmyId, FactionId, Selection, WorldBridge,
} from '../../core/types';
import { buildTerrain, type TerrainBuild } from './terrain';
import { LandField } from './landfield';
import { ProvinceOverlay, type NeighborCenter } from './overlays';
import { buildFlora, type FloraBuild } from './flora';
import { buildCastles, type CastleBuild } from './castles';
import { LabelLayer } from './labels';
import { buildArmyMarker, type ArmyMarker } from './armyMarker';
import { buildRoutes, type RoutesBuild, type RouteTarget } from './routes';
import { makeShieldCanvas, abbrevMen } from './heraldry';
import { ART } from './palette';

const SHIELD_W: Record<1 | 2 | 3 | 4, number> = { 1: 1.7, 2: 2.0, 3: 2.4, 4: 3.0 };
const SHIELD_ASPECT = 320 / 256;
const CLICK_SLOP = 6;
/** distancia de cámara por encima de la cual se ocultan castillos/flora (LOD). */
const DETAIL_MAX_DIST = 140;

interface ArmyRecord { marker: ArmyMarker; texKey: string; provinceId: ProvinceId }
interface FocusTween { fromX: number; fromZ: number; toX: number; toZ: number; start: number; dur: number }

export class WorldScene implements WorldBridge {
  onSelect: ((sel: Selection) => void) | null = null;

  private readonly container: HTMLElement;
  private state: GameState;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly maxAniso: number;
  private readonly reducedMotion: boolean;

  private field: LandField | null = null;
  private terrain: TerrainBuild | null = null;
  private flora: FloraBuild | null = null;
  private castles: CastleBuild | null = null;
  private labels: LabelLayer | null = null;
  private routes: RoutesBuild | null = null;
  private sampleHeight: (x: number, z: number) => number = () => 0;

  private readonly overlays = new Map<ProvinceId, ProvinceOverlay>();
  private fillMeshes: THREE.Mesh[] = [];
  private readonly shieldSprites = new Map<ProvinceId, THREE.Sprite>();
  private readonly shieldSig = new Map<ProvinceId, string>();
  private readonly armies = new Map<ArmyId, ArmyRecord>();
  private armyPickables: THREE.Object3D[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly provinceById = new Map<ProvinceId, Province>();

  private hoveredId: ProvinceId | null = null;
  private selectedProvinceId: ProvinceId | null = null;
  private selectedArmyId: ArmyId | null = null;
  private readonly moveTargetIds = new Set<ProvinceId>();
  private detailVisible = true;

  private focusTween: FocusTween | null = null;
  private downPos: { x: number; y: number } | null = null;
  private raf = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, state: GameState) {
    this.container = container;
    this.state = state;
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(ART.background);
    this.scene.fog = new THREE.Fog(ART.background, 155, 400);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 700);
    this.camera.position.set(0, 96, 84);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(new THREE.Color(ART.ambient), 0.82);
    const sun = new THREE.DirectionalLight(new THREE.Color(ART.sun), 1.05);
    sun.position.set(-70, 96, -46);
    const seaFill = new THREE.DirectionalLight(new THREE.Color('#2b3a44'), 0.35);
    seaFill.position.set(60, 40, 70);
    this.scene.add(ambient, sun, seaFill);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 175;
    this.controls.minPolarAngle = 0.22;
    this.controls.maxPolarAngle = 1.28;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', this.cancelFocus);

    this.buildMap();
    this.refresh();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(container);

    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------------------------------------------------------------- API pública

  setState(s: GameState): void {
    const seedChanged = s.seed !== this.state.seed;
    this.state = s;
    if (seedChanged) this.buildMap();
    this.refresh();
  }

  refresh(): void {
    this.rebuildBorders();
    this.castles?.update(this.state, this.sampleHeight, (k, m) => this.texture(k, m));
    this.refreshShields();
    this.refreshArmies();
    this.rebuildRoutes();
  }

  focusProvince(id: ProvinceId): void {
    const p = this.provinceById.get(id);
    if (!p) return;
    this.focusTween = {
      fromX: this.controls.target.x,
      fromZ: this.controls.target.z,
      toX: p.center[0],
      toZ: p.center[1],
      start: performance.now(),
      dur: 600,
    };
  }

  setMoveTargets(ids: ProvinceId[] | null): void {
    for (const id of this.moveTargetIds) {
      const ov = this.overlays.get(id);
      if (ov) ov.moveTarget = false;
    }
    this.moveTargetIds.clear();
    if (ids) {
      for (const id of ids) {
        const ov = this.overlays.get(id);
        if (ov) { ov.moveTarget = true; this.moveTargetIds.add(id); }
      }
    }
    this.rebuildRoutes();
  }

  setSelected(sel: Selection): void {
    if (this.selectedProvinceId !== null) {
      const prev = this.overlays.get(this.selectedProvinceId);
      if (prev) prev.selected = false;
    }
    this.selectedProvinceId = null;
    if (this.selectedArmyId !== null) this.armies.get(this.selectedArmyId)?.marker.setSelected(false);
    this.selectedArmyId = null;

    if (sel) {
      if (sel.kind === 'province') {
        const ov = this.overlays.get(sel.id);
        if (ov) { ov.selected = true; this.selectedProvinceId = sel.id; }
      } else {
        this.selectedArmyId = sel.id;
        this.armies.get(sel.id)?.marker.setSelected(true);
      }
    }
    this.rebuildRoutes();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.removeEventListener('start', this.cancelFocus);
    this.controls.dispose();

    this.clearMap();
    for (const tex of this.textureCache.values()) tex.dispose();
    this.textureCache.clear();

    this.scene.clear();
    this.renderer.dispose();
    if (canvas.parentNode === this.container) this.container.removeChild(canvas);
  }

  // ---------------------------------------------------------------- construcción

  private buildMap(): void {
    this.clearMap();

    this.field = new LandField(this.state.provinces, this.state.seed);
    this.terrain = buildTerrain(this.state.provinces, this.state.seed, this.field);
    this.sampleHeight = this.terrain.sampleHeight;
    for (const o of this.terrain.objects) this.scene.add(o);

    for (const p of this.state.provinces) this.provinceById.set(p.id, p);

    // overlays (con centros de vecinos para detectar aristas exteriores de reino)
    const centerById = new Map<ProvinceId, [number, number]>();
    for (const p of this.state.provinces) centerById.set(p.id, p.center);
    for (const p of this.state.provinces) {
      const ch = this.sampleHeight(p.center[0], p.center[1]);
      const neighbors: NeighborCenter[] = [];
      for (const nid of p.neighbors) {
        const c = centerById.get(nid);
        if (c) neighbors.push({ id: nid, center: c });
      }
      const ov = new ProvinceOverlay(p, ch, this.ownerColor(p), neighbors);
      this.overlays.set(p.id, ov);
      for (const obj of ov.objects) this.scene.add(obj);
      this.fillMeshes.push(ov.fill);
    }

    this.flora = buildFlora(this.state.provinces, this.field, this.sampleHeight, this.state.seed);
    this.scene.add(this.flora.group);

    this.castles = buildCastles();
    this.scene.add(this.castles.group);

    this.labels = new LabelLayer(this.state.provinces, this.sampleHeight, this.terrain.maxLandHeight, this.maxAniso);
    this.scene.add(this.labels.group);
  }

  private clearMap(): void {
    if (this.terrain) {
      for (const o of this.terrain.objects) this.scene.remove(o);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.flora) { this.scene.remove(this.flora.group); this.flora.dispose(); this.flora = null; }
    if (this.castles) { this.scene.remove(this.castles.group); this.castles.dispose(); this.castles = null; }
    if (this.labels) { this.scene.remove(this.labels.group); this.labels.dispose(); this.labels = null; }
    if (this.routes) { this.scene.remove(this.routes.group); this.routes.dispose(); this.routes = null; }
    this.field = null;

    for (const ov of this.overlays.values()) {
      for (const obj of ov.objects) this.scene.remove(obj);
      ov.dispose();
    }
    this.overlays.clear();
    this.fillMeshes = [];

    for (const s of this.shieldSprites.values()) this.disposeSprite(s);
    this.shieldSprites.clear();
    this.shieldSig.clear();

    for (const rec of this.armies.values()) { this.scene.remove(rec.marker.group); rec.marker.dispose(); }
    this.armies.clear();
    this.armyPickables = [];

    this.provinceById.clear();
    this.hoveredId = null;
    this.selectedProvinceId = null;
    this.selectedArmyId = null;
    this.moveTargetIds.clear();
  }

  // ---------------------------------------------------------------- refresh

  /** facciones actualmente en guerra con el jugador. */
  private enemyFactions(): Set<FactionId> {
    const player = this.state.playerFactionId;
    const enemies = new Set<FactionId>();
    for (const w of this.state.wars) {
      if (w.attackerId === player) enemies.add(w.defenderId);
      else if (w.defenderId === player) enemies.add(w.attackerId);
    }
    return enemies;
  }

  private rebuildBorders(): void {
    const player = this.state.playerFactionId;
    const enemies = this.enemyFactions();
    const ownerOf = (id: ProvinceId): FactionId | null => this.provinceById.get(id)?.ownerId ?? null;
    for (const p of this.state.provinces) {
      const ov = this.overlays.get(p.id);
      if (!ov) continue;
      ov.rebuild({
        ownerHex: this.ownerColor(p),
        selfOwner: p.ownerId,
        isPlayer: p.ownerId === player,
        isEnemyAtWar: p.ownerId !== null && enemies.has(p.ownerId),
        ownerOf,
      });
    }
  }

  private refreshShields(): void {
    for (const p of this.state.provinces) {
      const faction = p.ownerId ? this.state.factions[p.ownerId] : undefined;
      const st = p.settlement;
      const sig = faction ? `own:${p.ownerId}:${st.level}:${st.fortLevel}` : 'neutral';
      const prev = this.shieldSprites.get(p.id);

      if (!faction) {
        if (prev) { this.disposeSprite(prev); this.shieldSprites.delete(p.id); this.shieldSig.delete(p.id); }
        continue;
      }
      const topY = this.castles?.topY(p.id) ?? this.sampleHeight(p.center[0], p.center[1]) + 6;
      if (this.shieldSig.get(p.id) === sig && prev) {
        prev.position.set(p.center[0], topY, p.center[1]);
        continue;
      }
      if (prev) this.disposeSprite(prev);

      const key = `shield:${p.ownerId}:${st.level}:${st.fortLevel}`;
      const tex = this.texture(key, () =>
        makeShieldCanvas({
          primary: faction.colorPrimary,
          secondary: faction.colorSecondary,
          seed: faction.bannerSeed,
          initial: (faction.dynastyName || faction.name || '?').slice(0, 1),
          level: st.level,
          fortLevel: st.fortLevel,
        }),
      );
      const sw = SHIELD_W[st.level];
      const sprite = this.makeSprite(tex, sw, sw * SHIELD_ASPECT);
      sprite.position.set(p.center[0], topY, p.center[1]);
      sprite.userData.provinceId = p.id;
      this.scene.add(sprite);
      this.shieldSprites.set(p.id, sprite);
      this.shieldSig.set(p.id, sig);
    }
  }

  private refreshArmies(): void {
    const list = Object.values(this.state.armies);

    for (const [id, rec] of this.armies) {
      if (!this.state.armies[id]) { this.scene.remove(rec.marker.group); rec.marker.dispose(); this.armies.delete(id); }
    }

    const byProvince = new Map<ProvinceId, ArmyId[]>();
    for (const a of list) {
      const arr = byProvince.get(a.provinceId);
      if (arr) arr.push(a.id); else byProvince.set(a.provinceId, [a.id]);
    }

    for (const [provinceId, ids] of byProvince) {
      const p = this.provinceById.get(provinceId);
      if (!p) continue;
      const ground = this.sampleHeight(p.center[0], p.center[1]);
      const n = ids.length;
      ids.forEach((id, i) => {
        const army = this.state.armies[id];
        const faction = this.state.factions[army.factionId];
        const primary = faction ? faction.colorPrimary : ART.neutralOwner;
        const men = army.units.reduce((s, u) => s + u.men, 0);
        const menText = abbrevMen(men);
        const texKey = `${army.factionId}:${menText}`;

        let rec = this.armies.get(id);
        if (!rec || rec.texKey !== texKey) {
          if (rec) { this.scene.remove(rec.marker.group); rec.marker.dispose(); }
          const marker = buildArmyMarker(primary, menText, (k, m) => this.texture(k, m), army.factionId);
          for (const pk of marker.pickables) pk.userData.armyId = id;
          this.scene.add(marker.group);
          rec = { marker, texKey, provinceId };
          this.armies.set(id, rec);
        }
        rec.provinceId = provinceId;
        const ox = 6.6 + i * 3.8;
        const oz = (i - (n - 1) / 2) * 3.0;
        rec.marker.group.position.set(p.center[0] + ox, ground, p.center[1] + oz);
        rec.marker.setSelected(this.selectedArmyId === id);
      });
    }

    this.armyPickables = [];
    for (const rec of this.armies.values()) for (const pk of rec.marker.pickables) this.armyPickables.push(pk);
  }

  private rebuildRoutes(): void {
    if (this.routes) { this.scene.remove(this.routes.group); this.routes.dispose(); this.routes = null; }
    if (this.selectedArmyId === null || this.moveTargetIds.size === 0) return;
    const army = this.state.armies[this.selectedArmyId];
    if (!army) return;
    const from = this.provinceById.get(army.provinceId);
    if (!from) return;
    const enemies = this.enemyFactions();
    const targets: RouteTarget[] = [];
    for (const id of this.moveTargetIds) {
      const tp = this.provinceById.get(id);
      if (!tp) continue;
      const contested =
        tp.ownerId !== army.factionId &&
        (tp.ownerId === null || tp.ownerId !== this.state.playerFactionId || enemies.has(tp.ownerId));
      targets.push({ x: tp.center[0], z: tp.center[1], hostile: contested });
    }
    const baseY = (this.terrain?.maxLandHeight ?? 6) + 2.5;
    this.routes = buildRoutes({ x: from.center[0], z: from.center[1] }, targets, baseY);
    this.scene.add(this.routes.group);
  }

  // ---------------------------------------------------------------- helpers

  private ownerColor(p: Province): string {
    if (p.ownerId) {
      const f = this.state.factions[p.ownerId];
      if (f) return f.colorPrimary;
    }
    return ART.neutralOwner;
  }

  private texture(key: string, make: () => HTMLCanvasElement): THREE.CanvasTexture {
    let t = this.textureCache.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(make());
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.maxAniso;
      t.needsUpdate = true;
      this.textureCache.set(key, t);
    }
    return t;
  }

  private makeSprite(tex: THREE.Texture, w: number, h: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, h, 1);
    return sprite;
  }

  private disposeSprite(sprite: THREE.Sprite): void {
    this.scene.remove(sprite);
    sprite.material.dispose();
  }

  // ---------------------------------------------------------------- bucle / resize

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (this.focusTween) this.stepFocus(now);
    this.controls.update();

    const camDist = this.camera.position.distanceTo(this.controls.target);
    const wantDetail = camDist < DETAIL_MAX_DIST;
    if (wantDetail !== this.detailVisible) {
      this.detailVisible = wantDetail;
      this.flora?.setDetailVisible(wantDetail);
      this.castles?.setDetailVisible(wantDetail);
    }
    this.labels?.update(camDist);
    this.terrain?.update(now);

    const pulse = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.0022);
    for (const ov of this.overlays.values()) ov.apply(pulse);

    this.renderer.render(this.scene, this.camera);
  };

  private stepFocus(now: number): void {
    const f = this.focusTween;
    if (!f) return;
    const raw = Math.min(1, (now - f.start) / f.dur);
    const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    this.controls.target.x = f.fromX + (f.toX - f.fromX) * e;
    this.controls.target.z = f.fromZ + (f.toZ - f.fromZ) * e;
    if (raw >= 1) this.focusTween = null;
  }

  private readonly cancelFocus = (): void => { this.focusTween = null; };

  private readonly onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  // ---------------------------------------------------------------- picking

  private updateRay(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(
      ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private hitArmy(): ArmyId | null {
    const hits = this.raycaster.intersectObjects(this.armyPickables, false);
    for (const h of hits) {
      const id = h.object.userData.armyId;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  private hitProvince(): ProvinceId | null {
    const hits = this.raycaster.intersectObjects(this.fillMeshes, false);
    for (const h of hits) {
      const id = h.object.userData.provinceId;
      if (typeof id === 'number') return id;
    }
    return null;
  }

  private setHover(id: ProvinceId | null): void {
    if (this.hoveredId === id) return;
    if (this.hoveredId !== null) {
      const prev = this.overlays.get(this.hoveredId);
      if (prev) prev.hover = false;
    }
    this.hoveredId = id;
    if (id !== null) {
      const ov = this.overlays.get(id);
      if (ov) ov.hover = true;
    }
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    this.downPos = { x: ev.clientX, y: ev.clientY };
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const down = this.downPos;
    this.downPos = null;
    if (!down) return;
    if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) >= CLICK_SLOP) return;
    if (!this.onSelect) return;
    this.updateRay(ev);
    const army = this.hitArmy();
    if (army !== null) { this.onSelect({ kind: 'army', id: army }); return; }
    const province = this.hitProvince();
    this.onSelect(province !== null ? { kind: 'province', id: province } : null);
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    this.updateRay(ev);
    const army = this.hitArmy();
    const province = army !== null ? null : this.hitProvince();
    this.renderer.domElement.style.cursor = army !== null || province !== null ? 'pointer' : '';
    this.setHover(province);
  };

  private readonly onPointerLeave = (): void => {
    this.setHover(null);
    this.renderer.domElement.style.cursor = '';
  };
}
