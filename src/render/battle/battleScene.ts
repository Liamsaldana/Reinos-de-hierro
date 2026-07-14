/**
 * Escena de batalla táctica (GDD §8, §13.2) — punto de entrada público.
 *
 * openTacticalBattle() monta un Phaser.Game dentro del contenedor dado y un HUD
 * DOM propio por encima, orquesta el flujo despliegue → batalla → fin, y al
 * cerrar vuelca el resultado a la capa estratégica y se autodestruye.
 *
 * El controlador NO contiene reglas de combate: toda la lógica vive en el motor
 * táctico puro (src/core/tactical/api.ts). Aquí sólo se traduce input a llamadas
 * de esa API y se refresca el render. Hoy esa API lanza 'pendiente' (agente F);
 * las llamadas van envueltas para que la UI no se rompa mientras tanto.
 */
import Phaser from 'phaser';
import type { BattleReport, FactionId, GameState, ProvinceId } from '../../core/types';
import type { Rng } from '../../core/state/rng';
import type { HexCoord, TacticalSide, TacticalState, TacticalUnit } from '../../core/tactical/types';
import {
  applyTacticalResult, attackUnit, createTacticalBattle, deployUnit, endActivation,
  finishDeployment, isPlayerTurn, moveUnit, runAIActivation, setFormation, useGeneralAbility,
} from '../../core/tactical/api';
import { BattleScene, type BoardMode, type SceneHost } from './scene';
import { Hud, type HudCallbacks } from './hud';
import { CANVAS, FORMATION_ORDER, NEUTRAL_UNIT_HEX } from './theme';

export interface TacticalBattleHandle {
  destroy(): void;
}

export interface OpenTacticalBattleOpts {
  container: HTMLElement;
  state: GameState;
  rng: Rng;
  attackerFactionId: FactionId;
  provinceId: ProvinceId;
  playerFactionId: FactionId;
  onDone: (report: BattleReport) => void;
}

class BattleController implements SceneHost, HudCallbacks {
  private opts: OpenTacticalBattleOpts;
  private ts: TacticalState;

  readonly reducedMotion: boolean;
  readonly playerSide: TacticalSide;

  private root: HTMLElement;
  private canvasHost: HTMLElement;
  private hud: Hud;
  private game: Phaser.Game | null = null;
  private sceneInstance: BattleScene;
  private scene: BattleScene | null = null;

  private attackMode = false;
  private aiRunning = false;
  private finishShown = false;
  private destroyed = false;

  private timers = new Set<number>();
  private prevPosition: string;
  private prevOverflow: string;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.attackMode = false;
      this.scene?.clearDeploySelection();
      this.refresh();
    }
  };
  private onContextMenu = (e: Event): void => {
    e.preventDefault();
    this.attackMode = false;
    this.refresh();
  };

  constructor(opts: OpenTacticalBattleOpts) {
    this.opts = opts;
    // 1) motor: crear el estado táctico ANTES de tocar el DOM (si lanza, no hay fuga).
    this.ts = createTacticalBattle(opts.state, opts.rng, opts.attackerFactionId, opts.provinceId);

    this.playerSide = this.ts.playerSide
      ?? (opts.playerFactionId === this.ts.attackerFactionId ? 'attacker' : 'defender');
    this.reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    // 2) contenedor / DOM
    const container = opts.container;
    this.prevPosition = container.style.position;
    this.prevOverflow = container.style.overflow;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this.root = document.createElement('div');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden' });
    this.canvasHost = document.createElement('div');
    Object.assign(this.canvasHost.style, { position: 'absolute', inset: '0' });
    this.root.appendChild(this.canvasHost);

    this.hud = new Hud(this, (u) => this.unitColorHex(u), this.playerSide);
    this.root.appendChild(this.hud.root);
    container.appendChild(this.root);

    this.root.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);

    // 3) Phaser
    this.sceneInstance = new BattleScene(this);
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.canvasHost,
      backgroundColor: CANVAS.background,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: this.sceneInstance,
      banner: false,
      audio: { noAudio: true },
      render: { antialias: true, powerPreference: 'high-performance' },
    });

    // 4) primer pintado del HUD (la escena se pinta al estar lista)
    this.hud.sync(this.ts, { playerActive: this.isPlayerActive(), attackMode: this.attackMode });
  }

  // ---------- SceneHost ----------

  getState(): TacticalState { return this.ts; }

  unitColorHex(u: TacticalUnit): string {
    const fid = u.side === 'attacker' ? this.ts.attackerFactionId : this.ts.defenderFactionId;
    if (fid == null) return NEUTRAL_UNIT_HEX;
    const f = this.opts.state.factions[fid];
    return f ? f.colorPrimary : NEUTRAL_UNIT_HEX;
  }

  boardMode(): BoardMode {
    if (this.ts.phase !== 'battle') return 'locked';
    if (this.aiRunning) return 'locked';
    if (!this.isPlayerActive()) return 'locked';
    return this.attackMode ? 'attack' : 'move';
  }

  tryDeploy(unitId: string, hex: HexCoord): void {
    this.safe(() => { deployUnit(this.ts, unitId, hex); });
    this.refresh();
  }

  requestMove(hex: HexCoord): void {
    const aid = this.ts.activeUnitId;
    if (!aid || !this.isPlayerActive()) { this.refresh(); return; }
    this.safe(() => { moveUnit(this.ts, aid, hex); });
    this.afterAction();
  }

  requestAttack(targetUnitId: string): void {
    const aid = this.ts.activeUnitId;
    if (!aid || !this.isPlayerActive()) { this.refresh(); return; }
    this.safe(() => { attackUnit(this.ts, aid, targetUnitId); });
    this.attackMode = false;
    this.afterAction();
  }

  cancelMode(): void {
    this.attackMode = false;
    this.scene?.clearDeploySelection();
    this.refresh();
  }

  onSceneReady(scene: BattleScene): void {
    this.scene = scene;
    this.refresh();
    // robustez: si el motor arrancara ya en batalla/fin (no ocurre en despliegue).
    this.checkPhase();
  }

  // ---------- HudCallbacks ----------

  onStartBattle(): void {
    if (this.ts.phase !== 'deployment') return;
    this.safe(() => { finishDeployment(this.ts); });
    this.scene?.clearDeploySelection();
    this.afterAction();
  }

  onToggleAttack(): void {
    if (!this.isPlayerActive()) return;
    this.attackMode = !this.attackMode;
    this.refresh();
  }

  onCycleFormation(): void {
    if (!this.isPlayerActive()) return;
    const aid = this.ts.activeUnitId;
    const a = aid ? this.ts.units.find(u => u.id === aid) : null;
    if (!aid || !a) return;
    const idx = FORMATION_ORDER.indexOf(a.formation);
    const next = FORMATION_ORDER[(idx + 1) % FORMATION_ORDER.length];
    let ok = false;
    this.safe(() => { ok = setFormation(this.ts, aid, next); });
    if (!ok) this.hud.toast('No puedes cambiar de formación ahora.');
    this.afterAction();
  }

  onGeneralAbility(): void {
    if (!this.isPlayerActive()) return;
    let lines: string[] = [];
    this.safe(() => { lines = useGeneralAbility(this.ts); });
    if (lines.length === 0) this.hud.toast('Sin cargas de habilidad o sin general.');
    this.afterAction();
  }

  onEndActivation(): void {
    if (!this.isPlayerActive()) return;
    this.attackMode = false;
    this.safe(() => { endActivation(this.ts); });
    this.afterAction();
  }

  onReturnToMap(): void {
    if (!this.finishShown) return;
    let report: BattleReport | null = null;
    this.safe(() => { report = applyTacticalResult(this.opts.state, this.opts.rng, this.ts); });
    if (report) this.opts.onDone(report);
    this.destroy();
  }

  // ---------- orquestación ----------

  private isPlayerActive(): boolean {
    if (this.ts.phase !== 'battle') return false;
    let mine = false;
    try { mine = isPlayerTurn(this.ts); } catch { mine = false; }
    if (!mine) return false;
    const aid = this.ts.activeUnitId;
    const a = aid ? this.ts.units.find(u => u.id === aid) : null;
    return !!a && a.side === this.playerSide && !a.routed;
  }

  private refresh(): void {
    if (this.destroyed) return;
    this.scene?.sync();
    this.hud.sync(this.ts, { playerActive: this.isPlayerActive(), attackMode: this.attackMode });
  }

  private afterAction(): void {
    this.refresh();
    this.checkPhase();
  }

  private checkPhase(): void {
    if (this.destroyed) return;
    if (this.ts.phase === 'finished') { this.showFinish(); return; }
    if (this.ts.phase === 'battle' && !this.aiRunning) {
      let mine = false;
      try { mine = isPlayerTurn(this.ts); } catch { mine = true; }
      if (!mine) void this.runAILoop();
    }
  }

  private async runAILoop(): Promise<void> {
    if (this.aiRunning || this.destroyed) return;
    this.aiRunning = true;
    this.refresh(); // bloquea el tablero mientras la IA juega
    let iterations = 0;
    let stuck = 0;
    let lastActive = this.ts.activeUnitId;
    try {
      while (!this.destroyed && this.ts.phase === 'battle') {
        let mine = false;
        try { mine = isPlayerTurn(this.ts); } catch { mine = true; }
        if (mine) break;
        if (++iterations > 2000) break; // salvavidas anti-bucle

        this.safe(() => { runAIActivation(this.ts); });
        this.scene?.sync();

        if (this.ts.activeUnitId === lastActive) {
          if (++stuck > 3) break; // el motor no avanzó (stub / bloqueo): salir
        } else {
          stuck = 0;
          lastActive = this.ts.activeUnitId;
        }
        await this.delay(this.reducedMotion ? 120 : 350);
      }
    } finally {
      this.aiRunning = false;
    }
    if (this.destroyed) return;
    this.refresh();
    if (this.ts.phase === 'finished') this.showFinish();
  }

  private showFinish(): void {
    if (this.finishShown || this.destroyed) return;
    this.finishShown = true;
    const win = this.ts.winner !== null && this.ts.winner === this.playerSide;
    this.hud.showFinish(win);
    this.refresh();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(() => { this.timers.delete(id); resolve(); }, ms);
      this.timers.add(id);
    });
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      // el motor táctico puede lanzar 'pendiente' hasta que el agente F lo implemente.
      console.warn('[batalla] acción no disponible:', err instanceof Error ? err.message : err);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
    try { this.game?.destroy(true); } catch { /* noop */ }
    this.game = null;
    this.scene = null;
    this.root.remove();
    this.opts.container.style.position = this.prevPosition;
    this.opts.container.style.overflow = this.prevOverflow;
  }
}

export function openTacticalBattle(opts: OpenTacticalBattleOpts): TacticalBattleHandle {
  const ctrl = new BattleController(opts);
  return { destroy: () => ctrl.destroy() };
}
