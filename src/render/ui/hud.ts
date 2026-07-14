/**
 * Orquestador del HUD: barra superior, paneles contextuales, guerras, crónica,
 * menú de guardado, modal de batalla y overlay de fin de partida.
 */
import type { GameStore } from '../../core/state/store';
import type { WorldBridge } from '../../core/types';
import { endTurn } from '../../core/systems/turn';
import { createTopBar, type ResourceDelta } from './topBar';
import { createLeftPanel } from './leftPanel';
import { createWarsPanel } from './warsPanel';
import { createChronicleDrawer } from './chronicleDrawer';
import { createSaveMenu } from './saveMenu';
import { createBattleModal } from './battleModal';
import { createGameOverOverlay } from './gameOverOverlay';
import { el } from './dom';
import type { ToastStack } from './toast';

export interface Hud {
  show(): void;
  hide(): void;
}

export function createHud(
  root: HTMLElement,
  store: GameStore,
  getWorld: () => WorldBridge | null,
  toast: ToastStack,
  onBackToMenu: () => void,
): Hud {
  const hudRoot = el('div', { className: 'hud', 'aria-hidden': 'true' });
  root.append(hudRoot);

  let lastDelta: ResourceDelta | null = null;

  const topBar = createTopBar(hudRoot, store, () => handleEndTurn());
  const leftPanel = createLeftPanel(hudRoot, store, getWorld, toast);
  const warsPanel = createWarsPanel(hudRoot, store, toast);
  const chronicle = createChronicleDrawer(hudRoot, store);
  createSaveMenu(hudRoot, store, toast, onBackToMenu);
  const battleModal = createBattleModal(hudRoot, store);
  const gameOver = createGameOverOverlay(hudRoot, () => onBackToMenu());

  function handleEndTurn(): void {
    if (!store.hasGame) return;
    const before = store.state.factions[store.state.playerFactionId];
    const beforeSnapshot = { gold: before.gold, food: before.foodStock };

    const rng = store.rng();
    const summary = store.mutate(s => endTurn(s, rng), { type: 'turn-ended' });

    for (const msg of summary.messages) toast.show(msg, 'info');

    const playerId = store.state.playerFactionId;
    const after = store.state.factions[playerId];
    lastDelta = after
      ? { gold: after.gold - beforeSnapshot.gold, food: after.foodStock - beforeSnapshot.food }
      : null;
    topBar.refresh(lastDelta);

    const playerBattle = summary.battles.find(
      b => b.attacker.factionId === playerId || b.defender.factionId === playerId,
    );
    if (playerBattle) battleModal.show(playerBattle);

    if (summary.gameOver || store.state.outcome !== 'ongoing') {
      gameOver.show(store.state);
    }
  }

  store.subscribe((state, ev) => {
    switch (ev.type) {
      case 'state-replaced':
        lastDelta = null;
        topBar.refresh(null);
        if (state.outcome !== 'ongoing') gameOver.show(state);
        else gameOver.hide();
        break;
      case 'economy-changed':
      case 'map-changed':
        lastDelta = null;
        topBar.refresh(null);
        break;
      case 'turn-ended':
        // el resumen ya refrescó la barra con el delta en handleEndTurn().
        break;
      case 'battle':
        battleModal.show(ev.report);
        break;
      case 'game-over':
        gameOver.show(state);
        break;
      default:
        break;
    }
  });

  return {
    show(): void {
      hudRoot.classList.add('is-visible');
      hudRoot.setAttribute('aria-hidden', 'false');
      if (store.hasGame) topBar.refresh(lastDelta);
      leftPanel.refresh();
      warsPanel.refresh();
      chronicle.refresh();
    },
    hide(): void {
      hudRoot.classList.remove('is-visible');
      hudRoot.setAttribute('aria-hidden', 'true');
    },
  };
}
