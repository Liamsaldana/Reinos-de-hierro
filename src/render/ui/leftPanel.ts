/**
 * Panel izquierdo contextual: detalle de provincia o ejército según
 * store.selection. Incluye reclutamiento y el modo "mover hueste".
 */
import type { GameStore } from '../../core/state/store';
import type {
  Army, ArmyId, BuildingId, BuildQueueItem, GameState, Province, ProvinceId, Selection,
  UnitCategory, UnitCost, UnitType, WorldBridge,
} from '../../core/types';
import { recruitUnit, moveArmy, legalMoves, wouldTriggerBattle } from '../../core/systems/actions';
import {
  buildableIn, cancelConstruction, startConstruction, WALL_UPGRADE_ID,
} from '../../core/systems/construction';
import { convertCost, convertProvince, religionTension } from '../../core/systems/religion';
import { launchTacticalBattle } from '../../game/battleFlow';
import { unitTypesFor, getUnitType } from '../../core/content/units';
import { getBuilding, type BuildingCost, type BuildingDef } from '../../core/content/buildings';
import { RELIGIONS } from '../../core/content/cultures';
import { armyStrength } from '../../core/combat/autoresolve';
import { el, fmt, clear, replaceChildren, type Child } from './dom';
import {
  TERRAIN_ES, UNIT_CATEGORY_ES, ownerLabel, settlementLabel, fortLabel, factionHasResource,
} from './format';
import { glyphHtml } from './iconGlyph';
import type { ToastStack } from './toast';

export interface LeftPanel {
  refresh(): void;
}

const UNIT_CATEGORY_ICON: Record<UnitCategory, string> = {
  infantry: 'infanteria',
  cavalry: 'caballeria',
  ranged: 'arco',
  spear: 'lanceros',
  siege: 'asedio',
};

function categoryBadge(category: UnitCategory): HTMLElement {
  const icon = el('span', { className: 'category-badge__icon', 'aria-hidden': 'true' });
  icon.innerHTML = glyphHtml(UNIT_CATEGORY_ICON[category], '', 14);
  return el('span', { className: 'category-badge', title: UNIT_CATEGORY_ES[category] }, [
    icon, UNIT_CATEGORY_ES[category],
  ]);
}

function costLabel(cost: UnitCost): string {
  const parts = [`${fmt(cost.gold)}⛁`, `${fmt(cost.manpower)}⚔`];
  if (cost.iron) parts.push(`${fmt(cost.iron)} hierro`);
  if (cost.horses) parts.push(`${fmt(cost.horses)} caballos`);
  return parts.join(' · ');
}

/** chip para un edificio ya construido, con el efecto como tooltip. */
function buildingChip(id: BuildingId): HTMLElement {
  try {
    const def = getBuilding(id);
    return el('span', { className: 'status-chip', title: def.blurb }, [def.name]);
  } catch {
    return el('span', { className: 'status-chip', title: 'Edificio desconocido' }, [id]);
  }
}

/** resumen corto de los `effects` de un edificio, para la fila de "construible". */
function effectSummary(def: BuildingDef): string {
  const e = def.effects;
  const parts: string[] = [];
  if (e.taxFlat) parts.push(`+${fmt(e.taxFlat)} oro`);
  if (e.foodFlat) parts.push(`+${fmt(e.foodFlat)} alimento`);
  if (e.manpowerFlat) parts.push(`+${fmt(e.manpowerFlat)} levas`);
  if (e.researchFlat) parts.push(`+${fmt(e.researchFlat)} investigación`);
  if (e.legitimacyFlat) parts.push(`+${fmt(e.legitimacyFlat)} legitimidad`);
  return parts.length > 0 ? parts.join(' · ') : 'Mejora la defensa';
}

function buildCostLabel(cost: BuildingCost): string {
  return `${fmt(cost.gold)}⛁ · ${cost.turns} turno${cost.turns === 1 ? '' : 's'}`;
}

function queueLabel(queue: BuildQueueItem): string {
  if (queue.buildingId === WALL_UPGRADE_ID) return 'Mejora de fortificación';
  try {
    return getBuilding(queue.buildingId).name;
  } catch {
    return queue.buildingId;
  }
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
      children.push(...buildingsSection(state, faction.id, province));
      children.push(...religionSection(state, faction.id, province));

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

  /** Sección CONSTRUCCIÓN (Fase 2, GDD §9.1): edificios construidos, obra en curso, construibles. */
  function buildingsSection(state: GameState, factionId: string, province: Province): Child[] {
    const children: Child[] = [el('h3', { className: 'panel-subtitle' }, ['Construcción'])];
    const built = province.buildings ?? [];

    if (built.length > 0) {
      children.push(el('div', { className: 'building-chips' }, built.map(id => buildingChip(id))));
    }

    if (province.buildQueue) {
      children.push(queueRow(factionId, province, province.buildQueue));
    }

    const options = buildableIn(state, province.id);
    if (options.length > 0) {
      children.push(el('div', { className: 'recruit-list' }, options.map(def => buildRow(state, factionId, province, def))));
    } else if (!province.buildQueue) {
      children.push(el('p', { className: 'notice' }, ['Sin ranuras libres o nada más que construir aquí.']));
    }

    return children;
  }

  function queueRow(factionId: string, province: Province, queue: BuildQueueItem): HTMLElement {
    return el('div', { className: 'recruit-row' }, [
      el('span', { className: 'recruit-row__name' }, [queueLabel(queue)]),
      el('span', { className: 'recruit-row__cat' }, [`${queue.turnsLeft} turno${queue.turnsLeft === 1 ? '' : 's'}`]),
      el('button', {
        type: 'button',
        className: 'btn btn--small btn--danger',
        title: 'Cancela la obra y recupera la mitad del oro pagado',
        onclick: () => {
          const result = store.mutate(
            s => cancelConstruction(s, factionId, province.id),
            { type: 'economy-changed' },
          );
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, ['Cancelar']),
    ]);
  }

  function buildRow(state: GameState, factionId: string, province: Province, def: BuildingDef): HTMLElement {
    const faction = state.factions[factionId];
    const reasons: string[] = [];
    if (faction.gold < def.cost.gold) reasons.push(`Oro insuficiente: cuesta ${def.cost.gold}, tienes ${faction.gold}`);
    const disabled = reasons.length > 0;
    return el('div', { className: 'recruit-row', title: def.blurb }, [
      el('span', { className: 'recruit-row__name' }, [def.name]),
      el('span', { className: 'recruit-row__cat' }, [effectSummary(def)]),
      el('span', { className: 'recruit-row__cost' }, [buildCostLabel(def.cost)]),
      el('button', {
        type: 'button',
        className: 'btn btn--small',
        disabled,
        title: disabled ? reasons.join('; ') : `Construir ${def.name}`,
        onclick: () => {
          const result = store.mutate(
            s => startConstruction(s, factionId, province.id, def.id),
            { type: 'economy-changed' },
          );
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, ['Construir']),
    ]);
  }

  /** Sección FE (Fase 2, GDD §2.3): fe dominante de la provincia + conversión si hay tensión. */
  function religionSection(state: GameState, factionId: string, province: Province): Child[] {
    const faction = state.factions[factionId];
    const religionId = province.religionId ?? faction.religionId;
    const religionName = RELIGIONS[religionId]?.name ?? religionId;
    const children: Child[] = [
      el('h3', { className: 'panel-subtitle' }, ['Fe']),
      el('p', { className: 'resource-line' }, [`Fe: ${religionName}`]),
    ];

    if (religionTension(state, province.id)) {
      const cost = convertCost(state, province.id);
      children.push(el('p', { className: 'notice' }, [
        'Tensión religiosa: esta provincia no comparte la fe de la corona.',
      ]));
      children.push(el('button', {
        type: 'button',
        className: 'btn btn--small',
        title: `Convierte ${province.name} a la fe de la Casa ${faction.dynastyName}`,
        onclick: () => {
          const result = store.mutate(
            s => convertProvince(s, factionId, province.id),
            { type: 'economy-changed' },
          );
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, [`Convertir (−${cost} oro)`]));
    }

    return children;
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
      el('span', { className: 'recruit-row__cat' }, [categoryBadge(unitType.category)]),
      el('span', { className: 'recruit-row__cost', title: costLabel(unitType.cost) }, [costLabel(unitType.cost)]),
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
      if (wouldTriggerBattle(store.state, armyId, toId)) {
        askBattleMode(store.state, toId, mode => {
          if (mode === 'tactical') {
            void launchTacticalBattle(store, armyId, toId).then(r => {
              toast.show(r.message, r.ok ? 'info' : 'warn');
            });
          } else {
            executeAutoMove(armyId, toId);
          }
        });
        return true;
      }
      executeAutoMove(armyId, toId);
      return true;
    }
    exitMoveMode();
    return false;
  }

  function executeAutoMove(armyId: ArmyId, toId: ProvinceId): void {
    const rng = store.rng();
    const result = store.mutate(s => moveArmy(s, rng, armyId, toId), { type: 'map-changed' });
    if (result.battle) store.emit({ type: 'battle', report: result.battle });
    toast.show(result.message, result.ok ? 'info' : 'warn');
    if (store.state.armies[armyId]) store.setSelection({ kind: 'army', id: armyId });
  }

  /** Modal mínimo: comandar en persona (batalla táctica) o confiar en los capitanes. */
  function askBattleMode(
    state: GameState, provinceId: ProvinceId, onChoose: (mode: 'tactical' | 'auto') => void,
  ): void {
    const province = state.provinces.find(p => p.id === provinceId);
    const backdrop = el('div', { className: 'modal-backdrop is-visible' });
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '95', background: 'rgba(20,17,15,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    const box = el('div', {});
    Object.assign(box.style, {
      background: '#1B1716', border: '1px solid rgba(237,235,222,.14)', borderRadius: '2px',
      padding: '22px 26px', maxWidth: '420px', textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);
    const title = el('h2', { className: 'panel-title' }, [`Batalla por ${province?.name ?? 'la provincia'}`]);
    const sub = el('p', { className: 'notice' }, ['El enemigo presenta batalla. ¿Quién dará las órdenes?']);
    const mkBtn = (label: string, primary: boolean, mode: 'tactical' | 'auto'): HTMLElement => {
      const b = el('button', {
        type: 'button',
        className: primary ? 'btn btn--primary' : 'btn',
        onclick: () => { backdrop.remove(); onChoose(mode); },
      }, [label]);
      (b as HTMLElement).style.margin = '6px';
      return b;
    };
    box.append(title, sub, mkBtn('Comandar en persona', true, 'tactical'), mkBtn('Confiar en los capitanes', false, 'auto'));
    backdrop.append(box);
    document.body.appendChild(backdrop);
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
