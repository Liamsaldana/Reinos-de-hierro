/**
 * Panel izquierdo contextual: detalle de provincia o ejército según
 * store.selection. Incluye reclutamiento y el modo "mover hueste".
 */
import type { GameStore } from '../../core/state/store';
import type {
  Army, ArmyId, GameState, Province, ProvinceId, Selection, UnitCost, UnitType, WorldBridge,
} from '../../core/types';
import { recruitUnit, moveArmy, legalMoves } from '../../core/systems/actions';
import { unitTypesFor, getUnitType } from '../../core/content/units';
import { armyStrength } from '../../core/combat/autoresolve';
import { el, fmt, clear, replaceChildren, type Child } from './dom';
import {
  TERRAIN_ES, UNIT_CATEGORY_ES, ownerLabel, settlementLabel, fortLabel, factionHasResource,
} from './format';
import type { ToastStack } from './toast';

export interface LeftPanel {
  refresh(): void;
}

function costLabel(cost: UnitCost): string {
  const parts = [`${fmt(cost.gold)}⛁`, `${fmt(cost.manpower)}⚔`];
  if (cost.iron) parts.push(`${fmt(cost.iron)} hierro`);
  if (cost.horses) parts.push(`${fmt(cost.horses)} caballos`);
  return parts.join(' · ');
}

export function createLeftPanel(
  container: HTMLElement,
  store: GameStore,
  getWorld: () => WorldBridge | null,
  toast: ToastStack,
): LeftPanel {
  const panel = el('div', { className: 'left-panel' });
  container.append(panel);

  let moveMode: { armyId: ArmyId; targets: ProvinceId[] } | null = null;

  function exitMoveMode(): void {
    if (moveMode) {
      getWorld()?.setMoveTargets(null);
      moveMode = null;
    }
  }

  function renderProvince(state: GameState, province: Province): void {
    const isMine = province.ownerId === state.playerFactionId;
    const children: Child[] = [
      el('h2', { className: 'panel-title' }, [province.name]),
      el('dl', { className: 'stat-list' }, [
        statRow('Terreno', TERRAIN_ES[province.terrain]),
        statRow('Dueño', ownerLabel(state, province)),
        statRow('Asentamiento', settlementLabel(province)),
        statRow('Fortificación', fortLabel(province)),
        statRow('Guarnición', fmt(province.garrison)),
      ]),
      el('h3', { className: 'panel-subtitle' }, ['Economía']),
      el('dl', { className: 'stat-list' }, [
        statRow('Impuestos', `${fmt(province.baseTax)} ⛁/turno`),
        statRow('Alimento', `${fmt(province.baseFood)} ❋/turno`),
        statRow('Levas', `${fmt(province.baseManpower)} ⚔/turno`),
      ]),
      el('h3', { className: 'panel-subtitle' }, ['Recursos']),
      el('p', { className: 'resource-line' }, [
        `Hierro: ${province.iron ? 'sí' : 'no'} · Caballos: ${province.horses ? 'sí' : 'no'}`,
      ]),
    ];

    if (isMine) {
      const faction = state.factions[state.playerFactionId];
      const units = unitTypesFor(faction.cultureId);
      children.push(el('h3', { className: 'panel-subtitle' }, ['Reclutar']));
      if (units.length === 0) {
        children.push(el('p', { className: 'notice notice--pending' }, ['Contenido pendiente: sin tipos de unidad disponibles.']));
      } else {
        children.push(el('div', { className: 'recruit-list' }, units.map(u => recruitRow(state, faction.id, province, u))));
      }
    }

    replaceChildren(panel, children);
  }

  function recruitRow(state: GameState, factionId: string, province: Province, unitType: UnitType): HTMLElement {
    const faction = state.factions[factionId];
    const reasons: string[] = [];
    if (faction.gold < unitType.cost.gold) reasons.push('Oro insuficiente');
    if (faction.manpower < unitType.cost.manpower) reasons.push('Levas insuficientes');
    if (unitType.cost.iron && !factionHasResource(state, factionId, 'iron')) reasons.push('Requiere una provincia con hierro');
    if (unitType.cost.horses && !factionHasResource(state, factionId, 'horses')) reasons.push('Requiere una provincia con caballos');
    const disabled = reasons.length > 0;
    return el('div', { className: 'recruit-row' }, [
      el('span', { className: 'recruit-row__name' }, [unitType.name]),
      el('span', { className: 'recruit-row__cat' }, [UNIT_CATEGORY_ES[unitType.category]]),
      el('span', { className: 'recruit-row__cost' }, [costLabel(unitType.cost)]),
      el('button', {
        type: 'button',
        className: 'btn btn--small',
        disabled,
        title: disabled ? reasons.join('; ') : 'Reclutar esta unidad',
        onclick: () => {
          const rng = store.rng();
          const result = store.mutate(
            s => recruitUnit(s, rng, factionId, province.id, unitType.id),
            { type: 'economy-changed' },
          );
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, ['Reclutar']),
    ]);
  }

  function renderArmy(state: GameState, army: Army): void {
    const faction = state.factions[army.factionId];
    const general = army.generalId ? state.characters[army.generalId] : null;
    const isMine = army.factionId === state.playerFactionId;
    const inMoveMode = moveMode?.armyId === army.id;

    const children: Child[] = [
      el('h2', { className: 'panel-title' }, [army.name]),
      el('dl', { className: 'stat-list' }, [
        statRow('Casa', faction ? faction.dynastyName : '—'),
        statRow('General', general ? `${general.name} (mando ${general.attributes.martial})` : 'Sin general asignado'),
        statRow('Movimiento', `${fmt(army.movement)} / ${fmt(army.movementMax)}`),
        statRow('Fuerza total', fmt(armyStrength(state, army))),
      ]),
      el('h3', { className: 'panel-subtitle' }, ['Unidades']),
      el('div', { className: 'unit-table' }, army.units.length > 0
        ? army.units.map(u => unitRow(u))
        : [el('p', { className: 'notice' }, ['Ejército sin unidades.'])]),
    ];

    if (isMine && army.movement > 0) {
      children.push(el('button', {
        type: 'button',
        className: `btn ${inMoveMode ? 'btn--danger' : ''}`,
        onclick: () => {
          if (inMoveMode) {
            exitMoveMode();
          } else {
            exitMoveMode();
            const targets = legalMoves(state, army.id);
            moveMode = { armyId: army.id, targets };
            getWorld()?.setMoveTargets(targets);
          }
          render();
        },
      }, [inMoveMode ? 'Cancelar' : 'Mover hueste']));
    }

    replaceChildren(panel, children);

    function unitRow(u: Army['units'][number]): HTMLElement {
      let name = u.typeId;
      let moraleMax = Math.max(u.morale, 1);
      try {
        const t = getUnitType(u.typeId);
        name = t.name;
        moraleMax = t.moraleMax;
      } catch { /* banco de unidades aún sin datos (stub en paralelo) */ }
      const pct = moraleMax > 0 ? Math.max(0, Math.min(100, (u.morale / moraleMax) * 100)) : 0;
      return el('div', { className: 'unit-row' }, [
        el('span', { className: 'unit-row__name' }, [name]),
        el('span', { className: 'unit-row__men' }, [`${fmt(u.men)} hombres`]),
        el('span', { className: 'morale-bar', title: `Moral ${u.morale}/${moraleMax}` }, [
          el('span', { className: 'morale-bar__fill', style: `width:${pct}%` }, []),
        ]),
      ]);
    }
  }

  function statRow(label: string, value: string): HTMLElement {
    return el('div', { className: 'stat-row' }, [
      el('dt', {}, [label]),
      el('dd', {}, [value]),
    ]);
  }

  function handleSelectionForMove(sel: Selection): boolean {
    if (!moveMode) return false;
    if (sel && sel.kind === 'province' && moveMode.targets.includes(sel.id)) {
      const armyId = moveMode.armyId;
      const toId = sel.id;
      exitMoveMode();
      const rng = store.rng();
      const result = store.mutate(s => moveArmy(s, rng, armyId, toId), { type: 'map-changed' });
      if (result.battle) store.emit({ type: 'battle', report: result.battle });
      toast.show(result.message, result.ok ? 'info' : 'warn');
      store.setSelection({ kind: 'army', id: armyId });
      return true;
    }
    exitMoveMode();
    return false;
  }

  function render(): void {
    if (!store.hasGame) { clear(panel); panel.classList.remove('is-visible'); return; }
    const state = store.state;
    const sel = store.selection;
    if (!sel) { clear(panel); panel.classList.remove('is-visible'); return; }
    if (sel.kind === 'province') {
      const province = state.provinces.find(p => p.id === sel.id);
      if (!province) { clear(panel); panel.classList.remove('is-visible'); return; }
      panel.classList.add('is-visible');
      renderProvince(state, province);
    } else {
      const army = state.armies[sel.id];
      if (!army) { clear(panel); panel.classList.remove('is-visible'); return; }
      panel.classList.add('is-visible');
      renderArmy(state, army);
    }
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'state-replaced') { exitMoveMode(); render(); return; }
    if (ev.type === 'selection') {
      if (handleSelectionForMove(ev.selection)) return;
      render();
      return;
    }
    if (ev.type === 'turn-ended' || ev.type === 'map-changed' || ev.type === 'economy-changed') {
      render();
    }
  });

  return { refresh: render };
}
