/**
 * Informe del turno: modal con lo que pasó al cerrar el turno (Economía,
 * Batallas, Mundo, Amenazas), en vez de un chorro de toasts sueltos. Los
 * toasts quedan reservados a las acciones directas del jugador.
 */
import type { GameStore } from '../../core/state/store';
import type { BattleReport, ChronicleEntry, FactionId, GameState, WorldBridge } from '../../core/types';
import { SEASON_NAMES, seasonOf, yearOf } from '../../core/types';
import type { TurnSummary } from '../../core/systems/turn';
import { el, fmt, fmtSigned, replaceChildren } from './dom';
import { CHRONICLE_ICON } from './format';
import { computeThreats, type EconomyBreakdown } from './gameQueries';
import { glyphHtml } from './iconGlyph';

export interface TurnReportInput {
  /** el turno que ACABA de cerrarse (antes del turn++ interno). */
  turnEnded: number;
  summary: TurnSummary;
  economy: EconomyBreakdown;
  newChronicle: ChronicleEntry[];
}

export interface TurnReport {
  show(input: TurnReportInput, onViewBattle: (report: BattleReport) => void): void;
}

export function createTurnReport(
  container: HTMLElement, store: GameStore, getWorld: () => WorldBridge | null,
): TurnReport {
  const backdrop = el('div', { className: 'modal-backdrop', 'aria-hidden': 'true' });
  const dialog = el('div', { className: 'turn-report', role: 'dialog', 'aria-modal': 'true' });
  backdrop.append(dialog);
  container.append(backdrop);

  function close(): void {
    backdrop.classList.remove('is-visible');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  backdrop.addEventListener('click', ev => { if (ev.target === backdrop) close(); });

  function factionLabel(state: GameState, id: FactionId | null): string {
    if (!id) return 'Guarnición neutral';
    const f = state.factions[id];
    return f ? `${f.dynastyName} · ${f.name}` : id;
  }

  function sectionTitle(iconName: string, fallback: string, text: string): HTMLElement {
    const iconSpan = el('span', { className: 'turn-report__section-icon', 'aria-hidden': 'true' });
    iconSpan.innerHTML = glyphHtml(iconName, fallback, 17);
    return el('h3', { className: 'turn-report__section-title' }, [iconSpan, text]);
  }

  function statRow(label: string, value: string, title: string): HTMLElement {
    return el('div', { className: 'stat-row', title }, [
      el('dt', {}, [label]),
      el('dd', {}, [value]),
    ]);
  }

  function economySection(economy: EconomyBreakdown): HTMLElement {
    const netGold = economy.income - economy.upkeep;
    const netFood = economy.foodProd - economy.foodCons;
    return el('div', { className: 'turn-report__section' }, [
      sectionTitle('oro', '⛁', 'Economía'),
      el('dl', { className: 'stat-list' }, [
        statRow(
          'Ingresos', `${fmt(economy.income)} ⛁`,
          `Impuestos de ${fmt(economy.provinceCount)} provincias propias.`,
        ),
        statRow(
          'Mantenimiento', `−${fmt(economy.upkeep)} ⛁`,
          `Paga de ${fmt(economy.unitCount)} unidades bajo armas.`,
        ),
        statRow(
          'Neto de oro', `${fmtSigned(netGold)} ⛁`,
          `Ingresos ${fmt(economy.income)} − mantenimiento ${fmt(economy.upkeep)} = ${fmtSigned(netGold)}.`,
        ),
        statRow(
          'Cosecha', `${fmt(economy.foodProd)} ❋ − ${fmt(economy.foodCons)} ❋`,
          `Producción ${fmt(economy.foodProd)} − consumo ${fmt(economy.foodCons)} = ${fmtSigned(netFood)}.`,
        ),
        statRow(
          'Levas', `+${fmt(economy.manpowerGain)} ⚔`,
          `Ganancia de levas este turno; reserva máxima del reino: ${fmt(economy.manpowerCap)}.`,
        ),
      ]),
    ]);
  }

  function battlesSection(
    state: GameState, battles: BattleReport[], onViewBattle: (r: BattleReport) => void,
  ): HTMLElement | null {
    if (battles.length === 0) return null;
    return el('div', { className: 'turn-report__section' }, [
      sectionTitle('guerra', '⚔', 'Batallas'),
      el('div', { className: 'turn-report__list' }, battles.map(b => {
        const winnerSide = b.winner === 'attacker' ? b.attacker : b.defender;
        const winnerLabel = factionLabel(state, winnerSide.factionId);
        return el('div', { className: 'turn-report__item' }, [
          el('span', {}, [`${b.provinceName}: victoria de ${winnerLabel}.`]),
          el('button', {
            type: 'button', className: 'btn btn--small',
            onclick: () => onViewBattle(b),
          }, ['Ver parte']),
        ]);
      })),
    ]);
  }

  function worldSection(entries: ChronicleEntry[]): HTMLElement | null {
    if (entries.length === 0) return null;
    return el('div', { className: 'turn-report__section' }, [
      sectionTitle('cronica', '✦', 'Mundo'),
      el('div', { className: 'turn-report__list' }, entries.map(e => el('p', { className: 'turn-report__chronicle-line' }, [
        el('span', { 'aria-hidden': 'true' }, [CHRONICLE_ICON[e.kind]]),
        ` ${e.text}`,
      ]))),
    ]);
  }

  function threatsSection(state: GameState): HTMLElement | null {
    const threats = computeThreats(state);
    if (threats.length === 0) return null;
    return el('div', { className: 'turn-report__section' }, [
      sectionTitle('amenaza', '⚠', 'Amenazas'),
      el('div', { className: 'turn-report__list' }, threats.map(t => {
        const men = t.enemyArmy.units.reduce((s, u) => s + u.men, 0);
        return el('div', { className: 'turn-report__item' }, [
          el('span', {}, [
            `${factionLabel(state, t.enemyArmy.factionId)} — ${fmt(men)} hombres junto a ${t.provinceName}.`,
          ]),
          el('button', {
            type: 'button', className: 'btn btn--small',
            onclick: () => getWorld()?.focusProvince(t.provinceId),
          }, ['Ver']),
        ]);
      })),
    ]);
  }

  function show(input: TurnReportInput, onViewBattle: (report: BattleReport) => void): void {
    if (!store.hasGame) return;
    const state = store.state;
    const season = SEASON_NAMES[seasonOf(input.turnEnded)];
    const year = yearOf(input.turnEnded);

    const sections = [
      economySection(input.economy),
      battlesSection(state, input.summary.battles, onViewBattle),
      worldSection(input.newChronicle),
      threatsSection(state),
    ].filter((s): s is HTMLElement => s !== null);

    replaceChildren(dialog, [
      el('h2', { className: 'turn-report__title' }, [`Informe del turno · ${season} del año ${year}`]),
      el('div', { className: 'turn-report__body' }, sections),
      el('button', {
        type: 'button', className: 'btn btn--primary turn-report__continue', onclick: close,
      }, ['Continuar']),
    ]);

    backdrop.classList.add('is-visible');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  return { show };
}
