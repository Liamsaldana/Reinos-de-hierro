/**
 * Árbol tecnológico (Fase 2, GDD §11): botón fijo que abre un panel a
 * pantalla parcial con las tecnologías de content/techs.ts en 3 columnas
 * (Militar / Economía / Estado), separadas por era. Vive FUERA de #ui-root,
 * igual que la sede de poder (game/castleFlow.ts): se monta directamente en
 * document.body con su propia hoja de estilos inyectada una sola vez, así
 * que redeclara aquí los tokens de "lujo oscuro × crimson-noir" en vez de
 * depender de las custom properties de #ui-root (fuera de su alcance allí).
 *
 * API pública: initTechPanel(store). El integrador solo necesita llamarla
 * una vez desde main.ts, igual que initCastleFlow(store).
 */
import type { GameStore } from '../../core/state/store';
import type { Faction, TechId } from '../../core/types';
import { TECHS } from '../../core/content/techs';
import type { TechBranch, TechDef } from '../../core/content/techs';
import { pointsPerTurn, setActiveResearch } from '../../core/systems/research';
import { el, fmt, replaceChildren, type Child } from './dom';

const HAIRLINE = 'rgba(237,235,222,.14)';
const TECH_STYLE_ID = 'rdh-tech-style';

const BRANCH_META: Record<TechBranch, { label: string; icon: string }> = {
  militar: { label: 'Militar', icon: '⚔' },
  economia: { label: 'Economía', icon: '⛁' },
  estado: { label: 'Estado', icon: '♛' },
};
const BRANCH_ORDER: TechBranch[] = ['militar', 'economia', 'estado'];

const TECH_CSS = `
.rdh-tech-backdrop {
  --ink: #1B1716;
  --ink-2: #221E1B;
  --parchment: #EDEBDE;
  --blood: #810100;
  --burgundy: #630102;
  --hairline: rgba(237, 235, 222, 0.14);
  --hairline-strong: rgba(237, 235, 222, 0.24);
  position: fixed;
  inset: 0;
  z-index: 96;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.15s ease;
  padding: 28px 20px;
  font-family: 'Alegreya', Georgia, serif;
  font-size: 15px;
  line-height: 1.45;
  color: var(--parchment);
}
.rdh-tech-backdrop.is-visible { opacity: 1; visibility: visible; pointer-events: auto; }
.rdh-tech-backdrop *, .rdh-tech-backdrop *::before, .rdh-tech-backdrop *::after { box-sizing: border-box; }
.rdh-tech-backdrop h1, .rdh-tech-backdrop h2, .rdh-tech-backdrop h3 {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0;
  font-weight: 600;
}
.rdh-tech-backdrop button {
  font-family: 'Alegreya', Georgia, serif;
  color: var(--parchment);
  background: transparent;
  cursor: pointer;
}
.rdh-tech-backdrop :focus-visible { outline: 2px solid var(--parchment); outline-offset: 2px; }
.rdh-tech-backdrop p { margin: 0; }

.rdh-tech {
  width: min(900px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  background: var(--ink);
  border: 1px solid var(--hairline);
  outline: 1px solid var(--hairline);
  outline-offset: -6px;
  border-radius: 2px;
  padding: 1.6em 1.8em 1.8em;
}

.rdh-tech__header {
  position: sticky;
  top: -1.6em;
  margin: -1.6em -1.8em 1.2em;
  padding: 1.3em 1.8em 1em;
  display: flex;
  align-items: baseline;
  gap: 1em;
  flex-wrap: wrap;
  background: var(--ink);
  border-bottom: 1px solid var(--hairline);
}
.rdh-tech__title { font-size: 1.3em; flex: 1 1 auto; }
.rdh-tech__rate { font-size: 0.86em; opacity: 0.85; white-space: nowrap; }
.rdh-tech__rate strong { font-family: 'Cinzel', Georgia, serif; color: var(--parchment); }
.rdh-tech__close {
  font-size: 1.3em;
  line-height: 1;
  padding: 0.1em 0.4em;
  opacity: 0.75;
}
.rdh-tech__close:hover { opacity: 1; }

.rdh-tech__result {
  font-size: 0.86em;
  padding: 0.5em 0.7em;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  margin: 0 0 1.1em;
}
.rdh-tech__result.is-warn { border-color: var(--blood); }

.rdh-tech__columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.4em;
  align-items: start;
}
.rdh-tech-col__title { font-size: 0.95em; margin-bottom: 0.8em; opacity: 0.92; }
.rdh-tech-col__cards { display: flex; flex-direction: column; gap: 0.7em; }

.rdh-tech-era-sep {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.68em;
  text-align: center;
  opacity: 0.6;
  margin: 1.1em 0 0.7em;
  padding-top: 0.9em;
  border-top: 1px dashed var(--hairline);
}

.rdh-tech-card {
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  padding: 0.7em 0.8em;
}
.rdh-tech-card.is-active { border-color: var(--hairline-strong); }
.rdh-tech-card.is-locked { opacity: 0.5; }
.rdh-tech-card__head { display: flex; align-items: baseline; gap: 0.5em; margin-bottom: 0.3em; }
.rdh-tech-card__icon { opacity: 0.85; flex: 0 0 auto; }
.rdh-tech-card__name { font-size: 0.92em; font-weight: 600; }
.rdh-tech-card__blurb { font-size: 0.82em; font-style: italic; opacity: 0.78; margin: 0 0 0.5em; }
.rdh-tech-card__cost { font-size: 0.78em; opacity: 0.68; margin: 0 0 0.4em; }

.rdh-tech-card__progress {
  position: relative;
  height: 7px;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  background: var(--ink);
  overflow: hidden;
  margin: 0.35em 0;
}
.rdh-tech-card__progress-fill { display: block; height: 100%; background: var(--parchment); opacity: 0.55; }
.rdh-tech-card__progress-label { font-size: 0.76em; opacity: 0.7; margin: 0.2em 0 0; }

.rdh-tech-card__btn {
  width: 100%;
  margin-top: 0.35em;
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.76em;
  text-align: center;
  background: var(--blood);
  border: 1px solid var(--blood);
  border-radius: 2px;
  padding: 0.5em 0.6em;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
.rdh-tech-card__btn:hover { background: var(--burgundy); border-color: var(--burgundy); }

@media (max-width: 760px) {
  .rdh-tech__columns { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .rdh-tech-backdrop, .rdh-tech-backdrop * { transition: none !important; }
}
`;

/** Inyecta la hoja una sola vez en <head> (mismo patrón que render/castle/styles.ts). */
function ensureTechStyle(): void {
  if (document.getElementById(TECH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TECH_STYLE_ID;
  style.textContent = TECH_CSS;
  document.head.appendChild(style);
}

type CardState = 'done' | 'active' | 'available' | 'locked';

const STATE_ICON: Record<CardState, string> = { done: '✓', active: '●', available: '○', locked: '⊘' };

function renderCard(faction: Faction, tech: TechDef, onInvestigar: (techId: TechId) => void): HTMLElement {
  const research = faction.research;
  const done = research?.done.includes(tech.id) ?? false;
  const active = research?.active === tech.id;
  const missing = tech.requires.filter(id => !(research?.done.includes(id) ?? false));
  const state: CardState = done ? 'done' : active ? 'active' : missing.length > 0 ? 'locked' : 'available';

  const body: Child[] = [
    el('div', { className: 'rdh-tech-card__head' }, [
      el('span', { className: 'rdh-tech-card__icon', 'aria-hidden': 'true' }, [STATE_ICON[state]]),
      el('span', { className: 'rdh-tech-card__name' }, [tech.name]),
    ]),
    el('p', { className: 'rdh-tech-card__blurb' }, [tech.blurb]),
    el('p', { className: 'rdh-tech-card__cost' }, [`Coste: ${fmt(tech.cost)} pts · Era ${tech.era === 1 ? 'I' : 'II'}`]),
  ];

  if (state === 'active' && research) {
    const pct = tech.cost > 0 ? Math.max(0, Math.min(100, (research.points / tech.cost) * 100)) : 0;
    body.push(
      el('div', { className: 'rdh-tech-card__progress', title: `${fmt(research.points)} / ${fmt(tech.cost)} puntos` }, [
        el('div', { className: 'rdh-tech-card__progress-fill', style: `width:${pct}%` }, []),
      ]),
      el('p', { className: 'rdh-tech-card__progress-label' }, [`${fmt(research.points)} / ${fmt(tech.cost)} pts`]),
    );
  } else if (state === 'available') {
    const activeId = research?.active ?? null;
    const btnTitle = activeId
      ? `Cambia la investigación activa (se pierde el avance hacia ${TECHS[activeId]?.name ?? activeId}).`
      : 'Iniciar esta investigación.';
    body.push(el('button', {
      type: 'button',
      className: 'rdh-tech-card__btn',
      title: btnTitle,
      onclick: () => onInvestigar(tech.id),
    }, ['Investigar']));
  }

  const missingNames = state === 'locked' ? missing.map(id => TECHS[id]?.name ?? id) : [];

  return el('div', {
    className: `rdh-tech-card is-${state}`,
    title: missingNames.length > 0 ? `Requiere: ${missingNames.join(', ')}` : undefined,
  }, body);
}

function renderColumn(faction: Faction, branch: TechBranch, onInvestigar: (techId: TechId) => void): HTMLElement {
  const techs = Object.values(TECHS).filter(t => t.branch === branch);
  const era1 = techs.filter(t => t.era === 1)
    .sort((a, b) => a.requires.length - b.requires.length || a.name.localeCompare(b.name, 'es'));
  const era2 = techs.filter(t => t.era === 2)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const meta = BRANCH_META[branch];

  return el('div', { className: 'rdh-tech-col' }, [
    el('h2', { className: 'rdh-tech-col__title' }, [`${meta.icon} ${meta.label}`]),
    el('div', { className: 'rdh-tech-col__cards' }, era1.map(t => renderCard(faction, t, onInvestigar))),
    el('div', { className: 'rdh-tech-era-sep' }, ['Era II · Alta Edad Media']),
    el('div', { className: 'rdh-tech-col__cards' }, era2.map(t => renderCard(faction, t, onInvestigar))),
  ]);
}

export function initTechPanel(store: GameStore): void {
  ensureTechStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '🜲 Tecnología';
  btn.setAttribute('aria-label', 'Abrir el árbol tecnológico');
  Object.assign(btn.style, {
    position: 'fixed', left: '14px', bottom: '100px', zIndex: '30',
    background: '#1B1716', color: '#EDEBDE', border: `1px solid ${HAIRLINE}`,
    borderRadius: '2px', padding: '8px 14px', cursor: 'pointer',
    font: '500 14px Alegreya, Georgia, serif', pointerEvents: 'auto',
    display: 'none',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'rgba(237,235,222,.4)'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = HAIRLINE; });
  document.body.appendChild(btn);

  const backdrop = el('div', { className: 'rdh-tech-backdrop' });
  const dialog = el('div', { className: 'rdh-tech', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Árbol tecnológico' });
  backdrop.append(dialog);
  document.body.appendChild(backdrop);

  let open = false;
  let lastResult: { ok: boolean; message: string } | null = null;

  function close(): void {
    if (!open) return;
    open = false;
    backdrop.classList.remove('is-visible');
    lastResult = null;
  }

  function show(): void {
    if (!store.hasGame || open) return;
    open = true;
    backdrop.classList.add('is-visible');
    render();
  }

  function investigar(techId: TechId): void {
    if (!store.hasGame) return;
    const factionId = store.state.playerFactionId;
    lastResult = store.mutate(s => setActiveResearch(s, factionId, techId), { type: 'economy-changed' });
    render();
  }

  function render(): void {
    if (!open || !store.hasGame) return;
    const state = store.state;
    const faction = state.factions[state.playerFactionId];
    if (!faction) { close(); return; }

    const rate = pointsPerTurn(state, faction.id);
    const children: Child[] = [
      el('div', { className: 'rdh-tech__header' }, [
        el('h1', { className: 'rdh-tech__title' }, ['🜲 Árbol Tecnológico']),
        el('div', { className: 'rdh-tech__rate' }, ['Puntos por turno: ', el('strong', {}, [fmt(rate)])]),
        el('button', {
          type: 'button', className: 'rdh-tech__close', 'aria-label': 'Cerrar', onclick: () => close(),
        }, ['×']),
      ]),
    ];
    if (lastResult) {
      children.push(el('p', { className: `rdh-tech__result${lastResult.ok ? '' : ' is-warn'}` }, [lastResult.message]));
    }
    children.push(el('div', { className: 'rdh-tech__columns' }, BRANCH_ORDER.map(b => renderColumn(faction, b, investigar))));

    replaceChildren(dialog, children);
  }

  btn.addEventListener('click', () => { if (open) close(); else show(); });
  backdrop.addEventListener('click', ev => { if (ev.target === backdrop) close(); });
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && open) close();
  });

  store.subscribe((_state, ev) => {
    btn.style.display = store.hasGame ? 'block' : 'none';
    if (ev.type === 'state-replaced') { close(); return; }
    if (ev.type === 'turn-ended' || ev.type === 'economy-changed') render();
  });
}
