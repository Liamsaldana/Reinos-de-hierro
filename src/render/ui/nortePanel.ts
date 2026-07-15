/**
 * EL PANEL DEL NORTE (Fase 3, GDD §2.5, §13.2) — el aviso discreto de que el
 * mito despierta. Vive bajo la barra superior, arriba a la derecha, en el mismo
 * lenguaje de "lujo oscuro × crimson-noir" del resto del HUD (hierro, hairline,
 * --blood solo como acento). Dos estados:
 *
 *   · PRESAGIOS (presagios > 0, aún sin escarcha): un galón sobrio con el copo
 *     ❄ y el último presagio narrado. Solo inquietud, ninguna acción.
 *   · LARGA ESCARCHA (escarchaActive): una banda roja-sangre que pulsa sobria,
 *     el contador de provincias pálidas, el botón de la GRAN TREGUA (con
 *     confirmación en dos pasos) y, si la selección es un ejército propio
 *     elegible, el botón de EQUIPAR VIDRIO ÍGNEO.
 *
 * Igual que `techPanel`/`castleFlow`, se monta directo en `document.body` (fuera
 * de #ui-root) con su hoja de estilos inyectada una sola vez. Punto de entrada
 * único: `initNortePanel(store)` desde `main.ts`. NO muta el estado mítico para
 * leerlo (nunca llama `ensureMythic`): lee `state.mythic` a la defensiva.
 */
import type { GameStore } from '../../core/state/store';
import {
  PALIDOS_FACTION_ID, PRESAGIO_CHAIN, canEquipVidrio, equipVidrio, sellarGranTregua,
} from '../../core/mythic';
import { el, fmt, replaceChildren, type Child } from './dom';

const NORTE_STYLE_ID = 'rdh-norte-style';

const NORTE_CSS = `
.rdh-norte {
  --ink: #1B1716;
  --ink-2: #221E1B;
  --parchment: #EDEBDE;
  --blood: #810100;
  --burgundy: #630102;
  --hairline: rgba(237, 235, 222, 0.14);
  --hairline-strong: rgba(237, 235, 222, 0.24);
  position: fixed;
  top: 68px;
  right: 14px;
  z-index: 40;
  width: min(300px, calc(100vw - 28px));
  background: rgba(27, 23, 22, 0.94);
  border: 1px solid var(--hairline);
  outline: 1px solid var(--hairline);
  outline-offset: -5px;
  border-radius: 2px;
  padding: 0.7em 0.85em;
  font-family: 'Alegreya', Georgia, serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--parchment);
  pointer-events: auto;
  display: none;
}
.rdh-norte.is-visible { display: block; }
.rdh-norte *, .rdh-norte *::before, .rdh-norte *::after { box-sizing: border-box; }
.rdh-norte button {
  font-family: 'Cinzel', Georgia, serif;
  color: var(--parchment);
  background: transparent;
  cursor: pointer;
}
.rdh-norte :focus-visible { outline: 2px solid var(--parchment); outline-offset: 2px; }

.rdh-norte__omen-head {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-size: 0.72em;
  opacity: 0.82;
  margin-bottom: 0.4em;
}
.rdh-norte__snow { font-size: 1.1em; opacity: 0.9; }
.rdh-norte__omen-text { font-style: italic; font-size: 0.92em; opacity: 0.9; margin: 0; }

.rdh-norte__escarcha-band {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
  font-size: 0.8em;
  text-align: center;
  padding: 0.5em 0.4em;
  margin: -0.7em -0.85em 0.7em;
  border-bottom: 1px solid var(--blood);
  color: var(--parchment);
  background: rgba(129, 1, 0, 0.18);
  animation: rdh-escarcha-pulse 2.4s ease-in-out infinite;
}
@keyframes rdh-escarcha-pulse {
  0%, 100% { background: rgba(129, 1, 0, 0.14); }
  50% { background: rgba(129, 1, 0, 0.30); }
}
.rdh-norte__count { font-size: 0.9em; opacity: 0.9; margin: 0 0 0.6em; }
.rdh-norte__count strong { font-family: 'Cinzel', Georgia, serif; }

.rdh-norte__msg {
  font-size: 0.82em;
  opacity: 0.88;
  margin: 0 0 0.6em;
  padding: 0.35em 0.5em;
  border: 1px solid var(--hairline);
  border-radius: 2px;
}

.rdh-norte__actions { display: flex; flex-direction: column; gap: 0.45em; }
.rdh-norte__btn {
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.74em;
  text-align: center;
  padding: 0.5em 0.6em;
  border: 1px solid var(--blood);
  border-radius: 2px;
  background: transparent;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
.rdh-norte__btn:hover { background: var(--burgundy); border-color: var(--burgundy); }
.rdh-norte__btn--armed { background: var(--blood); border-color: var(--blood); }

@media (prefers-reduced-motion: reduce) {
  .rdh-norte, .rdh-norte * { animation: none !important; transition: none !important; }
}
`;

function ensureNorteStyle(): void {
  if (document.getElementById(NORTE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = NORTE_STYLE_ID;
  style.textContent = NORTE_CSS;
  document.head.appendChild(style);
}

export function initNortePanel(store: GameStore): void {
  ensureNorteStyle();

  const panel = el('div', {
    className: 'rdh-norte',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'El Norte',
  });
  document.body.appendChild(panel);

  // confirmación en dos pasos de la Gran Tregua; se reinicia en cada re-render.
  let truceArmed = false;
  // último mensaje de acción (equipar / tregua), mostrado inline un momento.
  let lastMsg: string | null = null;

  function doEquip(armyId: string): void {
    if (!store.hasGame) return;
    const res = store.mutate((s) => equipVidrio(s, armyId), { type: 'economy-changed' });
    lastMsg = res.message;
    render();
  }

  function doTruce(): void {
    if (!store.hasGame) return;
    if (!truceArmed) { truceArmed = true; render(); return; }
    const res = store.mutate((s) => sellarGranTregua(s), { type: 'map-changed' });
    truceArmed = false;
    lastMsg = res.message;
    render();
  }

  function render(): void {
    if (!store.hasGame) { panel.classList.remove('is-visible'); return; }
    const state = store.state;
    const m = state.mythic;
    const presagios = m?.presagios ?? 0;
    const escarcha = m?.escarchaActive ?? false;

    if (!m || (presagios <= 0 && !escarcha)) {
      panel.classList.remove('is-visible');
      replaceChildren(panel, []);
      truceArmed = false;
      lastMsg = null;
      return;
    }
    panel.classList.add('is-visible');

    const children: Child[] = [];

    if (escarcha) {
      const palidoProvs = state.provinces.filter((p) => p.ownerId === PALIDOS_FACTION_ID).length;
      const total = state.provinces.length;
      children.push(el('div', { className: 'rdh-norte__escarcha-band' }, ['❄ La Larga Escarcha ❄']));
      children.push(el('p', { className: 'rdh-norte__count' }, [
        'Provincias en manos pálidas: ',
        el('strong', {}, [`${fmt(palidoProvs)} / ${fmt(total)}`]),
      ]));

      if (lastMsg) children.push(el('p', { className: 'rdh-norte__msg' }, [lastMsg]));

      const actions: Child[] = [];
      if (!m.granTregua) {
        actions.push(el('button', {
          type: 'button',
          className: `rdh-norte__btn${truceArmed ? ' rdh-norte__btn--armed' : ''}`,
          title: 'Termina todas las guerras entre casas y firma una tregua de diez años para enfrentar juntos a los Pálidos.',
          onclick: doTruce,
        }, [truceArmed ? '¿Sellar la Gran Tregua? — confirmar' : 'Sellar la Gran Tregua']));
      }

      const sel = store.selection;
      if (sel && sel.kind === 'army') {
        const army = state.armies[sel.id];
        if (army && army.factionId === state.playerFactionId && canEquipVidrio(state, sel.id)) {
          actions.push(el('button', {
            type: 'button',
            className: 'rdh-norte__btn',
            title: `Equipa a ${army.name} con puntas de vidrio ígneo para que hiera de verdad a los Pálidos.`,
            onclick: () => doEquip(sel.id),
          }, ['Equipar vidrio ígneo']));
        }
      }

      if (actions.length > 0) children.push(el('div', { className: 'rdh-norte__actions' }, actions));
    } else {
      // solo presagios: galón sobrio con el último aviso del norte.
      const lastOmen = PRESAGIO_CHAIN[Math.min(presagios, PRESAGIO_CHAIN.length) - 1] ?? '';
      children.push(el('div', { className: 'rdh-norte__omen-head' }, [
        el('span', { className: 'rdh-norte__snow', 'aria-hidden': 'true' }, ['❄']),
        el('span', {}, ['Presagios del Norte']),
      ]));
      children.push(el('p', { className: 'rdh-norte__omen-text' }, [lastOmen]));
    }

    replaceChildren(panel, children);
  }

  store.subscribe((_state, ev) => {
    switch (ev.type) {
      case 'state-replaced':
        truceArmed = false;
        lastMsg = null;
        render();
        break;
      case 'turn-ended':
        // el mensaje de acción es efímero: se borra al avanzar el mundo. No se
        // limpia en map-changed/economy-changed porque esos los emiten las
        // PROPIAS acciones del panel (equipar/tregua) que acaban de fijar el msg.
        lastMsg = null;
        render();
        break;
      case 'map-changed':
      case 'economy-changed':
      case 'selection':
        render();
        break;
      default:
        break;
    }
  });

  render();
}
