/**
 * Barra superior del HUD: fecha, dinastía, recursos, y el botón de fin de turno
 * (el único bloque de --blood sólido de todo el HUD).
 */
import type { GameStore } from '../../core/state/store';
import { SEASON_NAMES, seasonOf, yearOf } from '../../core/types';
import { el, fmt, fmtSigned, replaceChildren } from './dom';

export interface ResourceDelta { gold: number; food: number; }

export interface TopBar {
  refresh(delta?: ResourceDelta | null): void;
}

function resourceChip(icon: string, label: string, value: string, delta?: string): HTMLElement {
  return el('span', { className: 'topbar__chip', title: label, 'aria-label': `${label}: ${value}` }, [
    el('span', { className: 'topbar__chip-icon', 'aria-hidden': 'true' }, [icon]),
    el('span', { className: 'topbar__chip-value' }, [value]),
    delta ? el('span', { className: 'topbar__chip-delta' }, [`(${delta})`]) : null,
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

  function refresh(delta: ResourceDelta | null = null): void {
    if (!store.hasGame) return;
    const state = store.state;
    const faction = state.factions[state.playerFactionId];
    const season = SEASON_NAMES[seasonOf(state.turn)];
    const year = yearOf(state.turn);

    const ironCount = state.provinces.filter(p => p.ownerId === state.playerFactionId && p.iron).length;
    const horseCount = state.provinces.filter(p => p.ownerId === state.playerFactionId && p.horses).length;

    replaceChildren(bar, [
      el('div', { className: 'topbar__left' }, [
        el('span', { className: 'topbar__date' }, [`${season} · Año ${year}`]),
        el('span', { className: 'topbar__dynasty' }, [faction ? `Casa ${faction.dynastyName}` : '—']),
      ]),
      el('div', { className: 'topbar__resources' }, [
        resourceChip('⛁', 'Oro', faction ? fmt(faction.gold) : '—'),
        resourceChip('❋', 'Alimento', faction ? fmt(faction.foodStock) : '—', delta ? fmtSigned(delta.food) : undefined),
        resourceChip('⚔', 'Levas', faction ? fmt(faction.manpower) : '—'),
        el('span', {
          className: 'topbar__chip topbar__chip--small',
          title: 'Provincias propias con hierro',
          'aria-label': `Provincias con hierro: ${ironCount}`,
        }, [`Hierro ✓${ironCount}`]),
        el('span', {
          className: 'topbar__chip topbar__chip--small',
          title: 'Provincias propias con caballos',
          'aria-label': `Provincias con caballos: ${horseCount}`,
        }, [`Caballos ✓${horseCount}`]),
      ]),
      el('div', { className: 'topbar__right' }, [
        resourceChip('♛', 'Legitimidad', faction ? fmt(faction.legitimacy) : '—'),
        endTurnBtn,
      ]),
    ]);
  }

  return { refresh };
}
