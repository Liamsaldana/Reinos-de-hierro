/**
 * Reinos de Hierro — LA SEDE DE PODER (vista de castillo).
 *
 * Escena Three.js a pantalla completa con un castillo procedural protagonista y
 * HOTSPOTS flotantes (Sala del Trono / Cuartel / Tesorería / Crónica / Salir)
 * al estilo de la referencia GoT. Aplica a la capital del jugador y de cualquier
 * reino visitable; en corte extranjera los paneles son de solo lectura.
 *
 * API PÚBLICA (estable):
 *   openCastleView({ container, store, factionId, onClose }) → CastleViewHandle
 *
 * Frontera de módulos: importa `three`, el store y los sistemas/contenido del
 * core (read-only) y sus propios submódulos de render. No toca main.ts ni la UI.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GameStore } from '../../core/state/store';
import type { FactionId, GameState, Province } from '../../core/types';
import { seasonOf } from '../../core/types';
import { buildCastleModel, type CastleModel, type HotspotKey } from './castleModel';
import { createHotspotLayer, type HotspotLayer } from './hotspots';
import { createPanels, type PanelController, type PanelKey } from './panels';
import { ensureCastleStyle } from './styles';
import { el } from './dom';

export interface CastleViewHandle {
  destroy(): void;
}

interface OpenOpts {
  container: HTMLElement;
  store: GameStore;
  factionId: FactionId;
  onClose: () => void;
}

const HOTSPOT_META: { key: HotspotKey; label: string; icon: string }[] = [
  { key: 'trono', label: 'Sala del Trono', icon: '♛' },
  { key: 'cuartel', label: 'Cuartel', icon: '⚔' },
  { key: 'tesoreria', label: 'Tesorería', icon: '⛁' },
  { key: 'cronica', label: 'Crónica', icon: '✦' },
  { key: 'salir', label: 'Salir', icon: '⤺' },
];

function findCapital(state: GameState, factionId: FactionId): Province | null {
  const owned = state.provinces.filter(p => p.ownerId === factionId);
  if (owned.length === 0) return null;
  // prefiere la capital de reino (nivel 4); si no, el asentamiento mayor.
  return owned.reduce((best, p) => (p.settlement.level > best.settlement.level ? p : best), owned[0]);
}

export function openCastleView(opts: OpenOpts): CastleViewHandle {
  const { container, store, factionId, onClose } = opts;
  ensureCastleStyle();

  const state = store.state;
  const faction = state.factions[factionId];
  const capital = findCapital(state, factionId);
  const readOnly = factionId !== state.playerFactionId;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- DOM
  const root = el('div', { className: 'rdh-castle', role: 'dialog', 'aria-label': 'Sede de poder' });

  const reinoName = faction ? faction.name : 'Reino sin señor';
  const capitalName = capital ? capital.settlement.name : 'Sede sin capital';
  const subtitle = readOnly ? 'Corte extranjera' : (faction ? `Casa ${faction.dynastyName}` : '');
  const titlebar = el('div', { className: 'rdh-castle__titlebar' }, [
    el('h1', { className: 'rdh-castle__title' }, [`${reinoName} — ${capitalName}`]),
    subtitle ? el('span', { className: 'rdh-castle__subtitle' }, [subtitle]) : null,
  ]);

  const exitBtn = el('button', {
    type: 'button',
    className: 'rdh-castle__exit',
    'aria-label': 'Volver al mapa',
    onclick: () => handleExit(),
  }, ['⤺ Volver al mapa']);

  const hint = el('div', { className: 'rdh-castle__hint' }, [
    'Arrastra para orbitar · rueda para acercar · Esc para volver',
  ]);

  container.appendChild(root);

  // ---------------------------------------------------------------- Three.js
  const w0 = Math.max(1, container.clientWidth || window.innerWidth);
  const h0 = Math.max(1, container.clientHeight || window.innerHeight);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w0, h0, false);
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  root.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, w0 / h0, 0.1, 320);
  camera.position.set(0, 11, 27);
  camera.lookAt(0, 4.5, 0);

  // modelo procedural (castillo + entorno + partículas)
  const model: CastleModel = buildCastleModel({
    colorPrimary: faction ? faction.colorPrimary : '#6b665d',
    colorSecondary: faction ? faction.colorSecondary : '#3a2f24',
    bannerSeed: faction ? faction.bannerSeed : 1,
    initial: (faction ? faction.dynastyName || faction.name : '?').slice(0, 1),
    season: seasonOf(state.turn),
    terrain: capital ? capital.terrain : 'plains',
    seed: state.seed ^ ((capital ? capital.id : 0) * 0x77),
    reducedMotion,
  });
  scene.add(model.group);

  scene.background = model.skyColor.clone();
  scene.fog = new THREE.Fog(model.skyColor.clone(), 48, 150);

  // luces: ambiente cálido + sol al noroeste + relleno frío tenue + hogar del torreón
  const ambient = new THREE.AmbientLight(new THREE.Color('#d8cbb4'), 0.74);
  const sun = new THREE.DirectionalLight(new THREE.Color(reducedMotion ? '#ffe8c4' : '#ffe3b8'), 1.05);
  sun.position.set(-24, 30, 18);
  const fill = new THREE.DirectionalLight(new THREE.Color('#41505c'), 0.32);
  fill.position.set(20, 14, -22);
  const hearth = new THREE.PointLight(new THREE.Color('#ffb765'), 0.5, 26, 2);
  hearth.position.set(0, 6, 2.5);
  scene.add(ambient, sun, fill, hearth);

  // ---------------------------------------------------------------- controles
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 15;
  controls.maxDistance = 48;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = 1.34; // nunca bajo el suelo
  controls.target.set(0, 4.5, 0);
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.5;

  const stopAutoRotate = (): void => { controls.autoRotate = false; };
  controls.addEventListener('start', stopAutoRotate);

  // ---------------------------------------------------------------- hotspots + paneles
  const hotspotDefs = HOTSPOT_META.map(m => ({ ...m, anchor: model.anchors[m.key] }));
  const hotspots: HotspotLayer = createHotspotLayer(hotspotDefs, key => onHotspot(key));

  const panels: PanelController = createPanels(
    store, factionId, capital ? capital.id : null, readOnly,
  );

  root.appendChild(hotspots.el);
  root.appendChild(panels.el);
  root.appendChild(titlebar);
  root.appendChild(exitBtn);
  root.appendChild(hint);

  function onHotspot(key: HotspotKey): void {
    if (key === 'salir') { handleExit(); return; }
    const pk = key as PanelKey;
    if (panels.current() === pk) {
      panels.close();
      hotspots.setActive(null);
    } else {
      panels.open(pk);
      hotspots.setActive(pk);
    }
  }

  // cerrar panel también limpia el hotspot activo (el botón × del panel)
  panels.el.addEventListener('click', ev => {
    const target = ev.target as HTMLElement;
    if (target.closest('.rdh-panel__close')) hotspots.setActive(null);
  });

  // ---------------------------------------------------------------- store: refrescos
  const unsub = store.subscribe((_s, ev) => {
    if (ev.type === 'state-replaced' || ev.type === 'game-over') { handleExit(); return; }
    if (
      ev.type === 'economy-changed' || ev.type === 'map-changed' ||
      ev.type === 'turn-ended' || ev.type === 'battle'
    ) {
      panels.refresh();
    }
  });

  // ---------------------------------------------------------------- teclado
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      if (panels.isOpen()) { panels.close(); hotspots.setActive(null); }
      else handleExit();
    }
  };
  window.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- resize
  let width = w0;
  let height = h0;
  const applySize = (): void => {
    width = Math.max(1, container.clientWidth || window.innerWidth);
    height = Math.max(1, container.clientHeight || window.innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(container);

  // ---------------------------------------------------------------- bucle
  let raf = 0;
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    controls.update();
    model.update(now, reducedMotion);
    renderer.render(scene, camera);
    hotspots.update(camera, width, height);
  };
  raf = requestAnimationFrame(tick);

  // ---------------------------------------------------------------- cierre / dispose
  let closed = false;
  function handleExit(): void {
    if (closed) return;
    closed = true;
    onClose();
  }

  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    closed = true;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKey, true);
    unsub();
    controls.removeEventListener('start', stopAutoRotate);
    controls.dispose();
    hotspots.dispose();
    panels.dispose();
    model.dispose();
    scene.clear();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { destroy };
}
