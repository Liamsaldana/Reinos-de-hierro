/**
 * Generadores de texturas canvas procedurales para los billboards del mapa:
 * escudos heráldicos (asentamientos con señor), mojones (tierras sin señor) y
 * gallardetes de guerra (ejércitos). Todo el texto usa 'Georgia, serif' literal
 * para no depender de fuentes cargadas por el proyecto.
 */
import { visualRng } from '../../core/state/rng';
import { ART } from './palette';

export interface ShieldSpec {
  primary: string;
  secondary: string;
  /** semilla de heráldica (Faction.bannerSeed) → partición determinista */
  seed: number;
  /** inicial de la dinastía (una letra) */
  initial: string;
  level: 1 | 2 | 3 | 4;
  fortLevel: 0 | 1 | 2 | 3;
}

type Partition = 'partido' | 'cortado' | 'jefe' | 'banda';
const PARTITIONS: readonly Partition[] = ['partido', 'cortado', 'jefe', 'banda'];

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  return { canvas, ctx };
}

/** traza el contorno de un escudo tipo "heater" centrado en cx, desde `top`. */
function shieldPath(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number): void {
  const left = cx - w / 2;
  const right = cx + w / 2;
  const shoulder = top + h * 0.52;
  const bottom = top + h;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, shoulder);
  ctx.quadraticCurveTo(right, bottom - h * 0.12, cx, bottom);
  ctx.quadraticCurveTo(left, bottom - h * 0.12, left, shoulder);
  ctx.closePath();
}

/** escudo heráldico. Canvas 256×320. */
export function makeShieldCanvas(spec: ShieldSpec): HTMLCanvasElement {
  const W = 256;
  const H = 320;
  const { canvas, ctx } = newCanvas(W, H);

  const cx = W * 0.5;
  const top = H * 0.13;
  const sw = W * 0.72;
  const sh = H * 0.66;
  const bottom = top + sh;

  // corona de merlones para capital (nivel 4), sobre el escudo
  if (spec.level === 4) {
    ctx.fillStyle = ART.parchment;
    const cw = sw * 0.5;
    const cl = cx - cw / 2;
    const cyTop = top - H * 0.075;
    const merlon = cw / 5;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cl + i * merlon * 2, cyTop, merlon, H * 0.05);
    }
    ctx.fillRect(cl, cyTop + H * 0.035, cw, H * 0.02);
  }

  // campo con partición determinista
  ctx.save();
  shieldPath(ctx, cx, top, sw, sh);
  ctx.clip();
  ctx.fillStyle = spec.primary;
  ctx.fillRect(0, 0, W, H);

  const r = visualRng(spec.seed);
  ctx.fillStyle = spec.secondary;
  switch (r.pick(PARTITIONS)) {
    case 'partido': // partido: mitad diestra
      ctx.fillRect(cx, 0, W, H);
      break;
    case 'cortado': // cortado: mitad inferior
      ctx.fillRect(0, top + sh * 0.5, W, H);
      break;
    case 'jefe': // jefe: banda superior
      ctx.fillRect(0, 0, W, top + sh * 0.3);
      break;
    case 'banda': { // banda diagonal
      ctx.save();
      ctx.translate(cx, top + sh * 0.5);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-sh, -sw * 0.17, sh * 2, sw * 0.34);
      ctx.restore();
      break;
    }
  }
  ctx.restore();

  // borde de hierro grueso
  shieldPath(ctx, cx, top, sw, sh);
  ctx.lineJoin = 'round';
  ctx.lineWidth = W * 0.05;
  ctx.strokeStyle = ART.ironDark;
  ctx.stroke();

  // inicial de la dinastía
  const initial = (spec.initial || '?').slice(0, 1).toUpperCase();
  ctx.font = `700 ${Math.round(H * 0.32)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(20,17,15,0.85)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = ART.parchment;
  ctx.fillText(initial, cx, top + sh * 0.47);
  ctx.shadowBlur = 0;

  // puntitos de nivel de fortificación bajo el escudo
  if (spec.fortLevel > 0) {
    const dr = W * 0.028;
    const gap = dr * 2.6;
    const total = (spec.fortLevel - 1) * gap;
    const y = bottom + H * 0.05;
    for (let i = 0; i < spec.fortLevel; i++) {
      const x = cx - total / 2 + i * gap;
      ctx.beginPath();
      ctx.arc(x, y, dr, 0, Math.PI * 2);
      ctx.fillStyle = ART.parchment;
      ctx.fill();
      ctx.lineWidth = dr * 0.5;
      ctx.strokeStyle = ART.ironDark;
      ctx.stroke();
    }
  }

  return canvas;
}

/** mojón de tierra sin señor: disco gris con una torre simple. Canvas 128×160. */
export function makeMojonCanvas(): HTMLCanvasElement {
  const W = 128;
  const H = 160;
  const { canvas, ctx } = newCanvas(W, H);
  const cx = W * 0.5;

  // disco de tierra
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.72, W * 0.34, H * 0.14, 0, 0, Math.PI * 2);
  ctx.fillStyle = ART.neutralOwner;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = ART.ironDark;
  ctx.stroke();

  // torre
  const tw = W * 0.26;
  const th = H * 0.42;
  const tx = cx - tw / 2;
  const ty = H * 0.28;
  ctx.fillStyle = '#6b665d';
  ctx.fillRect(tx, ty, tw, th);
  ctx.lineWidth = 5;
  ctx.strokeStyle = ART.ironDark;
  ctx.strokeRect(tx, ty, tw, th);
  // merlones
  const m = tw / 5;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(tx + i * m * 2, ty - m, m, m);
    ctx.strokeRect(tx + i * m * 2, ty - m, m, m);
  }

  return canvas;
}

/** abrevia un número de hombres: 950 → "950", 1234 → "1.2k", 12000 → "12k". */
export function abbrevMen(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  const k = n / 1000;
  if (k < 10) {
    const s = k.toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'k';
  }
  return Math.round(k) + 'k';
}

/** gallardete de guerra de un ejército: asta + banderín + placa con nº de hombres. Canvas 224×160. */
export function makeArmyCanvas(primary: string, menText: string): HTMLCanvasElement {
  const W = 224;
  const H = 160;
  const { canvas, ctx } = newCanvas(W, H);

  // asta
  const px = W * 0.16;
  ctx.strokeStyle = '#2a251f';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px, H * 0.06);
  ctx.lineTo(px, H * 0.94);
  ctx.stroke();

  // banderín triangular
  ctx.beginPath();
  ctx.moveTo(px, H * 0.08);
  ctx.lineTo(px + W * 0.62, H * 0.26);
  ctx.lineTo(px, H * 0.44);
  ctx.closePath();
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ART.ironDark;
  ctx.stroke();

  // placa oscura con nº de hombres
  ctx.font = `700 ${Math.round(H * 0.28)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(menText).width;
  const pad = W * 0.06;
  const plateW = tw + pad * 2;
  const plateH = H * 0.34;
  const plateX = px - plateW * 0.18;
  const plateY = H * 0.56;
  ctx.fillStyle = 'rgba(27,23,22,0.93)';
  ctx.beginPath();
  const rr = plateH * 0.28;
  ctx.roundRect(plateX, plateY, plateW, plateH, rr);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(237,231,214,0.4)';
  ctx.stroke();

  ctx.fillStyle = ART.parchment;
  ctx.fillText(menText, plateX + plateW / 2, plateY + plateH / 2 + 1);

  return canvas;
}
