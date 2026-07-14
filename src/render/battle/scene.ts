/**
 * Escena Phaser de la batalla táctica. Responsabilidad: RENDER + INPUT de bajo
 * nivel. Lee TacticalState (via host) y lo pinta por diffs en sync(); traduce
 * clicks a hexes y delega las acciones semánticas al host (el controlador).
 * No contiene reglas de juego: para eso llama a la API pura del core.
 */
import Phaser from 'phaser';
import type { HexCoord, TacticalState, TacticalUnit, TacticalSide } from '../../core/tactical/types';
import { legalMoveHexes, legalTargets } from '../../core/tactical/api';
import { visualRng } from '../../core/state/rng';
import { HexLayout, hexKey, type Pt } from './hexLayout';
import {
  CANVAS, FOREST_GLYPH, STROKE_HEX, TERRAIN_HEX, glyphOf, hexToNum, lightenNum, lerpNum, luminance,
} from './theme';

export type BoardMode = 'move' | 'attack' | 'locked';

/** puente que la escena usa para consultar estado y disparar acciones. */
export interface SceneHost {
  getState(): TacticalState;
  /** color HEX de la ficha de una unidad (facción o guarnición). */
  unitColorHex(u: TacticalUnit): string;
  reducedMotion: boolean;
  playerSide: TacticalSide;
  /** modo del tablero cuando phase==='battle'. */
  boardMode(): BoardMode;
  tryDeploy(unitId: string, hex: HexCoord): void;
  requestMove(hex: HexCoord): void;
  requestAttack(targetUnitId: string): void;
  cancelMode(): void;
  onSceneReady(scene: BattleScene): void;
}

interface UnitView {
  id: string;
  container: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Graphics;
  bars: Phaser.GameObjects.Graphics;
  glyph: Phaser.GameObjects.Text;
  lastKey: string;
  colorHex: string;
}

interface Drop { x: number; y: number; vx: number; vy: number; len: number }

const DEPTH = { fog: 9, weather: 8, unit: 3, active: 2, overlay: 1, terrain: 0, float: 20 } as const;

export class BattleScene extends Phaser.Scene {
  private host: SceneHost;
  private layout!: HexLayout;

  private terrainGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private activeRing!: Phaser.GameObjects.Graphics;
  private weatherGfx!: Phaser.GameObjects.Graphics;
  private fogGfx!: Phaser.GameObjects.Graphics;
  private forestGlyphs: Phaser.GameObjects.Text[] = [];

  private views = new Map<string, UnitView>();
  private prevMen = new Map<string, number>();
  private prevRouted = new Set<string>();
  private cellMap = new Map<string, boolean>(); // key -> present

  private drops: Drop[] = [];
  private activeTween: Phaser.Tweens.Tween | null = null;

  // arrastre en despliegue
  private dragId: string | null = null;
  private dragMoved = false;
  private selectedDeployId: string | null = null;

  private ready = false;

  constructor(host: SceneHost) {
    super({ key: 'RdHBattle' });
    this.host = host;
  }

  create(): void {
    const ts = this.host.getState();
    this.cameras.main.setBackgroundColor(CANVAS.background);

    this.terrainGfx = this.add.graphics().setDepth(DEPTH.terrain);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);
    this.activeRing = this.add.graphics().setDepth(DEPTH.active);
    this.weatherGfx = this.add.graphics().setDepth(DEPTH.weather);
    this.fogGfx = this.add.graphics().setDepth(DEPTH.fog);

    for (const c of ts.cells) this.cellMap.set(hexKey(c.coord), true);

    this.computeLayout();
    this.drawTerrain();
    this.initWeather();
    this.drawFog();

    if (!this.host.reducedMotion) {
      this.activeTween = this.tweens.add({
        targets: this.activeRing,
        scale: { from: 1, to: 1.16 },
        alpha: { from: 0.85, to: 0.35 },
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this.setupInput();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // sembrar el estado previo para no disparar bajas flotantes en el primer pintado
    for (const u of ts.units) {
      this.prevMen.set(u.id, u.men);
      if (u.routed) this.prevRouted.add(u.id);
    }

    this.sync();
    this.ready = true;
    this.host.onSceneReady(this);
  }

  // ---------- layout ----------

  private computeLayout(): void {
    const w = this.scale.width || 960;
    const h = this.scale.height || 600;
    this.layout = new HexLayout(this.host.getState().cells, w, h, { top: 74, bottom: 132, x: 40 });
  }

  private onResize(): void {
    if (!this.ready) return;
    this.computeLayout();
    this.drawTerrain();
    this.initWeather();
    this.drawFog();
    this.sync();
  }

  // ---------- terreno (estático) ----------

  private drawTerrain(): void {
    const ts = this.host.getState();
    const g = this.terrainGfx;
    g.clear();
    for (const t of this.forestGlyphs) t.destroy();
    this.forestGlyphs = [];

    const strokeNum = hexToNum(STROKE_HEX);
    for (const cell of ts.cells) {
      const corners = this.layout.corners(cell.coord);
      let base = hexToNum(TERRAIN_HEX[cell.terrain]);

      // relieve: aclarar por elevación (marcado en colina).
      const elevAmt = cell.elevation * (cell.terrain === 'colina' ? 0.12 : 0.06);
      base = lightenNum(base, elevAmt);
      // vados de río (transitables) más claros que el cauce profundo.
      if (cell.terrain === 'rio' && !cell.blocked) base = lightenNum(base, 0.16);
      // roca / agua profunda intransitable: un punto más apagada.
      if (cell.blocked && cell.terrain !== 'rio') base = lightenNum(base, 0.02);

      g.fillStyle(base, 1);
      g.fillPoints(corners as Phaser.Geom.Point[], true);
      g.lineStyle(1, strokeNum, 0.5);
      g.strokePoints(corners as Phaser.Geom.Point[], true, true);

      if (cell.terrain === 'bosque') {
        const c = this.layout.toPixel(cell.coord);
        const gl = this.add.text(c.x, c.y, FOREST_GLYPH, {
          fontFamily: 'Georgia, "Segoe UI Symbol", serif',
          fontSize: `${Math.round(this.layout.size * 0.7)}px`,
          color: '#3f4a34',
        }).setOrigin(0.5).setDepth(DEPTH.terrain).setAlpha(0.85);
        this.forestGlyphs.push(gl);
      }
    }
  }

  // ---------- clima ----------

  private initWeather(): void {
    this.drops = [];
    if (this.weatherGfx) this.weatherGfx.clear();
    if (this.host.reducedMotion) return;
    const ts = this.host.getState();
    if (ts.weather !== 'lluvia' && ts.weather !== 'nieve') return;
    const w = this.scale.width || 960;
    const h = this.scale.height || 600;
    const rng = visualRng((ts.provinceId + 1) * 0x9e3779b1);
    const n = ts.weather === 'lluvia' ? 130 : 90;
    for (let i = 0; i < n; i++) {
      if (ts.weather === 'lluvia') {
        this.drops.push({ x: rng.next() * w, y: rng.next() * h, vx: -0.7, vy: 9 + rng.next() * 4, len: 8 + rng.next() * 6 });
      } else {
        this.drops.push({ x: rng.next() * w, y: rng.next() * h, vx: (rng.next() - 0.5) * 0.6, vy: 1.1 + rng.next() * 1.1, len: 1.3 + rng.next() * 1.4 });
      }
    }
  }

  private drawFog(): void {
    const g = this.fogGfx;
    g.clear();
    if (this.host.getState().weather !== 'niebla') return;
    const w = this.scale.width || 960;
    const h = this.scale.height || 600;
    g.fillStyle(CANVAS.fog, 0.13);
    g.fillRect(0, 0, w, h);
    // viñeta gris: marcos concéntricos que oscurecen los bordes (sin partículas).
    for (let k = 0; k < 46; k += 3) {
      g.lineStyle(3, 0x14110f, 0.02);
      g.strokeRect(k, k, w - k * 2, h - k * 2);
    }
  }

  update(_t: number, delta: number): void {
    if (!this.ready || this.drops.length === 0) return;
    const ts = this.host.getState();
    if (ts.weather !== 'lluvia' && ts.weather !== 'nieve') return;
    const w = this.scale.width || 960;
    const h = this.scale.height || 600;
    const dt = Math.min(delta / 16.6667, 3);
    const g = this.weatherGfx;
    g.clear();
    if (ts.weather === 'lluvia') g.lineStyle(1, CANVAS.rain, 0.32);
    for (const d of this.drops) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y > h) { d.y = -4; d.x = (d.x + 133.7) % w; }
      if (d.x < 0) d.x += w; else if (d.x > w) d.x -= w;
      if (ts.weather === 'lluvia') {
        g.lineBetween(d.x, d.y, d.x - 1.6, d.y - d.len);
      } else {
        g.fillStyle(CANVAS.snow, 0.5);
        g.fillCircle(d.x, d.y, d.len);
      }
    }
  }

  // ---------- unidades y overlays (dinámico) ----------

  sync(): void {
    if (!this.terrainGfx) return;
    const ts = this.host.getState();
    const seen = new Set<string>();
    const R = this.layout.unitRadius();

    for (const u of ts.units) {
      seen.add(u.id);
      let v = this.views.get(u.id);
      if (!v) v = this.createUnitView(u);
      this.updateUnitView(v, u, R);
    }
    // eliminar vistas de unidades que ya no existen
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { this.destroyView(v); this.views.delete(id); this.prevMen.delete(id); this.prevRouted.delete(id); }
    }

    this.drawOverlay(ts, R);
    this.drawActiveRing(ts, R);
  }

  private createUnitView(u: TacticalUnit): UnitView {
    const disc = this.add.graphics();
    const bars = this.add.graphics();
    const glyph = this.add.text(0, 0, glyphOf(u), {
      fontFamily: 'Georgia, "Segoe UI Symbol", serif',
      fontSize: '16px',
    }).setOrigin(0.5);
    const container = this.add.container(0, 0, [disc, bars, glyph]).setDepth(DEPTH.unit);
    const v: UnitView = { id: u.id, container, disc, bars, glyph, lastKey: '', colorHex: '' };
    this.views.set(u.id, v);
    return v;
  }

  private destroyView(v: UnitView): void {
    v.container.destroy(true);
  }

  private updateUnitView(v: UnitView, u: TacticalUnit, R: number): void {
    const px = this.layout.toPixel(u.coord);
    const key = hexKey(u.coord);
    const colorHex = this.host.unitColorHex(u);

    // ficha (redibujar sólo si cambia color o radio via key de layout)
    if (v.colorHex !== colorHex) {
      v.colorHex = colorHex;
      const fill = hexToNum(colorHex);
      v.disc.clear();
      v.disc.fillStyle(fill, 1);
      v.disc.fillCircle(0, 0, R);
      v.disc.lineStyle(2, hexToNum(STROKE_HEX), 1);
      v.disc.strokeCircle(0, 0, R);
      const light = luminance(colorHex) < 0.52;
      v.glyph.setColor(light ? '#EDEBDE' : '#17140F');
      v.glyph.setFontSize(Math.round(R * 1.05));
      v.glyph.setText(glyphOf(u));
    }

    // barras de hombres y moral
    this.drawBars(v.bars, u, R);

    // posición: interpolar si cambió de hex (salvo movimiento reducido)
    if (this.dragId === u.id) {
      // gestionado por el arrastre; no reposicionar aquí
    } else if (v.lastKey === '') {
      v.container.setPosition(px.x, px.y);
    } else if (v.lastKey !== key) {
      if (this.host.reducedMotion) {
        v.container.setPosition(px.x, px.y);
      } else {
        this.tweens.add({ targets: v.container, x: px.x, y: px.y, duration: 240, ease: 'Sine.InOut' });
      }
    } else {
      v.container.setPosition(px.x, px.y);
    }
    v.lastKey = key;
    v.container.setDepth(DEPTH.unit);
    v.container.setAlpha(u.routed ? 0.28 : 1);

    // bajas flotantes + sacudida por diff de hombres
    const prev = this.prevMen.get(u.id);
    if (prev !== undefined && u.men < prev) {
      this.spawnCasualty(px.x, px.y - R, prev - u.men);
      this.hitShake(v.container, px);
    }
    this.prevMen.set(u.id, u.men);

    // ruta (huida)
    if (u.routed && !this.prevRouted.has(u.id)) {
      this.prevRouted.add(u.id);
      this.spawnRout(px.x, px.y - R);
    }
    if (!u.routed) this.prevRouted.delete(u.id);
  }

  private drawBars(g: Phaser.GameObjects.Graphics, u: TacticalUnit, R: number): void {
    g.clear();
    const w = R * 2;
    const x0 = -R;
    const menRatio = u.menMax > 0 ? Math.max(0, Math.min(1, u.men / u.menMax)) : 0;
    const morRatio = u.moraleMax > 0 ? Math.max(0, Math.min(1, u.morale / u.moraleMax)) : 0;
    // barra de hombres
    const y1 = R + 3;
    g.fillStyle(CANVAS.barBack, 0.85); g.fillRect(x0, y1, w, 3);
    g.fillStyle(CANVAS.menBar, 1); g.fillRect(x0, y1, w * menRatio, 3);
    // barra fina de moral
    const y2 = R + 7;
    g.fillStyle(CANVAS.barBack, 0.85); g.fillRect(x0, y2, w, 2);
    g.fillStyle(lerpNum(CANVAS.moraleLow, CANVAS.moraleHigh, morRatio), 1);
    g.fillRect(x0, y2, w * morRatio, 2);
  }

  private drawOverlay(ts: TacticalState, R: number): void {
    const g = this.overlayGfx;
    g.clear();

    // despliegue: resaltar la unidad propia seleccionada
    if (ts.phase === 'deployment') {
      if (this.selectedDeployId) {
        const u = ts.units.find(x => x.id === this.selectedDeployId);
        if (u) {
          const p = this.layout.toPixel(u.coord);
          g.lineStyle(2, CANVAS.parchment, 0.9);
          g.strokeCircle(p.x, p.y, R + 5);
        }
      }
      return;
    }

    if (ts.phase !== 'battle') return;
    const activeId = ts.activeUnitId;
    if (!activeId) return;
    const active = ts.units.find(u => u.id === activeId);
    if (!active || active.side !== this.host.playerSide || active.routed) return;

    // hexes de movimiento legal (pergamino translúcido)
    let moves: HexCoord[] = [];
    let targets: string[] = [];
    try { moves = legalMoveHexes(ts, activeId); } catch { moves = []; }
    try { targets = legalTargets(ts, activeId); } catch { targets = []; }

    for (const m of moves) {
      const corners = this.layout.corners(m);
      g.fillStyle(CANVAS.parchment, 0.15);
      g.fillPoints(corners as Phaser.Geom.Point[], true);
      g.lineStyle(1, CANVAS.parchment, 0.4);
      g.strokePoints(corners as Phaser.Geom.Point[], true, true);
    }

    const mode = this.host.boardMode();
    const tset = new Set(targets);
    for (const u of ts.units) {
      if (!tset.has(u.id)) continue;
      const p = this.layout.toPixel(u.coord);
      g.lineStyle(mode === 'attack' ? 3 : 2, CANVAS.targetRing, mode === 'attack' ? 1 : 0.85);
      g.strokeCircle(p.x, p.y, R + 4);
    }
  }

  private drawActiveRing(ts: TacticalState, R: number): void {
    const g = this.activeRing;
    g.clear();
    if (ts.phase !== 'battle' || !ts.activeUnitId) { g.setVisible(false); return; }
    const active = ts.units.find(u => u.id === ts.activeUnitId);
    if (!active || active.routed) { g.setVisible(false); return; }
    const p = this.layout.toPixel(active.coord);
    g.setVisible(true);
    g.setPosition(p.x, p.y);
    const isPlayer = active.side === this.host.playerSide;
    g.lineStyle(2.5, isPlayer ? CANVAS.parchment : CANVAS.targetRing, 0.9);
    g.strokeCircle(0, 0, R + 6);
    if (this.host.reducedMotion) { g.setScale(1); g.setAlpha(0.85); }
  }

  // ---------- efectos ----------

  private spawnCasualty(x: number, y: number, n: number): void {
    const t = this.add.text(x, y, `−${n}`, {
      fontFamily: 'Georgia, serif',
      fontSize: '15px',
      color: '#e7c9a3',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH.float);
    t.setStroke(STROKE_HEX, 3);
    if (this.host.reducedMotion) {
      this.tweens.add({ targets: t, alpha: 0, duration: 900, delay: 300, onComplete: () => t.destroy() });
    } else {
      this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 950, ease: 'Cubic.Out', onComplete: () => t.destroy() });
    }
  }

  private spawnRout(x: number, y: number): void {
    const t = this.add.text(x, y, '¡rota!', {
      fontFamily: 'Georgia, serif',
      fontSize: '13px',
      color: '#c9c3b2',
      fontStyle: 'italic',
    }).setOrigin(0.5).setDepth(DEPTH.float);
    t.setStroke(STROKE_HEX, 3);
    this.tweens.add({ targets: t, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  private hitShake(c: Phaser.GameObjects.Container, home: Pt): void {
    if (this.host.reducedMotion) return;
    this.tweens.add({
      targets: c,
      x: home.x + 3,
      duration: 45,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.InOut',
      onComplete: () => c.setPosition(home.x, home.y),
    });
  }

  // ---------- input ----------

  private setupInput(): void {
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
  }

  private cellPresent(hex: HexCoord): boolean {
    return this.cellMap.has(hexKey(hex));
  }

  private ownUnitAt(hex: HexCoord): TacticalUnit | null {
    const ts = this.host.getState();
    const k = hexKey(hex);
    for (const u of ts.units) {
      if (u.side === this.host.playerSide && !u.routed && hexKey(u.coord) === k) return u;
    }
    return null;
  }

  private unitAt(hex: HexCoord): TacticalUnit | null {
    const ts = this.host.getState();
    const k = hexKey(hex);
    for (const u of ts.units) {
      if (!u.routed && hexKey(u.coord) === k) return u;
    }
    return null;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (!this.ready) return;
    if (p.rightButtonDown()) { this.selectedDeployId = null; this.host.cancelMode(); this.sync(); return; }
    const ts = this.host.getState();
    const hex = this.layout.pixelToHex(p.worldX, p.worldY);

    if (ts.phase === 'deployment') {
      const u = this.ownUnitAt(hex);
      if (u) {
        this.dragId = u.id;
        this.dragMoved = false;
        this.selectedDeployId = u.id;
        const v = this.views.get(u.id);
        if (v) v.container.setDepth(DEPTH.float);
        this.sync();
      } else if (this.selectedDeployId && this.cellPresent(hex)) {
        this.host.tryDeploy(this.selectedDeployId, hex);
      }
      return;
    }

    if (ts.phase === 'battle') {
      const mode = this.host.boardMode();
      if (mode === 'locked') return;
      if (mode === 'attack') {
        const tgt = this.unitAt(hex);
        if (tgt && ts.activeUnitId) {
          let targets: string[] = [];
          try { targets = legalTargets(ts, ts.activeUnitId); } catch { targets = []; }
          if (targets.includes(tgt.id)) { this.host.requestAttack(tgt.id); return; }
        }
        this.host.cancelMode();
        return;
      }
      // modo movimiento
      if (this.cellPresent(hex)) this.host.requestMove(hex);
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.dragId) return;
    this.dragMoved = true;
    const v = this.views.get(this.dragId);
    if (v) v.container.setPosition(p.worldX, p.worldY);
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (!this.dragId) return;
    const id = this.dragId;
    this.dragId = null;
    const v = this.views.get(id);
    if (v) v.container.setDepth(DEPTH.unit);
    if (this.dragMoved) {
      const hex = this.layout.pixelToHex(p.worldX, p.worldY);
      this.host.tryDeploy(id, hex);
    } else {
      // fue un click: la unidad queda seleccionada para recolocar por click
      this.sync();
    }
  }

  /** el controlador limpia la selección de despliegue al comenzar la batalla. */
  clearDeploySelection(): void {
    this.selectedDeployId = null;
  }
}
