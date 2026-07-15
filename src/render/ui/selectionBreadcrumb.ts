/**
 * Línea fija sobre el panel izquierdo: qué tienes seleccionado, siempre a
 * la vista. Responde a "no sabes exactamente qué está pasando ni nada" —
 * aquí nunca se pierde de vista qué se está mirando.
 */
import type { GameStore } from '../../core/state/store';
import type { GameState, Selection } from '../../core/types';
import { el, replaceChildren } from './dom';

export interface SelectionBreadcrumb {
  refresh(): void;
}

interface Located { name: string; place: string; }

function locate(state: GameState, sel: Selection): Located | null {
  if (!sel) return null;
  if (sel.kind === 'province') {
    const p = state.provinces.find(pp => pp.id === sel.id);
    if (!p) return null;
    return { name: p.settlement.name, place: p.name };
  }
  const army = state.armies[sel.id];
  if (!army) return null;
  const p = state.provinces.find(pp => pp.id === army.provinceId);
  return { name: army.name, place: p ? p.name : '—' };
}

export function createSelectionBreadcrumb(container: HTMLElement, store: GameStore): SelectionBreadcrumb {
  const bar = el('div', {
    className: 'selection-breadcrumb', 'aria-live': 'polite', 'aria-atomic': 'true',
  });
  container.append(bar);

  function render(): void {
    if (!store.hasGame) { bar.classList.remove('is-visible'); return; }
    bar.classList.add('is-visible');
    const located = locate(store.state, store.selection);
    replaceChildren(bar, [
      el('span', { className: 'selection-breadcrumb__icon', 'aria-hidden': 'true' }, ['◆']),
      located
        ? el('span', { className: 'selection-breadcrumb__text' }, [
          'Seleccionado: ',
          el('strong', {}, [located.name]),
          ` · ${located.place}`,
        ])
        : el('span', { className: 'selection-breadcrumb__text selection-breadcrumb__text--empty' }, [
          'Sin selección — haz clic en una provincia o una hueste.',
        ]),
    ]);
  }

  store.subscribe((_state, ev) => {
    if (
      ev.type === 'selection' || ev.type === 'state-replaced'
      || ev.type === 'map-changed' || ev.type === 'turn-ended'
    ) render();
  });

  return { refresh: render };
}
