/**
 * Banner de asedio (Fase 2, GDD §9.2): visible cuando la selección actual es
 * un ejército propio que está sitiando, o la provincia que ese cerco tiene
 * rodeada. Ofrece asaltar (auto o en persona) o levantar el cerco.
 *
 * Estilo "lujo-oscuro" fijo del banco de diseño (fondo #1B1716, hairline
 * rgba(237,235,222,.14), texto #EDEBDE, acento #810100 SOLO en los botones
 * de asaltar) — todo inline: este panel no depende de render/ui/styles.css
 * (de otro agente), igual que hace game/battleFlow.ts con su overlay táctico.
 *
 * Se monta en document.body (no en el árbol de #ui-root/.hud, que arranca
 * con pointer-events:none), se suscribe a store para toda la vida de la
 * partida (mismo patrón que el resto de paneles del HUD: no hay unmount),
 * y se limpia solo — cuando la selección deja de ser un asedio propio, el
 * banner se oculta y vacía sus hijos en vez de dejar restos en el DOM.
 *
 * El integrador debe llamar `initSiegePanel(store, getWorld)` una vez desde
 * main.ts (ver reporte del Agente O).
 */
import type { GameStore } from '../../core/state/store';
import type { Siege, WorldBridge } from '../../core/types';
import { assaultSiege, assaultSiegeTactical, liftSiege } from '../../core/systems/siege';

const INK = '#1B1716';
const INK_2 = '#221E1B';
const PARCHMENT = '#EDEBDE';
const BLOOD = '#810100';
const BURGUNDY = '#630102';
const HAIRLINE = 'rgba(237,235,222,.14)';
const HAIRLINE_STRONG = 'rgba(237,235,222,.24)';

const PROVISIONS_BLOCKS = 5;

/** El asedio propio (atacante = jugador) que corresponde a la selección actual, si hay alguno. */
function activeSiegeForSelection(store: GameStore): Siege | null {
  if (!store.hasGame) return null;
  const state = store.state;
  const sel = store.selection;
  if (!sel) return null;

  const mine = (state.sieges ?? []).filter(s => s.attackerFactionId === state.playerFactionId);
  if (sel.kind === 'province') {
    return mine.find(s => s.provinceId === sel.id) ?? null;
  }
  return mine.find(s => s.besiegerArmyIds.includes(sel.id)) ?? null;
}

function provisionsBarText(siege: Siege): string {
  const pct = siege.provisionsMax > 0
    ? Math.max(0, Math.min(100, Math.round((siege.provisions / siege.provisionsMax) * 100)))
    : 0;
  const filled = Math.max(0, Math.min(PROVISIONS_BLOCKS, Math.round((pct / 100) * PROVISIONS_BLOCKS)));
  return `${'▓'.repeat(filled)}${'░'.repeat(PROVISIONS_BLOCKS - filled)} ${pct}%`;
}

export function initSiegePanel(store: GameStore, getWorld: () => WorldBridge | null): void {
  const root = document.createElement('div');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Asedio en curso');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    bottom: '20px',
    transform: 'translateX(-50%)',
    zIndex: '45',
    display: 'none',
    alignItems: 'center',
    gap: '0.9em',
    padding: '0.65em 1em',
    background: INK,
    color: PARCHMENT,
    border: `1px solid ${HAIRLINE}`,
    borderRadius: '2px',
    fontFamily: "'Alegreya', serif",
    fontSize: '0.95em',
    pointerEvents: 'auto',
    boxShadow: '0 8px 22px rgba(0,0,0,.4)',
    maxWidth: '92vw',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(root);

  function actionButton(label: string, accent: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.assign(btn.style, {
      fontFamily: "'Cinzel', serif",
      fontSize: '0.76em',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      padding: '0.55em 1em',
      borderRadius: '2px',
      cursor: 'pointer',
      color: PARCHMENT,
      background: accent ? BLOOD : INK_2,
      border: `1px solid ${accent ? BLOOD : HAIRLINE}`,
      transition: 'background-color .12s ease, border-color .12s ease',
    } as Partial<CSSStyleDeclaration>);
    btn.addEventListener('mouseenter', () => {
      btn.style.background = accent ? BURGUNDY : INK;
      if (!accent) btn.style.borderColor = HAIRLINE_STRONG;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = accent ? BLOOD : INK_2;
      if (!accent) btn.style.borderColor = HAIRLINE;
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function render(): void {
    const siege = activeSiegeForSelection(store);
    if (!siege) {
      root.style.display = 'none';
      root.replaceChildren();
      return;
    }

    const state = store.state;
    const province = state.provinces.find(p => p.id === siege.provinceId);
    const provinceName = province?.name ?? 'la plaza';

    let busy = false;
    const guard = (fn: () => void | Promise<void>): void => {
      if (busy) return;
      busy = true;
      try {
        const out = fn();
        if (out && typeof (out as Promise<void>).finally === 'function') {
          void (out as Promise<void>).finally(() => { busy = false; });
        } else {
          busy = false;
        }
      } catch {
        busy = false;
      }
    };

    const label = document.createElement('span');
    label.textContent = `⚔ Asedio de ${provinceName} · provisiones ${provisionsBarText(siege)}`;
    Object.assign(label.style, {
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      textDecoration: 'underline',
      textDecorationColor: HAIRLINE_STRONG,
      textUnderlineOffset: '3px',
    } as Partial<CSSStyleDeclaration>);
    label.title = `Centrar el mapa en ${provinceName}`;
    label.addEventListener('click', () => getWorld()?.focusProvince(siege.provinceId));

    const autoBtn = actionButton('Asaltar (auto)', true, () => guard(() => {
      const rng = store.rng();
      const result = store.mutate(s => assaultSiege(s, rng, siege.id), { type: 'map-changed' });
      if (result.battle) store.emit({ type: 'battle', report: result.battle });
    }));

    const personBtn = actionButton('Asaltar en persona', true, () => guard(
      () => assaultSiegeTactical(store, siege.id),
    ));

    const liftBtn = actionButton('Levantar asedio', false, () => guard(() => {
      if (!window.confirm(`¿Levantar el asedio de ${provinceName}? La hueste sitiadora se retira sin tomar la plaza.`)) return;
      store.mutate(s => liftSiege(s, siege.id), { type: 'map-changed' });
    }));

    root.replaceChildren(label, autoBtn, personBtn, liftBtn);
    root.style.display = 'flex';
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'state-replaced' || ev.type === 'selection' || ev.type === 'map-changed'
      || ev.type === 'turn-ended') {
      render();
    }
  });

  render();
}
