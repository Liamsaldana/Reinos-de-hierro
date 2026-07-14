/**
 * Arranque y ensamblado de escenas (GDD §14.2): el core es la verdad,
 * el mundo 3D y la UI leen estado y envían acciones a través del store.
 */
import './base.css';
import { store } from './core/state/store';
import { WorldScene } from './render/world/scene';
import { initUI } from './render/ui/ui';
import type { GameState } from './core/types';

let world: WorldScene | null = null;
const appEl = document.getElementById('app');
if (!appEl) throw new Error('Falta #app en index.html');

function ensureWorld(state: GameState): void {
  if (!world) {
    world = new WorldScene(appEl!, state);
    world.onSelect = sel => store.setSelection(sel);
  } else {
    world.setState(state);
  }
}

store.subscribe((state, ev) => {
  switch (ev.type) {
    case 'state-replaced':
      ensureWorld(state);
      world!.refresh();
      break;
    case 'turn-ended':
    case 'battle':
    case 'map-changed':
    case 'economy-changed':
      world?.refresh();
      break;
    case 'selection':
      world?.setSelected(ev.selection);
      break;
    case 'game-over':
      break;
  }
});

initUI(store, () => world);
