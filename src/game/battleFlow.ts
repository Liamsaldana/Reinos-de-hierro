/**
 * Puente estratégico ↔ táctico (integrador). El jugador elige comandar en
 * persona (batalla Phaser, GDD §8) o auto-resolver (GDD §8.4). Phaser se
 * carga con import dinámico: el mapa no paga el peso de la batalla.
 */
import type { ArmyId, BattleReport, FactionId, GameState, ProvinceId } from '../core/types';
import type { GameStore } from '../core/state/store';
import {
  moveArmyIntoBattle, occupyProvince, type ActionResult,
} from '../core/systems/actions';

/** Ocupación tras la batalla táctica (espejo del camino auto-resuelto de moveArmy). */
export function finishTacticalOnMap(
  state: GameState, attackerFactionId: FactionId, report: BattleReport,
): void {
  if (report.winner !== 'attacker') return;
  const province = state.provinces.find(p => p.id === report.provinceId);
  if (!province) return;
  const hostile = province.ownerId === null || province.ownerId !== attackerFactionId;
  const stillDefended =
    province.garrison > 0 ||
    Object.values(state.armies).some(
      a => a.provinceId === province.id && a.factionId !== attackerFactionId,
    );
  if (hostile && !stillDefended) occupyProvince(state, attackerFactionId, province);
}

/**
 * Mueve el ejército al campo y abre la batalla táctica a pantalla completa.
 * Devuelve el resultado del movimiento; el parte llega después vía el evento
 * 'battle' del store cuando el jugador termina la batalla.
 */
export async function launchTacticalBattle(
  store: GameStore, armyId: ArmyId, toProvinceId: ProvinceId,
): Promise<ActionResult> {
  const army = store.state.armies[armyId];
  if (!army) return { ok: false, message: 'Ejército no encontrado.' };
  const attackerFactionId = army.factionId;

  const moved = store.mutate(s => moveArmyIntoBattle(s, armyId, toProvinceId), { type: 'map-changed' });
  if (!moved.ok) return moved;

  const { openTacticalBattle } = await import('../render/battle/battleScene');

  const overlay = document.createElement('div');
  overlay.setAttribute('aria-label', 'Batalla táctica');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100',
    background: '#14110f',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);

  const rng = store.rng();
  openTacticalBattle({
    container: overlay,
    state: store.state,
    rng,
    attackerFactionId,
    provinceId: toProvinceId,
    playerFactionId: store.state.playerFactionId,
    onDone: (report: BattleReport) => {
      store.mutate(s => finishTacticalOnMap(s, attackerFactionId, report), { type: 'map-changed' });
      overlay.remove();
      store.emit({ type: 'battle', report });
    },
  });

  const name = store.state.provinces.find(p => p.id === toProvinceId)?.name ?? 'el campo';
  return { ok: true, message: `La hueste marcha sobre ${name}: tomas el mando en persona.` };
}
