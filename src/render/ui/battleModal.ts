/**
 * Modal de batalla: se abre con cada BattleReport (jugador implicado).
 * Doble hairline, narrativa completa — es el sabor del juego.
 */
import type { GameStore } from '../../core/state/store';
import type { BattleReport, BattleSideReport } from '../../core/types';
import { SEASON_NAMES } from '../../core/types';
import { el, fmt, fmtSigned, replaceChildren } from './dom';
import { TERRAIN_ES } from './format';

export interface BattleModal {
  show(report: BattleReport): void;
}

export function createBattleModal(container: HTMLElement, store: GameStore): BattleModal {
  const backdrop = el('div', { className: 'modal-backdrop', 'aria-hidden': 'true' });
  const dialog = el('div', { className: 'battle-modal', role: 'dialog', 'aria-modal': 'true' });
  backdrop.append(dialog);
  container.append(backdrop);

  function close(): void {
    backdrop.classList.remove('is-visible');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  backdrop.addEventListener('click', ev => {
    if (ev.target === backdrop) close();
  });

  function sideLabel(side: BattleSideReport): string {
    if (!side.factionId) return 'Guarnición neutral';
    if (!store.hasGame) return side.factionId;
    const f = store.state.factions[side.factionId];
    return f ? `${f.dynastyName} · ${f.name}` : side.factionId;
  }

  function sideColumn(title: string, side: BattleSideReport): HTMLElement {
    return el('div', { className: 'battle-side' }, [
      el('h3', { className: 'battle-side__title' }, [title]),
      el('p', { className: 'battle-side__faction' }, [sideLabel(side)]),
      el('dl', { className: 'stat-list' }, [
        el('div', { className: 'stat-row' }, [el('dt', {}, ['Hombres antes']), el('dd', {}, [fmt(side.menBefore)])]),
        el('div', { className: 'stat-row' }, [
          el('dt', {}, ['Bajas']),
          el('dd', { className: 'battle-losses' }, [fmt(side.losses)]),
        ]),
        el('div', { className: 'stat-row' }, [
          el('dt', {}, ['Moral']),
          el('dd', {}, [side.moraleBroke ? 'Quebrada' : 'Sostenida']),
        ]),
      ]),
    ]);
  }

  function show(report: BattleReport): void {
    const seasonName = SEASON_NAMES[report.season];
    const winnerSide = report.winner === 'attacker' ? report.attacker : report.defender;
    const winnerLabel = sideLabel(winnerSide);

    replaceChildren(dialog, [
      el('button', { className: 'modal-close', 'aria-label': 'Cerrar', onclick: close }, ['×']),
      el('h2', { className: 'battle-modal__title' }, [`⚔ Batalla de ${report.provinceName}`]),
      el('p', { className: 'battle-modal__meta' }, [
        `${report.weather} · ${TERRAIN_ES[report.terrain]} · ${seasonName}`,
      ]),
      el('div', { className: 'battle-columns' }, [
        sideColumn('Atacante', report.attacker),
        sideColumn('Defensor', report.defender),
      ]),
      el('div', { className: 'battle-narrative' }, report.narrative.map(line => el('p', {}, [line]))),
      el('div', { className: 'battle-verdict' }, [
        el('p', { className: 'battle-verdict__winner' }, [`Victoria de ${winnerLabel}`]),
        el('p', { className: 'battle-verdict__score' }, [
          `Puntaje de guerra: ${fmtSigned(report.warScoreDelta)}`,
        ]),
      ]),
      el('button', { className: 'btn', onclick: close }, ['Cerrar']),
    ]);

    backdrop.classList.add('is-visible');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  return { show };
}
