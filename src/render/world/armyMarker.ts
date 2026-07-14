/**
 * Marcador de ejército: asta de madera con gallardete del color de la casa,
 * tres siluetas de soldado (billboards) y una placa con el nº de hombres. Sustituye
 * al sprite plano único. Los billboards se agrupan; la escena marca los pickables
 * con userData.armyId.
 */
import * as THREE from 'three';
import { ART } from './palette';
import { makeSoldierCanvas, makeMenPlateCanvas } from './heraldry';

export interface ArmyMarker {
  group: THREE.Group;
  pickables: THREE.Object3D[];
  setSelected(sel: boolean): void;
  dispose(): void;
}

const POLE_H = 4.4;

function makePennantCanvas(primary: string): HTMLCanvasElement {
  const W = 128;
  const H = 80;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  ctx.beginPath();
  ctx.moveTo(2, 6);
  ctx.lineTo(W - 6, H * 0.34);
  ctx.lineTo(2, H * 0.62);
  ctx.closePath();
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = ART.ironDark;
  ctx.stroke();
  return canvas;
}

export function buildArmyMarker(
  primary: string,
  menText: string,
  texture: (key: string, make: () => HTMLCanvasElement) => THREE.Texture,
  factionId: string,
): ArmyMarker {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];

  // asta de madera
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, POLE_H, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ART.bark) });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, POLE_H / 2, 0);
  group.add(pole);
  pickables.push(pole);

  const mkSprite = (tex: THREE.Texture, w: number, h: number): THREE.Sprite => {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.scale.set(w, h, 1);
    return s;
  };

  // gallardete
  const pennantTex = texture(`pennant:${factionId}`, () => makePennantCanvas(primary));
  const pennant = mkSprite(pennantTex, 2.1, 1.3);
  pennant.position.set(0.95, POLE_H - 0.6, 0);
  group.add(pennant);
  pickables.push(pennant);

  // tres soldados
  const soldierTex = texture(`soldier:${factionId}`, () => makeSoldierCanvas(primary));
  const offs = [-1.05, 0, 1.05];
  for (let i = 0; i < offs.length; i++) {
    const sol = mkSprite(soldierTex, 1.42, 2.05);
    sol.position.set(offs[i], 1.0, i === 1 ? 0.4 : 0);
    group.add(sol);
    pickables.push(sol);
  }

  // placa de hombres
  const plateTex = texture(`menplate:${menText}`, () => makeMenPlateCanvas(menText));
  const plate = mkSprite(plateTex, 2.6, 1.18);
  plate.position.set(0, 2.95, 0);
  group.add(plate);
  pickables.push(plate);

  return {
    group,
    pickables,
    setSelected(sel: boolean): void {
      const s = sel ? 1.16 : 1;
      group.scale.set(s, s, s);
    },
    dispose(): void {
      poleGeo.dispose();
      poleMat.dispose();
      pennant.material.dispose();
      plate.material.dispose();
      for (const p of pickables) {
        if (p instanceof THREE.Sprite && p !== pennant && p !== plate) p.material.dispose();
      }
      group.clear();
    },
  };
}
