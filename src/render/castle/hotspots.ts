/**
 * Capa de hotspots: discos HTML con icono + rótulo anclados a posiciones 3D.
 * Cada frame proyecta su ancla del mundo a coordenadas de pantalla y reposiciona
 * el disco (se oculta si queda detrás de la cámara). Estilo de la referencia.
 */
import * as THREE from 'three';
import type { HotspotKey } from './castleModel';
import { el } from './dom';

export interface HotspotDef {
  key: HotspotKey;
  label: string;
  icon: string;
  anchor: THREE.Vector3;
}

export interface HotspotLayer {
  el: HTMLElement;
  update(camera: THREE.Camera, width: number, height: number): void;
  setActive(key: HotspotKey | null): void;
  dispose(): void;
}

export function createHotspotLayer(
  defs: HotspotDef[],
  onActivate: (key: HotspotKey) => void,
): HotspotLayer {
  const layer = el('div', { className: 'rdh-hotspots' });
  const proj = new THREE.Vector3();

  interface Entry { def: HotspotDef; node: HTMLButtonElement }
  const entries: Entry[] = defs.map((def) => {
    const disc = el('span', { className: 'rdh-hotspot__disc', 'aria-hidden': 'true' }, [def.icon]);
    const label = el('span', { className: 'rdh-hotspot__label' }, [def.label]);
    const node = el('button', {
      type: 'button',
      className: `rdh-hotspot${def.key === 'salir' ? ' rdh-hotspot--exit' : ''}`,
      'aria-label': def.label,
      onclick: () => onActivate(def.key),
    }, [disc, label]);
    layer.append(node);
    return { def, node };
  });

  return {
    el: layer,
    update(camera, width, height): void {
      for (const { def, node } of entries) {
        proj.copy(def.anchor).project(camera);
        // detrás de la cámara o fuera del frustum → ocultar
        if (proj.z >= 1 || proj.x < -1.3 || proj.x > 1.3 || proj.y < -1.3 || proj.y > 1.3) {
          if (!node.hidden) node.hidden = true;
          continue;
        }
        if (node.hidden) node.hidden = false;
        const px = (proj.x * 0.5 + 0.5) * width;
        const py = (-proj.y * 0.5 + 0.5) * height;
        node.style.left = `${px.toFixed(1)}px`;
        node.style.top = `${py.toFixed(1)}px`;
      }
    },
    setActive(key): void {
      for (const { def, node } of entries) {
        node.classList.toggle('is-active', def.key === key);
      }
    },
    dispose(): void {
      layer.remove();
    },
  };
}
