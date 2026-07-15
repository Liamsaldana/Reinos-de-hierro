/**
 * Reinos de Hierro — interfaz HTML/CSS sobre el canvas (GDD §13.2).
 * Punto de entrada único: initUI(store, getWorld). Monta todo dentro de
 * #ui-root. No importa three ni src/render/world — solo conoce WorldBridge
 * por interfaz (core/types.ts).
 */
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/alegreya/400.css';
import '@fontsource/alegreya/500.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya/400-italic.css';
import './styles.css';

import type { GameStore } from '../../core/state/store';
import type { WorldBridge } from '../../core/types';
import { createToastStack } from './toast';
import { createMainMenu } from './mainMenu';
import { createHud } from './hud';

export function initUI(store: GameStore, getWorld: () => WorldBridge | null): void {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('Falta #ui-root en index.html');

  const toast = createToastStack(root);
  const menu = createMainMenu(root, store, toast);
  const hud = createHud(root, store, getWorld, toast, () => showMenu());

  function showMenu(): void {
    hud.hide();
    menu.show();
  }

  function showHud(): void {
    menu.hide();
    hud.show();
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'state-replaced') showHud();
  });

  if (store.hasGame) showHud(); else showMenu();
}
