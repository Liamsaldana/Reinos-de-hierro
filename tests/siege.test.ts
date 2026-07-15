/**
 * Tests de asedios (Fase 2, GDD §9.2, alcance v1: bloqueo por provisiones +
 * asalto) — AGENTE O.
 *
 * Arranca siempre de una partida real (`newGame`) y monta una "guerra
 * sintética" encima (guerra + provincia enemiga fortificada forzadas a
 * mano) para no depender de cómo cayeron los dados del mapa procedural en
 * una semilla dada: adyacencia y estado del objetivo quedan bajo control
 * total del test, deterministas de punta a punta.
 *
 * `finishSiegeAssaultTactical` es la mitad pura (sin DOM/Phaser) de
 * `assaultSiegeTactical` — mismo patrón que
 * `game/battleFlow.ts::finishTacticalOnMap` frente a `launchTacticalBattle`
 * (ver tests/battleflow.test.ts): la mitad con DOM no se testea aquí, se
 * verifica en runtime.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { moveArmy } from '../src/core/systems/actions';
import {
  assaultSiege, finishSiegeAssaultTactical, liftSiege, startSiege, tickSieges,
} from '../src/core/systems/siege';
import { Rng } from '../src/core/state/rng';
import type {
  Army, ArmyId, BattleReport, FactionId, GameState, Province, ProvinceId, War,
} from '../src/core/types';

const SEED = 7;
const PLAYER: FactionId = 'casa_varga';
const ENEMY: FactionId = 'clan_haraldsen';

interface Scenario {
  state: GameState;
  armyId: ArmyId;
  homeProvinceId: ProvinceId;
  targetProvinceId: ProvinceId;
  targetProvince: Province;
}

/**
 * Parte de una partida real y fuerza una guerra sintética: la PRIMERA
 * provincia vecina de la capital del jugador se convierte en territorio
 * enemigo fortificado y guarnicionado, y se declara la guerra directamente
 * (sin pasar por `declareWar`, para no acoplar estos tests a sus efectos
 * secundarios de opinión/legitimidad). Determinista pase lo que pase el
 * mapa procedural de la semilla: el objetivo y su adyacencia quedan bajo
 * control total del test.
 */
function siegeScenario(overrides?: { fortLevel?: 0 | 1 | 2 | 3; garrison?: number }): Scenario {
  const state = newGame(SEED);
  const army = Object.values(state.armies).find(a => a.factionId === PLAYER) as Army;
  const homeProvinceId = army.provinceId;
  const homeProvince = state.provinces.find(p => p.id === homeProvinceId)!;
  const targetProvinceId = homeProvince.neighbors[0];
  const targetProvince = state.provinces.find(p => p.id === targetProvinceId)!;

  targetProvince.ownerId = ENEMY;
  targetProvince.settlement = {
    ...targetProvince.settlement,
    fortLevel: overrides?.fortLevel ?? 2,
  };
  targetProvince.garrison = overrides?.garrison ?? 300;

  const war: War = {
    id: 'war_synth', attackerId: PLAYER, defenderId: ENEMY, cb: 'reclamo',
    warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn,
  };
  state.wars.push(war);

  return { state, armyId: army.id, homeProvinceId, targetProvinceId, targetProvince };
}

describe('siege: moveArmy abre asedio en vez de batalla instantánea', () => {
  it('mover a una provincia enemiga fortificada (fortLevel>=2) defendida solo por guarnición crea un asedio, no una batalla', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario();
    const rng = new Rng(state.rngState);

    const result = moveArmy(state, rng, armyId, targetProvinceId);

    expect(result.ok).toBe(true);
    expect(result.battle).toBeNull();
    expect(state.lastBattle).toBeNull();
    expect(state.armies[armyId].provinceId).toBe(targetProvinceId);
    expect(targetProvince.ownerId).toBe(ENEMY); // el dueño no cambia todavía: recién empieza el cerco

    expect(state.sieges).toHaveLength(1);
    const siege = state.sieges![0];
    expect(siege.provinceId).toBe(targetProvinceId);
    expect(siege.attackerFactionId).toBe(PLAYER);
    expect(siege.besiegerArmyIds).toEqual([armyId]);
    const expectedMax = Math.max(400, targetProvince.garrison * 2 + targetProvince.settlement.fortLevel * 300);
    expect(siege.provisionsMax).toBe(expectedMax);
    expect(siege.provisions).toBe(expectedMax);
  });

  it('si además hay un ejército enemigo en campo (fuera de los muros), sigue siendo batalla instantánea — como antes de esta feature', () => {
    const { state, armyId, targetProvinceId } = siegeScenario();
    state.armies.enemy_field = {
      id: 'enemy_field',
      name: 'Guardia de Campo',
      factionId: ENEMY,
      provinceId: targetProvinceId,
      generalId: null,
      movement: 2,
      movementMax: 2,
      units: [{ typeId: 'milicia', men: 50, morale: 8, xp: 0 }],
    };

    const rng = new Rng(state.rngState);
    const result = moveArmy(state, rng, armyId, targetProvinceId);

    expect(result.battle).not.toBeNull();
    expect(state.sieges ?? []).toHaveLength(0);
  });

  it('una empalizada (fortLevel 1) también abre asedio ahora que tickSieges vive en endTurn (SIEGE_MIN_FORT_LEVEL = 1)', () => {
    const { state, armyId, targetProvinceId } = siegeScenario({ fortLevel: 1, garrison: 100 });
    const rng = new Rng(state.rngState);

    const result = moveArmy(state, rng, armyId, targetProvinceId);

    expect(result.battle ?? null).toBeNull();
    expect(state.sieges ?? []).toHaveLength(1);
  });

  it('un segundo ejército propio que entra en una provincia ya sitiada se suma al cerco (no abre uno nuevo)', () => {
    const { state, armyId, homeProvinceId, targetProvinceId } = siegeScenario();
    const rng1 = new Rng(state.rngState);
    moveArmy(state, rng1, armyId, targetProvinceId);
    expect(state.sieges).toHaveLength(1);

    state.armies.second = {
      id: 'second',
      name: 'Segunda Hueste',
      factionId: PLAYER,
      provinceId: homeProvinceId,
      generalId: null,
      movement: 2,
      movementMax: 2,
      units: [{ typeId: 'milicia', men: 100, morale: 8, xp: 0 }],
    };

    const rng2 = new Rng(state.rngState);
    const result = moveArmy(state, rng2, 'second', targetProvinceId);

    expect(result.battle).toBeNull();
    expect(state.sieges).toHaveLength(1); // sigue siendo UN solo asedio
    expect(state.sieges![0].besiegerArmyIds).toEqual([armyId, 'second']);
    expect(result.message).toContain('se suma al cerco');
  });
});

describe('siege: startSiege (formula de provisiones)', () => {
  it('provisionsMax = guarnición×2 + fortificación×300', () => {
    const { state, armyId, targetProvinceId } = siegeScenario({ garrison: 10, fortLevel: 2 });
    const siege = startSiege(state, armyId, targetProvinceId);
    expect(siege.provisionsMax).toBe(10 * 2 + 2 * 300);
  });

  it('provisionsMax nunca baja de 400, aunque guarnición y fortificación sean mínimas', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario({ garrison: 10, fortLevel: 0 });
    expect(targetProvince.garrison * 2 + targetProvince.settlement.fortLevel * 300).toBeLessThan(400);
    const siege = startSiege(state, armyId, targetProvinceId);
    expect(siege.provisionsMax).toBe(400);
  });

  it('es idempotente: una segunda llamada con la misma facción suma el ejército sin duplicar el asedio', () => {
    const { state, armyId, targetProvinceId } = siegeScenario();
    const siege1 = startSiege(state, armyId, targetProvinceId);

    state.armies.a2 = {
      id: 'a2',
      name: 'Segunda Hueste',
      factionId: PLAYER,
      provinceId: targetProvinceId,
      generalId: null,
      movement: 2,
      movementMax: 2,
      units: [{ typeId: 'milicia', men: 100, morale: 8, xp: 0 }],
    };
    const siege2 = startSiege(state, 'a2', targetProvinceId);

    expect(siege2.id).toBe(siege1.id);
    expect(state.sieges).toHaveLength(1);
    expect(siege2.besiegerArmyIds).toEqual([armyId, 'a2']);
  });
});

describe('siege: tickSieges (hambre → rendición)', () => {
  it('agota las provisiones tras suficientes turnos: la plaza se rinde, cambia de dueño y deja crónica con sabor', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario({ garrison: 40, fortLevel: 2 });
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;
    const provisionsMax = state.sieges![0].provisionsMax; // 40*2 + 2*300 = 680

    const chronicleBefore = state.chronicle.length;
    let messages: string[] = [];
    let ticks = 0;
    while ((state.sieges ?? []).some(s => s.id === siegeId) && ticks < 20) {
      state.turn += 1; // simula el paso de turnos (tickSieges no lo hace: eso es de endTurn/integrador)
      const rng = new Rng(state.rngState);
      messages = tickSieges(state, rng);
      ticks += 1;
    }

    // 680 provisiones, -120/turno fuera de invierno: se rinde exactamente al 6º tick.
    expect(provisionsMax).toBe(680);
    expect(ticks).toBe(6);
    expect(state.sieges ?? []).toHaveLength(0);
    expect(targetProvince.ownerId).toBe(PLAYER);
    expect(targetProvince.garrison).toBe(0);

    const newEntries = state.chronicle.slice(chronicleBefore);
    expect(newEntries.some(e => e.kind === 'guerra' && e.text.includes('abrió sus puertas por hambre'))).toBe(true);
    expect(messages.some(m => m.includes('abrió sus puertas por hambre'))).toBe(true);
  });

  it('en invierno las provisiones caen 180 (no 120)', () => {
    const { state, armyId, targetProvinceId } = siegeScenario({ garrison: 40, fortLevel: 2 });
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siege = state.sieges![0];
    const before = siege.provisions;

    state.turn = 3; // invierno: turn % 4 === 3
    const rng = new Rng(state.rngState);
    tickSieges(state, rng);

    expect(before - siege.provisions).toBe(180);
  });

  it('la atrición del sitiador es mayor en invierno que en otras estaciones', () => {
    function menAfterOneTick(turn: number): number {
      const { state, armyId, targetProvinceId } = siegeScenario({ garrison: 40, fortLevel: 2 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);
      state.turn = turn;
      const rng = new Rng(state.rngState);
      tickSieges(state, rng);
      return state.armies[armyId].units.reduce((sum, u) => sum + u.men, 0);
    }

    const normal = menAfterOneTick(0); // primavera
    const winter = menAfterOneTick(3); // invierno
    expect(winter).toBeLessThan(normal);
  });

  it('si el sitiador ya no está en la provincia, el cerco se levanta solo (sin rendición ni cambio de dueño)', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario({ garrison: 300, fortLevel: 2 });
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    expect(state.sieges).toHaveLength(1);

    // el sitiador deja de estar presente (aniquilado/retirado): el asedio
    // real lo detecta por ausencia física del ejército, no por que "decida"
    // replegarse — aquí se simula a mano el caso límite.
    delete state.armies[armyId];

    const rng = new Rng(state.rngState);
    const messages = tickSieges(state, rng);

    expect(state.sieges ?? []).toHaveLength(0);
    expect(targetProvince.ownerId).toBe(ENEMY);
    expect(messages.some(m => m.includes('se levanta'))).toBe(true);
  });

  it('si la guerra termina a mitad de asedio (paz), el cerco se levanta solo en el siguiente tick', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario({ garrison: 300, fortLevel: 2 });
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    expect(state.sieges).toHaveLength(1);

    state.wars = state.wars.filter(w => w.id !== 'war_synth'); // paz sintética

    const rng = new Rng(state.rngState);
    tickSieges(state, rng);

    expect(state.sieges ?? []).toHaveLength(0);
    expect(targetProvince.ownerId).toBe(ENEMY); // nunca se rindió: solo se levantó el cerco
  });
});

describe('siege: assaultSiege (asalto auto-resuelto)', () => {
  it('si el atacante gana el asalto, ocupa la provincia y cierra el asedio', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario({ garrison: 15, fortLevel: 2 });
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;

    const rng = new Rng(state.rngState);
    const result = assaultSiege(state, rng, siegeId);

    expect(result.ok).toBe(true);
    expect(result.battle).toBeDefined();
    expect(result.battle!.winner).toBe('attacker');
    expect(targetProvince.ownerId).toBe(PLAYER);
    expect(targetProvince.garrison).toBe(0);
    expect(state.sieges ?? []).toHaveLength(0);
  });

  it('sin sitiadores presentes, no se puede asaltar y el asedio se levanta', () => {
    const { state, armyId, targetProvinceId } = siegeScenario();
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;
    delete state.armies[armyId];

    const rng = new Rng(state.rngState);
    const result = assaultSiege(state, rng, siegeId);

    expect(result.ok).toBe(false);
    expect(state.sieges ?? []).toHaveLength(0);
  });

  it('un siegeId inexistente devuelve un ActionResult de fallo, sin lanzar', () => {
    const { state } = siegeScenario();
    const rng = new Rng(state.rngState);
    const result = assaultSiege(state, rng, 'siege_no_existe');
    expect(result.ok).toBe(false);
  });
});

describe('siege: finishSiegeAssaultTactical (mitad pura del asalto en persona)', () => {
  function report(state: GameState, provinceId: ProvinceId, winner: 'attacker' | 'defender'): BattleReport {
    const p = state.provinces.find(pr => pr.id === provinceId)!;
    return {
      provinceId,
      provinceName: p.name,
      turn: state.turn,
      season: 0,
      terrain: p.terrain,
      weather: 'despejado',
      attacker: { factionId: PLAYER, menBefore: 500, losses: 60, moraleBroke: false },
      defender: { factionId: ENEMY, menBefore: 400, losses: 300, moraleBroke: true },
      winner,
      narrative: ['(test)'],
      warScoreDelta: 10,
    };
  }

  it('victoria táctica: ocupa y cierra el asedio', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario();
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;

    finishSiegeAssaultTactical(state, siegeId, report(state, targetProvinceId, 'attacker'));

    expect(targetProvince.ownerId).toBe(PLAYER);
    expect(state.sieges ?? []).toHaveLength(0);
  });

  it('derrota táctica: el cerco continúa si sigue habiendo sitiador presente', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario();
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;

    finishSiegeAssaultTactical(state, siegeId, report(state, targetProvinceId, 'defender'));

    expect(targetProvince.ownerId).toBe(ENEMY);
    expect(state.sieges ?? []).toHaveLength(1);
  });
});

describe('siege: liftSiege', () => {
  it('elimina el asedio sin ocupar ni tocar la provincia', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeScenario();
    const rng = new Rng(state.rngState);
    moveArmy(state, rng, armyId, targetProvinceId);
    const siegeId = state.sieges![0].id;

    liftSiege(state, siegeId);

    expect(state.sieges ?? []).toHaveLength(0);
    expect(targetProvince.ownerId).toBe(ENEMY);
    expect(state.armies[armyId].provinceId).toBe(targetProvinceId);
  });

  it('levantar un siegeId inexistente no lanza (no-op)', () => {
    const { state } = siegeScenario();
    expect(() => liftSiege(state, 'siege_no_existe')).not.toThrow();
  });
});

describe('siege: determinismo', () => {
  it('misma semilla produce el mismo resultado de punta a punta (asedio, varios tickSieges y un asalto)', () => {
    function run(): GameState {
      const { state, armyId, targetProvinceId } = siegeScenario({ garrison: 120, fortLevel: 2 });
      const rng0 = new Rng(state.rngState);
      moveArmy(state, rng0, armyId, targetProvinceId);
      for (let i = 0; i < 3; i++) {
        state.turn += 1;
        const rng = new Rng(state.rngState);
        tickSieges(state, rng);
      }
      if (state.sieges && state.sieges.length > 0) {
        const rng = new Rng(state.rngState);
        assaultSiege(state, rng, state.sieges[0].id);
      }
      return state;
    }

    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
