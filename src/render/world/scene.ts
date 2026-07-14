/**
 * WorldScene — escena Three.js del mapa estratégico 3D (GDD §4.1).
 * Dirección de arte "cartografía antigua sobre mesa de guerra": terreno con
 * relieve, capa política de provincias, estandartes heráldicos y gallardetes de
 * ejército como billboards. Lee GameState (solo lectura) y emite selección.
 *
 * Frontera de módulos: este archivo solo importa `three`, el contrato de tipos
 * del core y el RNG visual. Nunca importa UI ni sistemas del core.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  GameState,
  Province,
  ProvinceId,
  ArmyId,
  Selection,
  WorldBridge,
} from '../../core/types';
import { buildTerrain, type TerrainBuild } from './terrain';
import { ProvinceOverlay } from './overlays';
import { makeShieldCanvas, makeMojonCanvas, makeArmyCanvas, abbrevMen } from './heraldry';
import { ART } from './palette';

const SHIELD_W: Record<1 | 2 | 3 | 4, number> = { 1: 3.0, 2: 3.6, 3: 4.3, 4: 5.4 };
const SHIELD_ASPECT = 320 / 256;
const MOJON_W = 2.2;
const MOJON_ASPECT = 160 / 128;
const ARMY_W = 5.2;
const ARMY_ASPECT = 160 / 224;
const ARMY_SEL_SCALE = 1.18;

const CLICK_SLOP = 6; // px máximos entre pointerdown y pointerup para contar como clic

interface ArmyRecord {
  sprite: THREE.Sprite;
  texKey: string;
}
interface FocusTween {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  start: number;
  dur: number;
}

export class WorldScene implements WorldBridge {
  /** click en provincia/ejército (null = click al vacío). */
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

  private terrain: TerrainBuild | null = null;
  private readonly overlays = new Map<ProvinceId, ProvinceOverlay>();
  private fillMeshes: THREE.Mesh[] = [];
  private readonly settlementSprites = new Map<ProvinceId, THREE.Sprite>();
  private readonly settlementSig = new Map<ProvinceId, string>();
  private readonly armySprites = new Map<ArmyId, ArmyRecord>();
  private armySpriteList: THREE.Sprite[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly centerH = new Map<ProvinceId, number>();
  private readonly provinceById = new Map<ProvinceId, Province>();

  private hoveredId: ProvinceId | null = null;
  private selectedProvinceId: ProvinceId | null = null;
  private selectedArmyId: ArmyId | null = null;
  private readonly moveTargetIds = new Set<ProvinceId>();

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
    this.scene.fog = new THREE.Fog(ART.background, 130, 340);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 600);
    this.camera.position.set(0, 95, 78);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(new THREE.Color(ART.ambient), 0.8);
    const sun = new THREE.DirectionalLight(new THREE.Color(ART.sun), 1.0);
    sun.position.set(-70, 90, -50); // noroeste elevado
    this.scene.add(ambient, sun);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 170;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.25;
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
    this.refreshOverlayColors();
    this.refreshSettlements();
    this.refreshArmies();
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
        if (ov) {
          ov.moveTarget = true;
          this.moveTargetIds.add(id);
        }
      }
    }
  }

  setSelected(sel: Selection): void {
    if (this.selectedProvinceId !== null) {
      const prev = this.overlays.get(this.selectedProvinceId);
      if (prev) prev.selected = false;
    }
    this.selectedProvinceId = null;
    if (this.selectedArmyId !== null) this.scaleArmy(this.selectedArmyId, false);
    this.selectedArmyId = null;

    if (!sel) return;
    if (sel.kind === 'province') {
      const ov = this.overlays.get(sel.id);
      if (ov) {
        ov.selected = true;
        this.selectedProvinceId = sel.id;
      }
    } else {
      this.selectedArmyId = sel.id;
      this.scaleArmy(sel.id, true);
    }
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

    this.terrain = buildTerrain(this.state.provinces, this.state.seed);
    this.scene.add(this.terrain.mesh);

    for (const p of this.state.provinces) {
      this.provinceById.set(p.id, p);
      const ch = this.terrain.sampleHeight(p.center[0], p.center[1]);
      this.centerH.set(p.id, ch);
    }

    for (const p of this.state.provinces) {
      const ch = this.centerH.get(p.id) ?? 0;
      const ov = new ProvinceOverlay(p, ch, this.ownerColor(p));
      this.overlays.set(p.id, ov);
      for (const obj of ov.objects) this.scene.add(obj);
      this.fillMeshes.push(ov.fill);
    }
  }

  private clearMap(): void {
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
      this.terrain = null;
    }
    for (const ov of this.overlays.values()) {
      for (const obj of ov.objects) this.scene.remove(obj);
      ov.dispose();
    }
    this.overlays.clear();
    this.fillMeshes = [];

    for (const s of this.settlementSprites.values()) this.disposeSprite(s);
    this.settlementSprites.clear();
    this.settlementSig.clear();

    for (const rec of this.armySprites.values()) this.disposeSprite(rec.sprite);
    this.armySprites.clear();
    this.armySpriteList = [];

    this.provinceById.clear();
    this.centerH.clear();
    this.hoveredId = null;
    this.selectedProvinceId = null;
    this.selectedArmyId = null;
    this.moveTargetIds.clear();
  }

  // ---------------------------------------------------------------- refresh

  private refreshOverlayColors(): void {
    for (const p of this.state.provinces) {
      this.overlays.get(p.id)?.setOwnerColor(this.ownerColor(p));
    }
  }

  private refreshSettlements(): void {
    for (const p of this.state.provinces) {
      const faction = p.ownerId ? this.state.factions[p.ownerId] : undefined;
      const st = p.settlement;
      const sig = faction
        ? `own:${p.ownerId}:${st.level}:${st.fortLevel}`
        : 'neutral';
      if (this.settlementSig.get(p.id) === sig) continue;

      const prev = this.settlementSprites.get(p.id);
      if (prev) this.disposeSprite(prev);

      let sprite: THREE.Sprite;
      if (faction) {
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
        const w = SHIELD_W[st.level];
        sprite = this.makeSprite(tex, w, w * SHIELD_ASPECT);
      } else {
        const tex = this.texture('mojon', () => makeMojonCanvas());
        sprite = this.makeSprite(tex, MOJON_W, MOJON_W * MOJON_ASPECT);
      }
      const ch = this.centerH.get(p.id) ?? 0;
      sprite.position.set(p.center[0], ch + 3.5, p.center[1]);
      sprite.userData.provinceId = p.id;
      this.scene.add(sprite);
      this.settlementSprites.set(p.id, sprite);
      this.settlementSig.set(p.id, sig);
    }
  }

  private refreshArmies(): void {
    const armies = Object.values(this.state.armies);

    // eliminar huérfanos
    for (const [id, rec] of this.armySprites) {
      if (!this.state.armies[id]) {
        this.disposeSprite(rec.sprite);
        this.armySprites.delete(id);
      }
    }

    // agrupar por provincia para el abanico de offsets
    const byProvince = new Map<ProvinceId, ArmyId[]>();
    for (const a of armies) {
      const list = byProvince.get(a.provinceId);
      if (list) list.push(a.id);
      else byProvince.set(a.provinceId, [a.id]);
    }

    for (const [provinceId, ids] of byProvince) {
      const ch = this.centerH.get(provinceId);
      if (ch === undefined) continue;
      const p = this.provinceById.get(provinceId);
      if (!p) continue;
      const n = ids.length;
      ids.forEach((id, i) => {
        const army = this.state.armies[id];
        const faction = this.state.factions[army.factionId];
        const primary = faction ? faction.colorPrimary : ART.neutralOwner;
        const men = army.units.reduce((s, u) => s + u.men, 0);
        const menText = abbrevMen(men);
        const texKey = `army:${army.factionId}:${menText}`;

        let rec = this.armySprites.get(id);
        if (!rec) {
          const tex = this.texture(texKey, () => makeArmyCanvas(primary, menText));
          const sprite = this.makeSprite(tex, ARMY_W, ARMY_W * ARMY_ASPECT);
          sprite.userData.armyId = id;
          this.scene.add(sprite);
          rec = { sprite, texKey };
          this.armySprites.set(id, rec);
        } else if (rec.texKey !== texKey) {
          rec.sprite.material.map = this.texture(texKey, () => makeArmyCanvas(primary, menText));
          rec.sprite.material.needsUpdate = true;
          rec.texKey = texKey;
        }

        const ox = 4.5 + i * 3.4;
        const oz = (i - (n - 1) / 2) * 2.6;
        rec.sprite.position.set(p.center[0] + ox, ch + 5, p.center[1] + oz);
        const sel = this.selectedArmyId === id ? ARMY_SEL_SCALE : 1;
        rec.sprite.scale.set(ARMY_W * sel, ARMY_W * ARMY_ASPECT * sel, 1);
      });
    }

    this.armySpriteList = [];
    for (const rec of this.armySprites.values()) this.armySpriteList.push(rec.sprite);
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

  /** dispone el material del sprite (la textura vive en caché y no se dispone aquí). */
  private disposeSprite(sprite: THREE.Sprite): void {
    this.scene.remove(sprite);
    sprite.material.dispose();
  }

  private scaleArmy(id: ArmyId, selected: boolean): void {
    const rec = this.armySprites.get(id);
    if (!rec) return;
    const s = selected ? ARMY_SEL_SCALE : 1;
    rec.sprite.scale.set(ARMY_W * s, ARMY_W * ARMY_ASPECT * s, 1);
  }

  // ---------------------------------------------------------------- bucle / resize

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (this.focusTween) this.stepFocus(now);
    this.controls.update();
    const pulse = this.reducedMotion ? 0.5 : 0.45 + 0.1 * Math.sin(now * 0.005);
    for (const ov of this.overlays.values()) ov.apply(pulse);
    this.renderer.render(this.scene, this.camera);
  };

  private stepFocus(now: number): void {
    const f = this.focusTween;
    if (!f) return;
    const raw = Math.min(1, (now - f.start) / f.dur);
    const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; // easeInOutQuad
    this.controls.target.x = f.fromX + (f.toX - f.fromX) * e;
    this.controls.target.z = f.fromZ + (f.toZ - f.fromZ) * e;
    if (raw >= 1) this.focusTween = null;
  }

  private readonly cancelFocus = (): void => {
    this.focusTween = null;
  };

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
    const hits = this.raycaster.intersectObjects(this.armySpriteList, false);
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
    if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) >= CLICK_SLOP) return; // fue arrastre
    if (!this.onSelect) return;
    this.updateRay(ev);
    const army = this.hitArmy(); // prioridad de picking: ejército > provincia
    if (army !== null) {
      this.onSelect({ kind: 'army', id: army });
      return;
    }
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
