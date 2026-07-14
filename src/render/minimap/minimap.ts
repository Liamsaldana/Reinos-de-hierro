/**
 * Minimapa de Valdemar (GDD §13.2) — canvas 2D, clic para centrar la cámara.
 * Escrito por el orquestador. Sin dependencias de Three/Phaser: lee GameState
 * y habla con el mundo 3D solo a través de WorldBridge.
 */
import type { GameState, ProvinceId, WorldBridge } from '../../core/types';
import type { GameStore } from '../../core/state/store';

const PANEL_W = 236;
const MAP_H = 148;
/** rectángulo del mundo de juego con un pequeño margen */
const WORLD = { minX: -84, maxX: 84, minZ: -54, maxZ: 54 };

const INK = '#1B1716';
const PARCHMENT = '#EDEBDE';
const HAIRLINE = 'rgba(237,235,222,.14)';
const SEA = '#14110f';
const NEUTRAL = '#4a443f';

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class Minimap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private unsub: () => void;
  private innerW: number;

  constructor(
    private store: GameStore,
    private getWorld: () => WorldBridge | null,
  ) {
    this.root = document.createElement('div');
    this.root.setAttribute('aria-label', 'Minimapa de Valdemar');
    Object.assign(this.root.style, {
      position: 'fixed',
      right: '14px',
      bottom: '14px',
      width: `${PANEL_W}px`,
      padding: '7px 7px 5px',
      background: 'rgba(27,23,22,.94)',
      border: `1px solid ${HAIRLINE}`,
      borderRadius: '2px',
      zIndex: '30',
      pointerEvents: 'auto',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.innerW = PANEL_W - 14;
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.innerW * dpr);
    this.canvas.height = Math.round(MAP_H * dpr);
    Object.assign(this.canvas.style, {
      width: `${this.innerW}px`,
      height: `${MAP_H}px`,
      display: 'block',
      cursor: 'crosshair',
    } as Partial<CSSStyleDeclaration>);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Minimapa: canvas 2D no disponible');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);

    const caption = document.createElement('div');
    caption.textContent = 'VALDEMAR';
    Object.assign(caption.style, {
      color: PARCHMENT,
      opacity: '0.55',
      font: '600 9px Georgia, serif',
      letterSpacing: '.22em',
      textAlign: 'center',
      paddingTop: '4px',
    } as Partial<CSSStyleDeclaration>);

    this.canvas.addEventListener('click', this.onClick);
    this.root.append(this.canvas, caption);
    document.body.appendChild(this.root);

    this.unsub = store.subscribe((_s, ev) => {
      if (
        ev.type === 'state-replaced' || ev.type === 'map-changed' ||
        ev.type === 'turn-ended' || ev.type === 'battle' || ev.type === 'selection'
      ) {
        this.draw();
      }
    });
    if (store.hasGame) this.draw();
  }

  private toCanvas(x: number, z: number): [number, number] {
    const cx = ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * this.innerW;
    const cz = ((z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * MAP_H;
    return [cx, cz];
  }

  private toWorld(px: number, py: number): [number, number] {
    const x = WORLD.minX + (px / this.innerW) * (WORLD.maxX - WORLD.minX);
    const z = WORLD.minZ + (py / MAP_H) * (WORLD.maxZ - WORLD.minZ);
    return [x, z];
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.store.hasGame) return;
    const rect = this.canvas.getBoundingClientRect();
    const [wx, wz] = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const state = this.store.state;

    let hit: ProvinceId | null = null;
    for (const p of state.provinces) {
      if (pointInPolygon(wx, wz, p.polygon)) { hit = p.id; break; }
    }
    if (hit === null) {
      // agua o borde: la provincia más cercana, si está razonablemente cerca
      let best = Infinity;
      for (const p of state.provinces) {
        const d = (p.center[0] - wx) ** 2 + (p.center[1] - wz) ** 2;
        if (d < best) { best = d; hit = p.id; }
      }
      if (best > 20 ** 2) hit = null;
    }
    if (hit !== null) {
      this.store.setSelection({ kind: 'province', id: hit });
      this.getWorld()?.focusProvince(hit);
    }
  };

  private draw(): void {
    if (!this.store.hasGame) return;
    const state: GameState = this.store.state;
    const ctx = this.ctx;
    const sel = this.store.selection;
    const selectedId =
      sel?.kind === 'province' ? sel.id :
      sel?.kind === 'army' ? state.armies[sel.id]?.provinceId ?? null : null;

    ctx.clearRect(0, 0, this.innerW, MAP_H);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, this.innerW, MAP_H);

    // provincias: relleno por dueño + trazo hierro
    for (const p of state.provinces) {
      ctx.beginPath();
      p.polygon.forEach(([x, z], i) => {
        const [cx, cz] = this.toCanvas(x, z);
        if (i === 0) ctx.moveTo(cx, cz); else ctx.lineTo(cx, cz);
      });
      ctx.closePath();
      const owner = p.ownerId ? state.factions[p.ownerId] : null;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = owner ? owner.colorPrimary : NEUTRAL;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = p.id === selectedId ? 1.6 : 0.6;
      ctx.strokeStyle = p.id === selectedId ? PARCHMENT : INK;
      ctx.stroke();
    }

    // capitales: rombo pergamino
    for (const p of state.provinces) {
      if (p.settlement.level !== 4) continue;
      const [cx, cz] = this.toCanvas(p.center[0], p.center[1]);
      ctx.beginPath();
      ctx.moveTo(cx, cz - 3); ctx.lineTo(cx + 3, cz); ctx.lineTo(cx, cz + 3); ctx.lineTo(cx - 3, cz);
      ctx.closePath();
      ctx.fillStyle = PARCHMENT;
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }

    // ejércitos: punto con anillo (desplazado del centro para no tapar capitales)
    for (const a of Object.values(state.armies)) {
      const p = state.provinces.find(pr => pr.id === a.provinceId);
      if (!p) continue;
      const [cx, cz] = this.toCanvas(p.center[0] + 3.5, p.center[1] + 2.5);
      ctx.beginPath();
      ctx.arc(cx, cz, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = state.factions[a.factionId]?.colorPrimary ?? NEUTRAL;
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = a.factionId === state.playerFactionId ? PARCHMENT : INK;
      ctx.stroke();
    }
  }

  dispose(): void {
    this.unsub();
    this.canvas.removeEventListener('click', this.onClick);
    this.root.remove();
  }
}
