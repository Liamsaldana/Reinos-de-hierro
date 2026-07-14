/**
 * Orquestador del HUD: barra superior, paneles contextuales, guerras, crónica,
 * menú de guardado, modal de batalla y overlay de fin de partida.
 */
import type { GameStore } from '../../core/state/store';
import type { WorldBridge } from '../../core/types';
import { seasonOf } from '../../core/types';
import { endTurn } from '../../core/systems/turn';
import { createTopBar, type ResourceDelta } from './topBar';
import { createLeftPanel } from './leftPanel';
import { createWarsPanel } from './warsPanel';
import { createChronicleDrawer } from './chronicleDrawer';
import { createSaveMenu } from './saveMenu';
import { createBattleModal } from './battleModal';
import { createGameOverOverlay } from './gameOverOverlay';
import { createStatusStrip } from './statusStrip';
import { createSelectionBreadcrumb } from './selectionBreadcrumb';
import { createOnboardingTip } from './onboardingTip';
import { createTurnReport } from './turnReport';
import { computeEconomyBreakdown } from './gameQueries';
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
  const statusStrip = createStatusStrip(hudRoot, store, getWorld, () => warsPanel.focus());
  const breadcrumb = createSelectionBreadcrumb(hudRoot, store);
  const leftPanel = createLeftPanel(hudRoot, store, getWorld, toast);
  const warsPanel = createWarsPanel(hudRoot, store, toast);
  const chronicle = createChronicleDrawer(hudRoot, store);
  createSaveMenu(hudRoot, store, toast, onBackToMenu);
  const battleModal = createBattleModal(hudRoot, store);
  const turnReport = createTurnReport(hudRoot, store, getWorld);
  const onboardingTip = createOnboardingTip(hudRoot, store);
  const gameOver = createGameOverOverlay(hudRoot, () => onBackToMenu());

  /**
   * Informe del turno, en vez de un chorro de toasts sueltos: la economía se
   * desglosa con las MISMAS fórmulas puras de core/systems/economy.ts, leídas
   * justo antes de cerrar el turno (evidencia real, no un resumen inventado).
   */
  function handleEndTurn(): void {
    if (!store.hasGame) return;
    const state = store.state;
    const playerId = state.playerFactionId;
    const before = state.factions[playerId];
    const beforeSnapshot = { gold: before.gold, food: before.foodStock, manpower: before.manpower };
    const turnEnded = state.turn;
    const economy = computeEconomyBreakdown(state, playerId, seasonOf(state.turn));
    const chronicleBefore = state.chronicle.length;

    const rng = store.rng();
    const summary = store.mutate(s => endTurn(s, rng), { type: 'turn-ended' });

    const after = store.state.factions[playerId];
    lastDelta = after
      ? {
        gold: after.gold - beforeSnapshot.gold,
        food: after.foodStock - beforeSnapshot.food,
        manpower: after.manpower - beforeSnapshot.manpower,
        economy,
      }
      : null;
    topBar.refresh(lastDelta);

    if (summary.gameOver || store.state.outcome !== 'ongoing') {
      gameOver.show(store.state);
      return;
    }

    const newChronicle = store.state.chronicle.slice(chronicleBefore);
    turnReport.show(
      { turnEnded, summary, economy, newChronicle },
      report => battleModal.show(report),
    );
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
      statusStrip.refresh();
      breadcrumb.refresh();
      leftPanel.refresh();
      warsPanel.refresh();
      chronicle.refresh();
      onboardingTip.refresh();
    },
    hide(): void {
      hudRoot.classList.remove('is-visible');
      hudRoot.setAttribute('aria-hidden', 'true');
    },
  };
}
