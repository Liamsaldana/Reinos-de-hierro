/**
 * Franja de estado: fila fina de chips clicables bajo la barra superior —
 * el "tracker de misiones" de la referencia, adaptado a un juego por
 * turnos. Cada chip solo aparece si su cuenta es > 0 (sucesión: si hay
 * riesgo). Nunca reemplaza al panel de guerras ni al panel izquierdo, solo
 * apunta hacia ellos.
 */
import type { GameStore } from '../../core/state/store';
import type { WorldBridge } from '../../core/types';
import { el, fmt, fmtSigned, replaceChildren } from './dom';
import { computeThreats, idleArmies, successionAtRisk } from './gameQueries';
import { glyphHtml, onIconsReady } from './iconGlyph';

export interface StatusStrip {
  refresh(): void;
}

export function createStatusStrip(
  container: HTMLElement,
  store: GameStore,
  getWorld: () => WorldBridge | null,
  onOpenWars: () => void,
): StatusStrip {
  const strip = el('div', { className: 'status-strip', 'aria-label': 'Estado del reino' });
  container.append(strip);

  let idleCursor = 0;
  let threatCursor = 0;

  function cycleIdle(): void {
    if (!store.hasGame) return;
    const armies = idleArmies(store.state);
    if (armies.length === 0) return;
    idleCursor %= armies.length;
    const army = armies[idleCursor];
    idleCursor += 1;
    store.setSelection({ kind: 'army', id: army.id });
    getWorld()?.focusProvince(army.provinceId);
  }

  function cycleThreats(): void {
    if (!store.hasGame) return;
    const threats = computeThreats(store.state);
    if (threats.length === 0) return;
    threatCursor %= threats.length;
    const t = threats[threatCursor];
    threatCursor += 1;
    getWorld()?.focusProvince(t.provinceId);
  }

  function focusCapital(): void {
    if (!store.hasGame) return;
    const state = store.state;
    const capital = state.provinces.find(
      p => p.ownerId === state.playerFactionId && p.settlement.level === 4,
    );
    if (capital) getWorld()?.focusProvince(capital.id);
  }

  function chip(opts: {
    iconName: string; fallback: string; label: string; title: string;
    onClick: () => void; danger?: boolean;
  }): HTMLElement {
    const iconSpan = el('span', { className: 'status-chip__icon', 'aria-hidden': 'true' });
    iconSpan.innerHTML = glyphHtml(opts.iconName, opts.fallback, 14);
    return el('button', {
      type: 'button',
      className: `status-chip${opts.danger ? ' status-chip--danger' : ''}`,
      title: opts.title,
      'aria-label': opts.title,
      onclick: opts.onClick,
    }, [iconSpan, el('span', { className: 'status-chip__label' }, [opts.label])]);
  }

  function render(): void {
    if (!store.hasGame) { replaceChildren(strip, []); strip.classList.add('is-empty'); return; }
    const state = store.state;
    const playerId = state.playerFactionId;
    const myWars = state.wars.filter(w => w.attackerId === playerId || w.defenderId === playerId);
    const idle = idleArmies(state);
    const threats = computeThreats(state);
    const atRisk = successionAtRisk(state);

    const chips: HTMLElement[] = [];

    if (myWars.length > 0) {
      const lines = myWars.map(w => {
        const enemyId = w.attackerId === playerId ? w.defenderId : w.attackerId;
        const enemy = state.factions[enemyId];
        const score = w.attackerId === playerId ? w.warScore : -w.warScore;
        const enemyLabel = enemy ? `${enemy.dynastyName} · ${enemy.name}` : enemyId;
        return `${enemyLabel}: puntaje ${fmtSigned(score)}`;
      });
      chips.push(chip({
        iconName: 'guerra', fallback: '⚔',
        label: `Guerras (${myWars.length})`,
        title: lines.join('\n'),
        onClick: onOpenWars,
        danger: true,
      }));
    }

    if (idle.length > 0) {
      chips.push(chip({
        iconName: 'movimiento', fallback: '⚑',
        label: `Huestes listas (${idle.length})`,
        title: 'Huestes con movimiento sin gastar este turno. Clic: selecciona y enfoca cada una por turno.',
        onClick: cycleIdle,
      }));
    }

    if (threats.length > 0) {
      chips.push(chip({
        iconName: 'amenaza', fallback: '⚠',
        label: `Provincias amenazadas (${fmt(threats.length)})`,
        title: 'Ejércitos enemigos junto a tus fronteras. Clic: enfoca cada provincia amenazada.',
        onClick: cycleThreats,
        danger: true,
      }));
    }

    if (atRisk) {
      chips.push(chip({
        iconName: 'legitimidad', fallback: '♛',
        label: 'Sucesión en riesgo',
        title: 'Sin heredero vivo: la dinastía se extingue si el gobernante muere. Clic: enfoca la capital.',
        onClick: focusCapital,
        danger: true,
      }));
    }

    replaceChildren(strip, chips);
    strip.classList.toggle('is-empty', chips.length === 0);
  }

  store.subscribe((_state, ev) => {
    if (
      ev.type === 'state-replaced' || ev.type === 'turn-ended'
      || ev.type === 'map-changed' || ev.type === 'economy-changed'
    ) render();
  });
  onIconsReady(() => render());

  return { refresh: render };
}
