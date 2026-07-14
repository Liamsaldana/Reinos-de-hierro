/**
 * Onboarding mínimo: caja discreta que solo aparece en la primera partida
 * (turno 0, sin selección) y se autodescarta al elegir algo, terminar el
 * turno, o pulsar su cierre. No vuelve a aparecer en esa partida.
 */
import type { GameStore } from '../../core/state/store';
import { el } from './dom';

export interface OnboardingTip {
  refresh(): void;
}

export function createOnboardingTip(container: HTMLElement, store: GameStore): OnboardingTip {
  let dismissed = false;

  const box = el('div', { className: 'onboarding-tip', 'aria-hidden': 'true' }, [
    el('p', {}, [
      'Consejo: haz clic en tu capital para empezar. El botón ⚙ (arriba a la derecha) guarda la partida.',
    ]),
    el('button', {
      type: 'button',
      className: 'onboarding-tip__close',
      'aria-label': 'Descartar consejo',
      onclick: () => { dismissed = true; render(); },
    }, ['×']),
  ]);
  container.append(box);

  function render(): void {
    const show = !dismissed && store.hasGame && store.state.turn === 0 && !store.selection;
    box.classList.toggle('is-visible', show);
    box.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'state-replaced') { dismissed = false; render(); return; }
    if (ev.type === 'selection' || ev.type === 'turn-ended') render();
  });

  return { refresh: render };
}
