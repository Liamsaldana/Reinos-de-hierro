/**
 * Menú ⚙ arriba-derecha: guardar, exportar, importar y volver al menú.
 */
import type { GameStore } from '../../core/state/store';
import { saveGame, exportSave, importSave } from '../../core/state/persistence';
import { el } from './dom';
import type { ToastStack } from './toast';

export function createSaveMenu(
  container: HTMLElement,
  store: GameStore,
  toast: ToastStack,
  onBackToMenu: () => void,
): void {
  const wrap = el('div', { className: 'save-menu' });
  const dropdown = el('div', { className: 'save-menu__dropdown' });

  let open = false;
  function toggle(force?: boolean): void {
    open = force ?? !open;
    dropdown.classList.toggle('is-visible', open);
  }

  const gearBtn = el('button', {
    type: 'button',
    className: 'icon-btn',
    'aria-label': 'Menú de guardado',
    'aria-haspopup': 'true',
    onclick: (ev: Event) => { ev.stopPropagation(); toggle(); },
  }, ['⚙']);

  document.addEventListener('click', ev => {
    if (open && !wrap.contains(ev.target as Node)) toggle(false);
  });

  const saveBtn = el('button', {
    type: 'button',
    className: 'save-menu__item',
    onclick: () => {
      if (!store.hasGame) return;
      try {
        const meta = saveGame(store.state);
        toast.show(`Partida guardada: ${meta.label}`, 'info');
      } catch (err) {
        toast.show(err instanceof Error ? err.message : String(err), 'warn');
      }
      toggle(false);
    },
  }, ['Guardar']);

  const exportBtn = el('button', {
    type: 'button',
    className: 'save-menu__item',
    onclick: () => {
      if (!store.hasGame) return;
      try {
        const json = exportSave(store.state);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'reinos-de-hierro.json' });
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        toast.show(err instanceof Error ? err.message : String(err), 'warn');
      }
      toggle(false);
    },
  }, ['Exportar']);

  const importInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: 'display:none',
    onchange: (ev: Event) => {
      const target = ev.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      file.text().then(text => {
        try {
          const state = importSave(text);
          store.replaceState(state);
        } catch (err) {
          toast.show(err instanceof Error ? err.message : String(err), 'warn');
        }
      });
      target.value = '';
    },
  }) as HTMLInputElement;

  const importBtn = el('button', {
    type: 'button',
    className: 'save-menu__item',
    onclick: () => { importInput.click(); toggle(false); },
  }, ['Importar']);

  const backBtn = el('button', {
    type: 'button',
    className: 'save-menu__item save-menu__item--danger',
    onclick: () => {
      if (!window.confirm('¿Volver al menú principal? La partida actual queda tal cual, en segundo plano.')) return;
      toggle(false);
      onBackToMenu();
    },
  }, ['Volver al menú']);

  dropdown.append(saveBtn, exportBtn, importBtn, backBtn, importInput);
  wrap.append(gearBtn, dropdown);
  container.append(wrap);
}
