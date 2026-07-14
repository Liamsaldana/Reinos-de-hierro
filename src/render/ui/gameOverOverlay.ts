/**
 * Overlay de fin de partida: VICTORIA o LA DINASTÍA HA CAÍDO, últimas 6 líneas
 * de crónica y "Nueva partida" (vuelve al menú sin desmontar el 3D).
 */
import type { GameState } from '../../core/types';
import { el, replaceChildren } from './dom';

export interface GameOverOverlay {
  show(state: GameState): void;
  hide(): void;
}

export function createGameOverOverlay(container: HTMLElement, onNewGame: () => void): GameOverOverlay {
  const overlay = el('div', { className: 'gameover-overlay', 'aria-hidden': 'true' });
  container.append(overlay);

  function hide(): void {
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function show(state: GameState): void {
    const isVictory = state.outcome === 'victory_conquest';
    const title = isVictory ? 'VICTORIA' : 'LA DINASTÍA HA CAÍDO';
    const lines = state.chronicle.slice(-6).reverse();

    replaceChildren(overlay, [
      el('div', { className: 'gameover-panel' }, [
        el('h1', {
          className: `gameover-title${isVictory ? ' gameover-title--victory' : ' gameover-title--defeat'}`,
        }, [title]),
        el('div', { className: 'gameover-chronicle' }, lines.length > 0
          ? lines.map(entry => el('p', {}, [entry.text]))
          : [el('p', { className: 'notice' }, ['Sin crónica que contar.'])]),
        el('button', {
          type: 'button',
          className: 'btn btn--primary',
          onclick: () => { hide(); onNewGame(); },
        }, ['Nueva partida']),
      ]),
    ]);

    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  return { show, hide };
}
