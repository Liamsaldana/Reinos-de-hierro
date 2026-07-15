/**
 * Flujo de eventos con decisiones (integrador, GDD §12): tras cada fin de
 * turno se tiran eventos y el jugador decide en un modal propio (DOM
 * autónomo, sin tocar los módulos del HUD). Consecuencias → crónica + toast.
 */
import type { GameStore } from '../core/state/store';
import { rollTurnEvents, applyEventChoice, type PendingEvent } from '../core/events';

const INK = '#1B1716';
const PARCHMENT = '#EDEBDE';
const BLOOD = '#810100';
const HAIRLINE = 'rgba(237,235,222,.14)';

function showEventModal(store: GameStore, ev: PendingEvent, onDone: () => void): void {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '96', background: 'rgba(20,17,15,.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: INK, border: `1px solid ${HAIRLINE}`, borderRadius: '2px',
    padding: '26px 30px', maxWidth: '520px', color: PARCHMENT,
    fontFamily: 'Alegreya, Georgia, serif',
  } as Partial<CSSStyleDeclaration>);

  const eyebrow = document.createElement('div');
  eyebrow.textContent = 'SUCESO DEL REINO';
  Object.assign(eyebrow.style, {
    font: '600 10px Cinzel, Georgia, serif', letterSpacing: '.24em', opacity: '.6',
    marginBottom: '10px', textTransform: 'uppercase',
  } as Partial<CSSStyleDeclaration>);

  const h = document.createElement('h2');
  h.textContent = ev.title;
  Object.assign(h.style, {
    font: '700 21px Cinzel, Georgia, serif', letterSpacing: '.05em', margin: '0 0 12px',
  } as Partial<CSSStyleDeclaration>);

  const p = document.createElement('p');
  p.textContent = ev.text;
  Object.assign(p.style, {
    lineHeight: '1.55', margin: '0 0 18px', fontStyle: 'italic', opacity: '.92',
  } as Partial<CSSStyleDeclaration>);

  const btns = document.createElement('div');
  Object.assign(btns.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
  } as Partial<CSSStyleDeclaration>);

  ev.choices.forEach((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      background: i === 0 ? BLOOD : 'transparent',
      color: PARCHMENT, border: `1px solid ${i === 0 ? BLOOD : HAIRLINE}`,
      borderRadius: '2px', padding: '10px 14px', cursor: 'pointer',
      font: '500 15px Alegreya, Georgia, serif', textAlign: 'left',
    } as Partial<CSSStyleDeclaration>);
    b.addEventListener('mouseenter', () => { b.style.borderColor = PARCHMENT; });
    b.addEventListener('mouseleave', () => { b.style.borderColor = i === 0 ? BLOOD : HAIRLINE; });
    b.addEventListener('click', () => {
      const rng = store.rng();
      const lines = store.mutate(s => applyEventChoice(s, rng, ev, i), { type: 'economy-changed' });
      backdrop.remove();
      const consequence = document.createElement('div');
      consequence.setAttribute('role', 'status');
      consequence.textContent = lines.join(' ');
      Object.assign(consequence.style, {
        position: 'fixed', left: '50%', bottom: '90px', transform: 'translateX(-50%)',
        background: INK, color: PARCHMENT, border: `1px solid ${HAIRLINE}`,
        borderRadius: '2px', padding: '10px 16px', zIndex: '96', maxWidth: '620px',
        font: '500 14px Alegreya, Georgia, serif', pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(consequence);
      setTimeout(() => consequence.remove(), 7000);
      onDone();
    });
    btns.appendChild(b);
  });

  box.append(eyebrow, h, p, btns);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
}

/** Encadena los modales de los eventos del turno, uno tras otro. */
function presentEvents(store: GameStore, events: PendingEvent[], idx = 0): void {
  if (idx >= events.length) return;
  showEventModal(store, events[idx], () => presentEvents(store, events, idx + 1));
}

/**
 * Engancha el flujo: en cada 'turn-ended' tira hasta 2 eventos y los presenta.
 * Se llama una vez desde main.ts.
 */
export function initEventFlow(store: GameStore): void {
  store.subscribe((state, evt) => {
    if (evt.type !== 'turn-ended') return;
    if (state.outcome !== 'ongoing') return;
    const rng = store.rng();
    const events = rollTurnEvents(state, rng);
    if (events.length > 0) {
      // pequeño respiro para que el informe del turno se pinte primero
      setTimeout(() => presentEvents(store, events), 350);
    }
  });
}
