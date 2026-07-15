/**
 * Pila de toasts abajo-derecha: auto-dismiss 6s, cierre manual, máx 5 visibles.
 */
import { el } from './dom';

export type ToastKind = 'info' | 'warn';

export interface ToastStack {
  show(message: string, kind?: ToastKind): void;
}

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 6000;

export function createToastStack(root: HTMLElement): ToastStack {
  const container = el('div', { className: 'toast-stack', 'aria-live': 'polite' });
  root.append(container);

  function prune(): void {
    while (container.children.length > MAX_VISIBLE) {
      container.removeChild(container.firstElementChild!);
    }
  }

  function show(message: string, kind: ToastKind = 'info'): void {
    if (!message) return;
    const toast = el('div', { className: `toast toast--${kind}` }, [
      el('span', { className: 'toast__text' }, [message]),
      el('button', {
        className: 'toast__close',
        'aria-label': 'Cerrar aviso',
        onclick: () => toast.remove(),
      }, ['×']),
    ]);
    container.append(toast);
    prune();
    window.setTimeout(() => toast.remove(), AUTO_DISMISS_MS);
  }

  return { show };
}
