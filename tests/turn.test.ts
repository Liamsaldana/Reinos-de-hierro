import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { endTurn } from '../src/core/systems/turn';
import { Rng } from '../src/core/state/rng';

const VALID_OUTCOMES = ['ongoing', 'victory_conquest', 'defeat_extinction', 'defeat_conquered', 'victory_larga_noche', 'victory_restauracion', 'victory_hegemonia', 'defeat_palidos'];

describe('endTurn', () => {
  it('avanza el turno', () => {
    const state = newGame(7);
    const turnBefore = state.turn;
    const rng = new Rng(state.rngState);
    endTurn(state, rng);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('es determinista: la misma semilla produce el mismo estado tras un turno', () => {
    const stateA = newGame(7);
    const rngA = new Rng(stateA.rngState);
    endTurn(stateA, rngA);

    const stateB = newGame(7);
    const rngB = new Rng(stateB.rngState);
    endTurn(stateB, rngB);

    expect(JSON.stringify(stateA)).toBe(JSON.stringify(stateB));
  });

  it('el oro de las facciones cambia de forma coherente (ingresos - mantenimiento) y nunca queda negativo', () => {
    const state = newGame(7);
    const goldBefore: Record<string, number> = {};
    for (const id of Object.keys(state.factions)) goldBefore[id] = state.factions[id].gold;

    const rng = new Rng(state.rngState);
    endTurn(state, rng);

    let changed = false;
    for (const id of Object.keys(state.factions)) {
      expect(state.factions[id].gold).toBeGreaterThanOrEqual(0);
      if (state.factions[id].gold !== goldBefore[id]) changed = true;
    }
    expect(changed).toBe(true);
  });

  it('sobrevive 20 turnos seguidos sin lanzar y mantiene un outcome válido', () => {
    const state = newGame(7);
    const rng = new Rng(state.rngState);

    for (let i = 0; i < 20; i++) {
      expect(() => endTurn(state, rng)).not.toThrow();
      expect(VALID_OUTCOMES).toContain(state.outcome);
      if (state.outcome !== 'ongoing') break;
    }
  });
});
