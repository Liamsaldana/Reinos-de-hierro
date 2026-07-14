/**
 * Tests de auto-resolución de combate (GDD §8.4) — AGENTE D.
 *
 * NOTA IMPORTANTE para el integrador: `src/core/content/units.ts` es contenido
 * de otro agente (B) y puede estar vacío o cambiar en paralelo. Para no
 * depender de él, este archivo registra sus PROPIOS UnitType de prueba
 * mutando el registro compartido `UNIT_TYPES` vía
 * `Object.assign(UNIT_TYPES, {...})` antes de resolver ninguna batalla. Los
 * ids usados (prefijo `test_`, y `milicia` para la guarnición) son locales a
 * este archivo. El estado (`GameState`) también se construye a mano, sin
 * `newGame`, con 2 provincias vecinas y 2 facciones — no depende de
 * `content/newGame.ts` (agente B) ni de `systems/actions.ts` (agente A).
 */
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES } from '../src/core/content/units';
import { armyStrength, resolveBattleAt } from '../src/core/combat/autoresolve';
import { Rng } from '../src/core/state/rng';
import type {
  Army, Character, Faction, GameState, Province, UnitType, War,
} from '../src/core/types';

// ---------- UnitType de prueba (no colisionan con contenido real) ----------
Object.assign(UNIT_TYPES, {
  test_infantry: {
    id: 'test_infantry', name: 'Infantería de prueba', category: 'infantry', tier: 1, culture: null,
    attack: 8, defense: 10, armor: 2, rangedPower: 0, initiative: 2, speed: 3,
    moraleMax: 15, menMax: 100, cost: { gold: 10, manpower: 50 }, upkeep: 1,
  },
  test_cavalry: {
    id: 'test_cavalry', name: 'Caballería de prueba', category: 'cavalry', tier: 1, culture: null,
    attack: 12, defense: 6, armor: 3, rangedPower: 0, initiative: 4, speed: 6,
    moraleMax: 12, menMax: 80, cost: { gold: 20, manpower: 40 }, upkeep: 2,
  },
  test_ranged: {
    id: 'test_ranged', name: 'Arqueros de prueba', category: 'ranged', tier: 1, culture: null,
    attack: 4, defense: 4, armor: 0, rangedPower: 10, initiative: 3, speed: 3,
    moraleMax: 10, menMax: 80, cost: { gold: 15, manpower: 30 }, upkeep: 1,
  },
  test_spear: {
    id: 'test_spear', name: 'Lanceros de prueba', category: 'spear', tier: 1, culture: null,
    attack: 6, defense: 8, armor: 1, rangedPower: 0, initiative: 2, speed: 3,
    moraleMax: 12, menMax: 100, cost: { gold: 10, manpower: 45 }, upkeep: 1,
  },
  milicia: {
    id: 'milicia', name: 'Milicia local', category: 'infantry', tier: 1, culture: null,
    attack: 3, defense: 4, armor: 0, rangedPower: 0, initiative: 1, speed: 2,
    moraleMax: 8, menMax: 100, cost: { gold: 0, manpower: 0 }, upkeep: 0,
  },
} satisfies Record<string, UnitType>);

// ---------- constructor mínimo de GameState (sin newGame) ----------
function makeProvince(over: Partial<Province> & { id: number; ownerId: string | null; neighbors: number[] }): Province {
  return {
    id: over.id,
    name: over.name ?? `Provincia ${over.id}`,
    terrain: over.terrain ?? 'plains',
    elevation: 0.3,
    center: [over.id, 0],
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    neighbors: over.neighbors,
    ownerId: over.ownerId,
    settlement: over.settlement ?? { name: `Villa ${over.id}`, level: 2, fortLevel: 0 },
    iron: over.iron ?? false,
    horses: over.horses ?? false,
    baseTax: 1,
    baseFood: 1,
    baseManpower: 1,
    garrison: over.garrison ?? 0,
  };
}

function makeFaction(over: Partial<Faction> & { id: string; ai: Faction['ai'] }): Faction {
  return {
    id: over.id,
    name: over.name ?? `Facción ${over.id}`,
    dynastyName: over.dynastyName ?? `Casa ${over.id}`,
    cultureId: over.cultureId ?? 'aurelios',
    religionId: over.religionId ?? 'aureismo',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: over.ai,
    rulerId: over.rulerId ?? `ruler_${over.id}`,
    heirId: null,
    gold: over.gold ?? 1000,
    manpower: over.manpower ?? 5000,
    foodStock: 100,
    legitimacy: over.legitimacy ?? 80,
    alive: true,
  };
}

function makeCharacter(id: string, factionId: string): Character {
  return {
    id, name: `Gobernante ${id}`, factionId, role: 'ruler', age: 40,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [], alive: true,
  };
}

interface Scenario {
  state: GameState;
}

function baseScenario(): Scenario {
  const p1 = makeProvince({ id: 1, ownerId: 'f1', neighbors: [2] });
  const p2 = makeProvince({ id: 2, ownerId: 'f2', neighbors: [1], garrison: 0 });
  const f1 = makeFaction({ id: 'f1', ai: 'player', cultureId: 'aurelios' });
  const f2 = makeFaction({ id: 'f2', ai: 'consolidated', cultureId: 'norlander' });
  const war: War = {
    id: 'w1', attackerId: 'f1', defenderId: 'f2', cb: 'reclamo',
    warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0,
  };
  const state: GameState = {
    version: 1,
    seed: 1,
    turn: 4, // año 2, primavera (turn%4===0)
    playerFactionId: 'f1',
    provinces: [p1, p2],
    factions: { f1, f2 },
    characters: {
      [f1.rulerId]: makeCharacter(f1.rulerId, 'f1'),
      [f2.rulerId]: makeCharacter(f2.rulerId, 'f2'),
    },
    armies: {},
    wars: [war],
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
  };
  return { state };
}

function balancedArmies(state: GameState): void {
  state.armies.a1 = {
    id: 'a1', name: 'Vanguardia de Uno', factionId: 'f1', provinceId: 2, generalId: null,
    movement: 2, movementMax: 2,
    units: [
      { typeId: 'test_infantry', men: 400, morale: 15, xp: 0 },
      { typeId: 'test_cavalry', men: 200, morale: 12, xp: 0 },
    ],
  };
  state.armies.d1 = {
    id: 'd1', name: 'Guardia de Dos', factionId: 'f2', provinceId: 2, generalId: null,
    movement: 2, movementMax: 2,
    units: [
      { typeId: 'test_infantry', men: 300, morale: 15, xp: 0 },
      { typeId: 'test_ranged', men: 150, morale: 10, xp: 0 },
    ],
  };
}

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

describe('autoresolve: determinismo y consistencia', () => {
  it('misma semilla produce el mismo BattleReport (JSON idéntico)', () => {
    const s1 = baseScenario().state;
    balancedArmies(s1);
    const s2 = deepClone(s1);

    const r1 = resolveBattleAt(s1, new Rng(424242), 'f1', 2);
    const r2 = resolveBattleAt(s2, new Rng(424242), 'f1', 2);

    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('las bajas son >= 0 y <= hombres iniciales en ambos bandos', () => {
    const { state } = baseScenario();
    balancedArmies(state);
    const report = resolveBattleAt(state, new Rng(99), 'f1', 2);

    expect(report.attacker.losses).toBeGreaterThanOrEqual(0);
    expect(report.attacker.losses).toBeLessThanOrEqual(report.attacker.menBefore);
    expect(report.defender.losses).toBeGreaterThanOrEqual(0);
    expect(report.defender.losses).toBeLessThanOrEqual(report.defender.menBefore);
  });

  it('narrative tiene entre 6 y 9 líneas en español', () => {
    const { state } = baseScenario();
    balancedArmies(state);
    const report = resolveBattleAt(state, new Rng(7), 'f1', 2);

    expect(report.narrative.length).toBeGreaterThanOrEqual(6);
    expect(report.narrative.length).toBeLessThanOrEqual(9);
  });

  it('state.lastBattle es exactamente el reporte devuelto', () => {
    const { state } = baseScenario();
    balancedArmies(state);
    const report = resolveBattleAt(state, new Rng(55), 'f1', 2);

    expect(state.lastBattle).toBe(report);
  });

  it('con fuerzas ~4:1 el bando fuerte gana al menos 18 de 20 semillas', () => {
    const setup = () => {
      const { state } = baseScenario();
      state.armies.strong = {
        id: 'strong', name: 'Hueste Fuerte', factionId: 'f1', provinceId: 2, generalId: null,
        movement: 2, movementMax: 2,
        units: [{ typeId: 'test_infantry', men: 600, morale: 15, xp: 0 }],
      };
      state.armies.weak = {
        id: 'weak', name: 'Hueste Débil', factionId: 'f2', provinceId: 2, generalId: null,
        movement: 2, movementMax: 2,
        units: [{ typeId: 'test_infantry', men: 150, morale: 15, xp: 0 }],
      };
      return state;
    };

    // sanity check: la ventaja de fuerza declarada realmente ronda 3:1 o más
    const sanity = setup();
    const ratio = armyStrength(sanity, sanity.armies.strong) / armyStrength(sanity, sanity.armies.weak);
    expect(ratio).toBeGreaterThanOrEqual(3);

    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = setup();
      const report = resolveBattleAt(state, new Rng(seed * 1000 + 3), 'f1', 2);
      if (report.winner === 'attacker') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(18);
  });

  it('batalla solo-guarnición: se resuelve y deja garrison en 0 si gana el atacante', () => {
    const { state } = baseScenario();
    // provincia 2 pasa a ser tierra sin señor con guarnición pequeña
    state.provinces[1].ownerId = null;
    state.provinces[1].garrison = 20;
    state.armies.invasor = {
      id: 'invasor', name: 'Ejército Invasor', factionId: 'f1', provinceId: 2, generalId: null,
      movement: 2, movementMax: 2,
      units: [{ typeId: 'test_infantry', men: 600, morale: 15, xp: 0 }],
    };

    const report = resolveBattleAt(state, new Rng(321), 'f1', 2);

    expect(report.winner).toBe('attacker');
    expect(state.provinces[1].garrison).toBe(0);
    expect(report.defender.factionId).toBeNull();
  });

  it('lanza error si no hay defensores', () => {
    const { state } = baseScenario();
    // provincia 2 propiedad de f2, pero SIN guerra, sin garrison, sin ejércitos
    // defensores -> f1 no está en guerra con f2 así que ni el garrison cuenta
    state.wars = [];
    state.provinces[1].garrison = 0;
    state.armies.a1 = {
      id: 'a1', name: 'Curioseo', factionId: 'f1', provinceId: 2, generalId: null,
      movement: 2, movementMax: 2,
      units: [{ typeId: 'test_infantry', men: 100, morale: 15, xp: 0 }],
    };

    expect(() => resolveBattleAt(state, new Rng(1), 'f1', 2)).toThrow('No hay defensores');
  });
});
