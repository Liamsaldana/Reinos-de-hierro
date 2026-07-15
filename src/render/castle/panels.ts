/**
 * Paneles laterales de la sede de poder (estilo crimson-noir replicado en
 * styles.ts porque vivimos fuera de #ui-root):
 *   - SALA DEL TRONO: gobernante, heredero, general, legitimidad.
 *   - CUARTEL: reclutamiento REAL en la capital (actions.recruitUnit vía store).
 *   - TESORERÍA: desglose económico del reino (economy.ts).
 *   - CRÓNICA: últimas 12 entradas.
 * En corte extranjera todo es de solo lectura (sin reclutar).
 */
import type { GameStore } from '../../core/state/store';
import type {
  Character, FactionId, GameState, Province, ProvinceId, Season, UnitType,
} from '../../core/types';
import { SEASON_NAMES, seasonOf, yearOf } from '../../core/types';
import { recruitUnit } from '../../core/systems/actions';
import { unitTypesFor, getUnitType } from '../../core/content/units';
import {
  provincesOf, armiesOf, foodProduction, foodConsumption, manpowerGain, manpowerCap,
} from '../../core/systems/economy';
import { CULTURES } from '../../core/content/cultures';
import { el, fmt, fmtSigned, replaceChildren, type Child } from './dom';
import { ROLE_ES, ATTR_ES, traitLabel, ageLabel } from './labels';

export type PanelKey = 'trono' | 'cuartel' | 'tesoreria' | 'cronica';

const PANEL_TITLE: Record<PanelKey, string> = {
  trono: 'Sala del Trono',
  cuartel: 'Cuartel',
  tesoreria: 'Tesorería',
  cronica: 'Crónica',
};

const CHRONICLE_ICON: Record<string, string> = {
  guerra: '⚔', batalla: '🛡', dinastia: '♛', economia: '⛁', mundo: '✦',
};

export interface PanelController {
  el: HTMLElement;
  open(key: PanelKey): void;
  close(): void;
  isOpen(): boolean;
  current(): PanelKey | null;
  refresh(): void;
  dispose(): void;
}

export function createPanels(
  store: GameStore,
  factionId: FactionId,
  capitalId: ProvinceId | null,
  readOnly: boolean,
): PanelController {
  let currentKey: PanelKey | null = null;
  let recruitResult: { message: string; ok: boolean } | null = null;

  const body = el('div', { className: 'rdh-panel__body' });
  const titleEl = el('h2', { className: 'rdh-panel__title' }, ['']);
  const closeBtn = el('button', {
    type: 'button',
    className: 'rdh-panel__close',
    'aria-label': 'Cerrar panel',
    onclick: () => close(),
  }, ['×']);
  const panel = el('div', { className: 'rdh-panel', 'aria-hidden': 'true' }, [
    el('div', { className: 'rdh-panel__header' }, [titleEl, closeBtn]),
    body,
  ]);

  function statRow(label: string, value: Child): HTMLElement {
    return el('div', { className: 'rdh-stat-row' }, [
      el('dt', {}, [label]),
      el('dd', {}, [value]),
    ]);
  }

  function findGeneral(state: GameState): Character | null {
    return Object.values(state.characters).find(
      c => c.factionId === factionId && c.role === 'general' && c.alive,
    ) ?? null;
  }

  function characterBlock(state: GameState, c: Character | null, roleFallback: string): Child[] {
    if (!c) return [el('p', { className: 'rdh-note' }, [`Sin ${roleFallback.toLowerCase()} conocido.`])];
    const out: Child[] = [
      el('dl', { className: 'rdh-stat-list' }, [
        statRow('Nombre', c.name),
        statRow('Papel', ROLE_ES[c.role]),
        statRow('Edad', ageLabel(c.age)),
      ]),
    ];
    out.push(el('div', { className: 'rdh-attr-grid' }, ATTR_ES.map(a =>
      el('div', { className: 'rdh-attr' }, [
        el('div', { className: 'rdh-attr__label' }, [a.label]),
        el('div', { className: 'rdh-attr__value' }, [String(c.attributes[a.key])]),
      ]),
    )));
    if (c.traits.length) {
      out.push(el('div', { className: 'rdh-tags' }, c.traits.map(t =>
        el('span', { className: 'rdh-tag' }, [traitLabel(t)]),
      )));
    }
    return out;
  }

  // ---------------------------------------------------------------- SALA DEL TRONO
  function renderTrono(state: GameState): Child[] {
    const faction = state.factions[factionId];
    if (!faction) return [el('p', { className: 'rdh-note' }, ['Esta casa ya no reina.'])];
    const ruler = faction.rulerId ? state.characters[faction.rulerId] : null;
    const heir = faction.heirId ? state.characters[faction.heirId] : null;
    const general = findGeneral(state);
    const legit = Math.round(faction.legitimacy);

    return [
      el('p', { className: 'rdh-lead' }, [
        `${faction.name} · Casa ${faction.dynastyName} · Cultura ${cultureName(faction.cultureId)}.`,
      ]),
      el('h3', { className: 'rdh-subtitle' }, ['Gobernante']),
      ...characterBlock(state, ruler, 'gobernante'),
      el('h3', { className: 'rdh-subtitle' }, ['Heredero']),
      ...characterBlock(state, heir, 'heredero'),
      el('h3', { className: 'rdh-subtitle' }, ['General']),
      ...characterBlock(state, general, 'general'),
      el('h3', { className: 'rdh-subtitle' }, ['Legitimidad']),
      el('div', { className: 'rdh-meter', title: `Legitimidad ${legit}/100` }, [
        el('span', { className: 'rdh-meter__fill', style: `width:${legit}%` }, []),
      ]),
      el('p', { className: 'rdh-lead' }, [
        `${legit} / 100. La legitimidad es el derecho percibido de la casa a gobernar: sostiene la lealtad de vasallos y la sucesión. Cae al declarar guerra sin causa o en sucesiones forzadas; se recobra con victorias y buen gobierno.`,
      ]),
    ];
  }

  // ---------------------------------------------------------------- CUARTEL
  function renderCuartel(state: GameState): Child[] {
    const faction = state.factions[factionId];
    if (!faction) return [el('p', { className: 'rdh-note' }, ['Sin casa que reclute.'])];
    const capital = capitalId !== null ? state.provinces.find(p => p.id === capitalId) : undefined;
    const units = unitTypesFor(faction.cultureId);
    const out: Child[] = [
      el('p', { className: 'rdh-lead' }, [
        capital
          ? `Levas y adiestramiento en ${capital.settlement.name}.`
          : 'Esta casa no tiene capital donde levantar tropas.',
      ]),
    ];
    if (readOnly) {
      out.push(el('p', { className: 'rdh-note' }, ['Corte extranjera: solo observas su guarnición, no puedes reclutar.']));
    }
    if (!capital) {
      out.push(el('p', { className: 'rdh-note' }, ['Sin capital disponible.']));
      return out;
    }
    if (units.length === 0) {
      out.push(el('p', { className: 'rdh-note' }, ['Sin tipos de unidad disponibles para esta cultura.']));
      return out;
    }
    out.push(el('div', { className: 'rdh-recruit-list' }, units.map(u => recruitRow(state, capital, u))));
    if (recruitResult) {
      out.push(el('p', {
        className: `rdh-result${recruitResult.ok ? '' : ' rdh-result--warn'}`,
      }, [recruitResult.message]));
    }
    return out;
  }

  function costLabel(u: UnitType): string {
    const parts = [`${fmt(u.cost.gold)} oro`, `${fmt(u.cost.manpower)} levas`];
    if (u.cost.iron) parts.push(`${fmt(u.cost.iron)} hierro`);
    if (u.cost.horses) parts.push(`${fmt(u.cost.horses)} caballos`);
    return parts.join(' · ');
  }

  function factionHasResource(state: GameState, resource: 'iron' | 'horses'): boolean {
    return state.provinces.some(p => p.ownerId === factionId && p[resource]);
  }

  function recruitRow(state: GameState, capital: Province, u: UnitType): HTMLElement {
    const faction = state.factions[factionId];
    const reasons: string[] = [];
    if (readOnly) reasons.push('Corte extranjera');
    if (faction.gold < u.cost.gold) reasons.push('Oro insuficiente');
    if (faction.manpower < u.cost.manpower) reasons.push('Levas insuficientes');
    if (u.cost.iron && !factionHasResource(state, 'iron')) reasons.push('Requiere provincia con hierro');
    if (u.cost.horses && !factionHasResource(state, 'horses')) reasons.push('Requiere provincia con caballos');
    const disabled = reasons.length > 0;
    return el('div', { className: 'rdh-recruit-row' }, [
      el('span', { className: 'rdh-recruit-row__name' }, [u.name]),
      el('button', {
        type: 'button',
        className: 'rdh-btn rdh-btn--primary',
        disabled,
        title: disabled ? reasons.join('; ') : `Reclutar ${u.name}`,
        onclick: () => {
          const rng = store.rng();
          const result = store.mutate(
            s => recruitUnit(s, rng, factionId, capital.id, u.id),
            { type: 'economy-changed' },
          );
          recruitResult = { message: result.message, ok: result.ok };
          // el store emitirá economy-changed → refresh() vuelve a pintar el panel
        },
      }, ['Reclutar']),
      el('span', { className: 'rdh-recruit-row__meta' }, [costLabel(u), ' · mantenimiento ', String(u.upkeep), ' oro/turno']),
    ]);
  }

  // ---------------------------------------------------------------- TESORERÍA
  function renderTesoreria(state: GameState): Child[] {
    const faction = state.factions[factionId];
    if (!faction) return [el('p', { className: 'rdh-note' }, ['Sin tesoro que contar.'])];
    const season = seasonOf(state.turn);
    const seasonMod = season === 2 ? 1.25 : 1;
    const provs = provincesOf(state, factionId);
    const armies = armiesOf(state, factionId);

    // ingresos por provincia (misma fórmula que economy.taxIncome)
    const provRows: Child[] = provs
      .map(p => ({ p, tax: p.baseTax * (p.settlement.level === 4 ? 1.3 : 1) * seasonMod }))
      .sort((a, b) => b.tax - a.tax)
      .map(({ p, tax }) => econRow(p.name, `${fmt(tax)} oro`, true));
    const income = provs.reduce((s, p) => s + p.baseTax * (p.settlement.level === 4 ? 1.3 : 1), 0) * seasonMod;

    // mantenimiento por ejército
    const upkeepRows: Child[] = armies
      .map(a => ({ a, up: a.units.reduce((s, u) => s + safeUpkeep(u.typeId), 0) }))
      .filter(({ up }) => up > 0)
      .map(({ a, up }) => econRow(a.name, `${fmt(up)} oro`, true));
    const upkeep = armies.reduce((s, a) => s + a.units.reduce((ss, u) => ss + safeUpkeep(u.typeId), 0), 0);

    const foodProd = foodProduction(state, factionId, season);
    const foodCons = foodConsumption(state, factionId);
    const mpGain = manpowerGain(state, factionId);
    const mpCap = manpowerCap(state, factionId);

    return [
      el('p', { className: 'rdh-lead' }, [
        `${SEASON_NAMES[season]} · Año ${yearOf(state.turn)}. Reservas: ${fmt(faction.gold)} oro · ${fmt(faction.foodStock)} alimento · ${fmt(faction.manpower)} levas.`,
      ]),

      el('h3', { className: 'rdh-subtitle' }, ['Ingresos por provincia']),
      el('dl', {}, provRows.length ? provRows : [el('p', { className: 'rdh-note' }, ['Sin provincias que rindan impuestos.'])]),
      econRow('Ingresos totales', `${fmt(income)} oro`, false, true),

      el('h3', { className: 'rdh-subtitle' }, ['Mantenimiento por ejército']),
      el('dl', {}, upkeepRows.length ? upkeepRows : [el('p', { className: 'rdh-note' }, ['Sin tropas en pie de guerra.'])]),
      econRow('Mantenimiento total', `${fmt(upkeep)} oro`, false, true),
      econRow('Balance neto', `${fmtSigned(income - upkeep)} oro/turno`, false, true),

      el('h3', { className: 'rdh-subtitle' }, ['Alimento']),
      el('dl', {}, [
        econRow('Producción', `${fmt(foodProd)} /turno`, true),
        econRow('Consumo (tropas + provincias)', `${fmt(foodCons)} /turno`, true),
        econRow('Balance', `${fmtSigned(foodProd - foodCons)} /turno`, false, true),
      ]),

      el('h3', { className: 'rdh-subtitle' }, ['Levas']),
      el('dl', {}, [
        econRow('Ganancia por turno', `+${fmt(mpGain)}`, true),
        econRow('Tope del reino', `${fmt(mpCap)}`, true),
      ]),
    ];
  }

  function safeUpkeep(typeId: string): number {
    try { return getUnitType(typeId).upkeep; } catch { return 0; }
  }

  function econRow(label: string, value: string, sub = false, total = false): HTMLElement {
    return el('div', { className: `rdh-econ-row${total ? ' rdh-econ-row--total' : ''}` }, [
      el('span', { className: sub ? 'rdh-econ-row__sub' : '' }, [label]),
      el('dd', {}, [value]),
    ]);
  }

  // ---------------------------------------------------------------- CRÓNICA
  function renderCronica(state: GameState): Child[] {
    const entries = [...state.chronicle].reverse().slice(0, 12);
    if (entries.length === 0) {
      return [el('p', { className: 'rdh-note' }, ['Aún no hay crónica que contar.'])];
    }
    return entries.map(e => el('div', { className: 'rdh-chron-entry' }, [
      el('span', { className: 'rdh-chron-entry__icon', 'aria-hidden': 'true' }, [CHRONICLE_ICON[e.kind] ?? '✦']),
      el('div', {}, [
        el('p', { className: 'rdh-chron-entry__date' }, [`${SEASON_NAMES[seasonOf(e.turn)]} · Año ${yearOf(e.turn)}`]),
        el('p', { className: 'rdh-chron-entry__text' }, [e.text]),
      ]),
    ]));
  }

  function cultureName(id: GameState['factions'][string]['cultureId']): string {
    return CULTURES[id]?.name ?? id;
  }

  // ---------------------------------------------------------------- render / control
  function render(): void {
    if (!currentKey || !store.hasGame) return;
    const state = store.state;
    titleEl.textContent = PANEL_TITLE[currentKey];
    let content: Child[];
    switch (currentKey) {
      case 'trono': content = renderTrono(state); break;
      case 'cuartel': content = renderCuartel(state); break;
      case 'tesoreria': content = renderTesoreria(state); break;
      case 'cronica': content = renderCronica(state); break;
      default: content = [];
    }
    replaceChildren(body, content);
    body.scrollTop = 0;
  }

  function open(key: PanelKey): void {
    if (key !== 'cuartel') recruitResult = null;
    currentKey = key;
    render();
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function close(): void {
    currentKey = null;
    recruitResult = null;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
  }

  return {
    el: panel,
    open,
    close,
    isOpen: () => currentKey !== null,
    current: () => currentKey,
    refresh: () => { if (currentKey) render(); },
    dispose: () => { panel.remove(); },
  };
}
