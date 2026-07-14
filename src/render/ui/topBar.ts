/**
 * Barra superior del HUD: fecha, dinastía, recursos, y el botón de fin de turno
 * (el único bloque de --blood sólido de todo el HUD).
 */
import type { GameStore } from '../../core/state/store';
import { SEASON_NAMES, seasonOf, yearOf } from '../../core/types';
import { el, fmt, fmtSigned, replaceChildren } from './dom';
import type { EconomyBreakdown } from './gameQueries';
import { glyphHtml, onIconsReady } from './iconGlyph';

export interface ResourceDelta {
  gold: number;
  food: number;
  manpower: number;
  /** desglose real del turno recién cerrado, para las fórmulas de los tooltips. */
  economy: EconomyBreakdown;
}

export interface TopBar {
  refresh(delta?: ResourceDelta | null): void;
}

/** ▲+41 / ▼−12 — nunca color: la paleta manda, la dirección la da el glifo. */
function deltaGlyph(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `▲${fmtSigned(r)}`;
  if (r < 0) return `▼${fmtSigned(r)}`;
  return '±0';
}

function resourceChip(
  iconName: string, fallback: string, label: string, value: string,
  opts?: { delta?: number; title?: string },
): HTMLElement {
  const iconSpan = el('span', { className: 'topbar__chip-icon', 'aria-hidden': 'true' });
  iconSpan.innerHTML = glyphHtml(iconName, fallback, 16);
  const title = opts?.title ?? label;
  return el('span', { className: 'topbar__chip', title, 'aria-label': `${label}: ${value}. ${title}` }, [
    iconSpan,
    el('span', { className: 'topbar__chip-value' }, [value]),
    opts?.delta !== undefined ? el('span', { className: 'topbar__chip-delta' }, [deltaGlyph(opts.delta)]) : null,
  ]);
}

export function createTopBar(container: HTMLElement, store: GameStore, onEndTurn: () => void): TopBar {
  const bar = el('div', { className: 'topbar' });
  container.append(bar);

  const endTurnBtn = el('button', {
    type: 'button',
    className: 'btn-end-turn',
    'aria-label': 'Terminar turno',
    onclick: onEndTurn,
  }, ['Terminar turno']);

  let lastDelta: ResourceDelta | null = null;

  function refresh(delta: ResourceDelta | null = null): void {
    lastDelta = delta;
    if (!store.hasGame) return;
    const state = store.state;
    const faction = state.factions[state.playerFactionId];
    const season = SEASON_NAMES[seasonOf(state.turn)];
    const year = yearOf(state.turn);

    const ironCount = state.provinces.filter(p => p.ownerId === state.playerFactionId && p.iron).length;
    const horseCount = state.provinces.filter(p => p.ownerId === state.playerFactionId && p.horses).length;

    const goldTitle = delta
      ? `Impuestos ${fmt(delta.economy.income)} − mantenimiento ${fmt(delta.economy.upkeep)} = ${fmtSigned(delta.gold)} (último turno).`
      : 'Oro del tesoro real.';
    const foodTitle = delta
      ? `Cosecha ${fmt(delta.economy.foodProd)} − consumo ${fmt(delta.economy.foodCons)} = ${fmtSigned(delta.food)} (último turno).`
      : 'Alimento almacenado en los graneros.';
    const manpowerTitle = delta
      ? `Levas ganadas +${fmt(delta.economy.manpowerGain)}, tope del reino ${fmt(delta.economy.manpowerCap)} (último turno).`
      : 'Levas disponibles para reclutar; el tope depende de tus provincias.';

    replaceChildren(bar, [
      el('div', { className: 'topbar__left' }, [
        el('span', { className: 'topbar__date' }, [`${season} · Año ${year}`]),
        el('span', { className: 'topbar__dynasty' }, [faction ? faction.dynastyName : '—']),
      ]),
      el('div', { className: 'topbar__resources' }, [
        resourceChip('oro', '⛁', 'Oro', faction ? fmt(faction.gold) : '—', { delta: delta?.gold, title: goldTitle }),
        resourceChip('alimento', '❋', 'Alimento', faction ? fmt(faction.foodStock) : '—', { delta: delta?.food, title: foodTitle }),
        resourceChip('levas', '⚔', 'Levas', faction ? fmt(faction.manpower) : '—', { delta: delta?.manpower, title: manpowerTitle }),
        el('span', {
          className: 'topbar__chip topbar__chip--small',
          title: 'Provincias propias con hierro: se necesita al menos una para reclutar unidades que lo requieren.',
          'aria-label': `Provincias con hierro: ${ironCount}`,
        }, [`Hierro ✓${ironCount}`]),
        el('span', {
          className: 'topbar__chip topbar__chip--small',
          title: 'Provincias propias con caballos: se necesita al menos una para reclutar caballería.',
          'aria-label': `Provincias con caballos: ${horseCount}`,
        }, [`Caballos ✓${horseCount}`]),
      ]),
      el('div', { className: 'topbar__right' }, [
        resourceChip('legitimidad', '♛', 'Legitimidad', faction ? fmt(faction.legitimacy) : '—', {
          title: 'Legitimidad (0–100): derecho percibido a gobernar. Baja al declarar guerra sin causa o en sucesiones forzadas.',
        }),
        endTurnBtn,
      ]),
    ]);
  }

  onIconsReady(() => refresh(lastDelta));

  return { refresh };
}
