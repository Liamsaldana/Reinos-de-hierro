/**
 * Cajón lateral de crónica: botón abajo-izquierda que despliega
 * state.chronicle (más reciente primero).
 */
import type { GameStore } from '../../core/state/store';
import { SEASON_NAMES, seasonOf, yearOf } from '../../core/types';
import { el, clear, replaceChildren } from './dom';
import { CHRONICLE_ICON } from './format';

export interface ChronicleDrawer {
  refresh(): void;
}

export function createChronicleDrawer(container: HTMLElement, store: GameStore): ChronicleDrawer {
  const list = el('div', { className: 'chronicle-list' });
  const drawer = el('div', { className: 'chronicle-drawer', 'aria-hidden': 'true' }, [
    el('div', { className: 'chronicle-drawer__header' }, [
      el('h2', { className: 'panel-title' }, ['Crónica']),
      el('button', {
        className: 'modal-close',
        'aria-label': 'Cerrar crónica',
        onclick: () => toggle(false),
      }, ['×']),
    ]),
    list,
  ]);

  let open = false;
  function toggle(force?: boolean): void {
    open = force ?? !open;
    drawer.classList.toggle('is-visible', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) render();
  }

  const launcher = el('button', {
    type: 'button',
    className: 'chronicle-launcher',
    onclick: () => toggle(),
  }, ['Crónica']);

  container.append(launcher, drawer);

  function render(): void {
    if (!store.hasGame) { clear(list); return; }
    const entries = [...store.state.chronicle].reverse();
    if (entries.length === 0) {
      replaceChildren(list, [el('p', { className: 'notice' }, ['Aún no hay crónica que contar.'])]);
      return;
    }
    replaceChildren(list, entries.map(entry => el('div', { className: 'chronicle-entry' }, [
      el('span', { className: 'chronicle-entry__icon', 'aria-hidden': 'true' }, [CHRONICLE_ICON[entry.kind]]),
      el('div', { className: 'chronicle-entry__body' }, [
        el('p', { className: 'chronicle-entry__date' }, [
          `${SEASON_NAMES[seasonOf(entry.turn)]} · Año ${yearOf(entry.turn)}`,
        ]),
        el('p', { className: 'chronicle-entry__text' }, [entry.text]),
      ]),
    ])));
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'state-replaced') {
      open = false;
      drawer.classList.remove('is-visible');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (open && (ev.type === 'turn-ended' || ev.type === 'state-replaced' || ev.type === 'map-changed')) render();
  });

  return { refresh: render };
}
