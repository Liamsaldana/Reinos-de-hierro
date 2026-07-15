/**
 * Rótulos del mapa dibujados en canvas (Georgia serif, versalitas, tracking,
 * tinta pergamino con sombra suave), como los nombres flotantes de un mapa
 * político. Dos escalas con LOD por distancia de cámara:
 *   - REGIÓN: grande y muy espaciado, aparece en zoom lejano,
 *   - PROVINCIA: pequeño, aparece en zoom medio/cercano.
 */
import * as THREE from 'three';
import type { Province } from '../../core/types';
import { ART } from './palette';
import { LandField, type RegionInfo } from './landfield';

interface LabelSprite {
  sprite: THREE.Sprite;
  kind: 'region' | 'province';
}

function makeLabelCanvas(text: string, fontPx: number, tracking: number, weight: number): { canvas: HTMLCanvasElement; aspect: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  const upper = text.toUpperCase();
  const font = `${weight} ${fontPx}px Georgia, 'Times New Roman', serif`;
  ctx.font = font;
  ctx.letterSpacing = `${tracking}px`;
  const metrics = ctx.measureText(upper);
  const padX = fontPx * 0.9;
  const padY = fontPx * 0.7;
  const w = Math.ceil(metrics.width + padX * 2);
  const h = Math.ceil(fontPx * 1.5 + padY);
  canvas.width = w;
  canvas.height = h;

  ctx.font = font;
  ctx.letterSpacing = `${tracking}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // sombra suave para legibilidad sobre cualquier terreno
  ctx.shadowColor = 'rgba(9,12,14,0.9)';
  ctx.shadowBlur = fontPx * 0.35;
  ctx.shadowOffsetY = fontPx * 0.05;
  ctx.fillStyle = ART.parchment;
  ctx.fillText(upper, w / 2, h / 2);
  // segundo trazo fino para dar cuerpo sin brillo
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, fontPx * 0.02);
  ctx.strokeStyle = 'rgba(27,23,22,0.55)';
  ctx.strokeText(upper, w / 2, h / 2);

  return { canvas, aspect: w / h };
}

function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

export class LabelLayer {
  readonly group = new THREE.Group();
  private readonly labels: LabelSprite[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];
  private readonly maxAniso: number;

  constructor(
    provinces: Province[],
    sampleHeight: (x: number, z: number) => number,
    maxLandHeight: number,
    maxAniso: number,
  ) {
    this.group.name = 'labels';
    this.maxAniso = maxAniso;

    const regions: RegionInfo[] = LandField.regions(provinces);
    for (const region of regions) {
      const y = maxLandHeight + 11;
      this.addLabel(region.name, region.center[0], y, region.center[1], 'region', 60, 14, 600, 5.6);
    }

    for (const p of provinces) {
      const [x, z] = p.center;
      const y = sampleHeight(x, z) + 4.2;
      this.addLabel(p.name, x, y, z, 'province', 34, 5, 600, 2.4);
    }
  }

  private addLabel(
    text: string,
    x: number,
    y: number,
    z: number,
    kind: 'region' | 'province',
    fontPx: number,
    tracking: number,
    weight: number,
    worldH: number,
  ): void {
    const { canvas, aspect } = makeLabelCanvas(text, fontPx, tracking, weight);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    tex.needsUpdate = true;
    this.textures.push(tex);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: kind === 'province', // los rótulos de región flotan por encima
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(worldH * aspect, worldH, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = kind === 'region' ? 20 : 12;
    this.group.add(sprite);
    this.labels.push({ sprite, kind });
  }

  /** cruza la opacidad región↔provincia según la distancia de cámara al objetivo. */
  update(camDist: number): void {
    const regionOpacity = smoothstep(78, 118, camDist) * 0.96;
    const provinceOpacity = (1 - smoothstep(66, 104, camDist)) * 0.94;
    for (const l of this.labels) {
      const o = l.kind === 'region' ? regionOpacity : provinceOpacity;
      const mat = l.sprite.material as THREE.SpriteMaterial;
      mat.opacity = o;
      l.sprite.visible = o > 0.02;
    }
  }

  dispose(): void {
    for (const l of this.labels) l.sprite.material.dispose();
    for (const t of this.textures) t.dispose();
    this.labels.length = 0;
    this.textures.length = 0;
    this.group.clear();
  }
}
