/**
 * Panel derecho: guerras activas del jugador (puntaje, agotamiento, negociar
 * paz) y, si la selección es una provincia extranjera, la caja diplomática
 * (opinión + declarar guerra).
 */
import type { GameStore } from '../../core/state/store';
import type { CasusBelli, FactionId, GameState, Province, War } from '../../core/types';
import { relKey } from '../../core/types';
import { declareWar, negotiatePeace } from '../../core/systems/actions';
import { el, fmt, fmtSigned, clear, replaceChildren, type Child } from './dom';
import { CASUS_BELLI_ES } from './format';
import type { ToastStack } from './toast';

export interface WarsPanel {
  refresh(): void;
}

function hasWarBetween(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(w => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a));
}

function hasTruce(state: GameState, a: FactionId, b: FactionId): boolean {
  const rel = state.relations[relKey(a, b)];
  return rel?.truceUntilTurn !== undefined && rel.truceUntilTurn > state.turn;
}

export function createWarsPanel(container: HTMLElement, store: GameStore, toast: ToastStack): WarsPanel {
  const panel = el('div', { className: 'wars-panel' });
  container.append(panel);

  function warScoreBar(scoreFromPlayer: number): HTMLElement {
    const pct = Math.max(0, Math.min(100, 50 + scoreFromPlayer / 2));
    return el('div', { className: 'warscore-bar', title: `Puntaje de guerra: ${fmtSigned(scoreFromPlayer)}` }, [
      el('div', { className: 'warscore-bar__zero' }),
      el('div', { className: 'warscore-bar__marker', style: `left:${pct}%` }),
    ]);
  }

  function warRow(state: GameState, war: War): HTMLElement {
    const playerId = state.playerFactionId;
    const isAttacker = war.attackerId === playerId;
    const enemyId = isAttacker ? war.defenderId : war.attackerId;
    const enemy = state.factions[enemyId];
    const scoreFromPlayer = isAttacker ? war.warScore : -war.warScore;
    const exhaustion = isAttacker ? war.exhaustionAttacker : war.exhaustionDefender;
    const enemyLabel = enemy ? `${enemy.dynastyName} · ${enemy.name}` : enemyId;

    function peaceBtn(label: string, kind: 'white' | 'concede'): HTMLElement {
      return el('button', {
        type: 'button',
        className: 'btn btn--small',
        onclick: () => {
          if (!window.confirm(`¿Negociar paz (${label}) con ${enemyLabel}?`)) return;
          const result = store.mutate(s => negotiatePeace(s, war.id, kind), { type: 'map-changed' });
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, [label]);
    }

    return el('div', { className: 'war-row' }, [
      el('h4', { className: 'war-row__enemy' }, [enemyLabel]),
      warScoreBar(scoreFromPlayer),
      el('p', { className: 'war-row__exhaustion' }, [`Agotamiento propio: ${fmt(exhaustion)}`]),
      el('div', { className: 'war-row__actions' }, [
        peaceBtn('Paz blanca', 'white'),
        peaceBtn(scoreFromPlayer >= 0 ? 'Exigir cesión' : 'Ceder', 'concede'),
      ]),
    ]);
  }

  function diplomaticBox(state: GameState, province: Province): HTMLElement {
    const playerId = state.playerFactionId;
    const otherId = province.ownerId as FactionId;
    const other = state.factions[otherId];
    const relation = state.relations[relKey(playerId, otherId)];
    const opinion = relation?.opinion ?? 0;
    const atWar = hasWarBetween(state, playerId, otherId);
    const truce = hasTruce(state, playerId, otherId);
    const otherLabel = other ? `${other.dynastyName} · ${other.name}` : otherId;

    function warBtn(cb: CasusBelli): HTMLElement {
      return el('button', {
        type: 'button',
        className: 'btn btn--small btn--danger',
        onclick: () => {
          const confirmMsg = cb === 'sin_causa'
            ? `¿Declarar guerra a ${otherLabel} sin más causa que la ambición? Dañará tu legitimidad y la opinión de todos.`
            : `¿Declarar guerra a ${otherLabel} invocando un reclamo?`;
          if (!window.confirm(confirmMsg)) return;
          const result = store.mutate(s => declareWar(s, playerId, otherId, cb), { type: 'map-changed' });
          toast.show(result.message, result.ok ? 'info' : 'warn');
        },
      }, [`Declarar guerra (${CASUS_BELLI_ES[cb]})`]);
    }

    const children: Child[] = [
      el('h3', { className: 'panel-subtitle' }, ['Diplomacia']),
      el('p', { className: 'diplo-target' }, [otherLabel]),
      el('p', { className: 'diplo-opinion' }, [`Opinión: ${fmtSigned(opinion)}`]),
    ];
    if (atWar) {
      children.push(el('p', { className: 'notice' }, ['Ya estáis en guerra.']));
    } else if (truce) {
      children.push(el('p', { className: 'notice' }, ['Tregua vigente: no se puede declarar guerra todavía.']));
    } else {
      children.push(el('div', { className: 'diplo-actions' }, [warBtn('reclamo'), warBtn('sin_causa')]));
    }
    return el('div', { className: 'diplo-box' }, children);
  }

  function render(): void {
    if (!store.hasGame) { clear(panel); panel.classList.remove('is-visible'); return; }
    const state = store.state;
    const playerId = state.playerFactionId;
    const myWars = state.wars.filter(w => w.attackerId === playerId || w.defenderId === playerId);

    let diplo: HTMLElement | null = null;
    const sel = store.selection;
    if (sel && sel.kind === 'province') {
      const province = state.provinces.find(p => p.id === sel.id);
      if (province && province.ownerId && province.ownerId !== playerId) {
        diplo = diplomaticBox(state, province);
      }
    }

    if (myWars.length === 0 && !diplo) { clear(panel); panel.classList.remove('is-visible'); return; }
    panel.classList.add('is-visible');
    const children: Child[] = [];
    if (myWars.length > 0) {
      children.push(el('h2', { className: 'panel-title' }, ['Guerras']));
      children.push(...myWars.map(w => warRow(state, w)));
    }
    if (diplo) children.push(diplo);
    replaceChildren(panel, children);
  }

  store.subscribe((_state, ev) => {
    if (ev.type === 'selection' || ev.type === 'map-changed' || ev.type === 'turn-ended' || ev.type === 'state-replaced') {
      render();
    }
  });

  return { refresh: render };
}
