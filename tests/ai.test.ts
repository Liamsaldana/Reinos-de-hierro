/**
 * Tests de unidad mínima para la IA de facción (AGENTE N — "la IA debe
 * morder"). Complementa el harness de simulación end-to-end
 * (tests/simulation.test.ts) con escenarios sintéticos, deterministas y
 * aislados: NO usan `newGame` (contenido de otro agente), construyen su
 * propio `GameState` mínimo a mano (mismo patrón que tests/combat.test.ts).
 *
 * Los tres escenarios verifican, uno a uno, el arreglo descrito en el
 * docstring de `src/core/ai/factionAI.ts`:
 *  1) con ventaja de fuerza, un ejército realmente ataca una guarnición
 *     débil adyacente (antes: nunca atacaba nada, por la comparación de
 *     magnitudes incompatibles garrison-vs-armyStrength).
 *  2) el umbral de ataque por arquetipo se respeta: 'consolidated' (1.35x)
 *     NO ataca con una ventaja de apenas 1.2x, aunque 'ambitious' (1.15x) sí.
 *  3) en guerra, un ejército avanza de verdad hacia el frente: la distancia
 *     BFS hasta la provincia enemiga más cercana decrece turno a turno.
 */
import { describe, expect, it } from 'vitest';
import { getUnitType } from '../src/core/content/units';
import { armyStrength } from '../src/core/combat/autoresolve';
import { Rng } from '../src/core/state/rng';
import { runFactionAI, __testing } from '../src/core/ai/factionAI';
import type {
  Army, Character, Faction, GameState, Province, War,
} from '../src/core/types';

// ---------- constructor mínimo de GameState (sin newGame, sin actions stub) ----------

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
    cultureId: over.cultureId ?? 'aurelios', // attackMod 1.0 (ver content/cultures.ts): matemática limpia en los tests
    religionId: over.religionId ?? 'aureismo',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: over.ai,
    rulerId: over.rulerId ?? `ruler_${over.id}`,
    heirId: null,
    gold: over.gold ?? 0,
    manpower: over.manpower ?? 0,
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

/** ejército de N unidades 'milicia' a plena dotación (cada una aporta ~4.5 de armyStrength). */
function militiaArmy(id: string, factionId: string, provinceId: number, fullUnits: number, partialMen = 0): Army {
  const units: Army['units'] = [];
  for (let i = 0; i < fullUnits; i++) units.push({ typeId: 'milicia', men: 100, morale: 8, xp: 0 });
  if (partialMen > 0) units.push({ typeId: 'milicia', men: partialMen, morale: 8, xp: 0 });
  return {
    id, name: `Hueste de prueba ${id}`, factionId, provinceId, units, generalId: null, movement: 2, movementMax: 2,
  };
}

function baseState(
  factions: Faction[], provinces: Province[], wars: War[] = [],
): GameState {
  const characters: Record<string, Character> = {};
  for (const f of factions) characters[f.rulerId] = makeCharacter(f.rulerId, f.id);
  const factionMap: Record<string, Faction> = {};
  for (const f of factions) factionMap[f.id] = f;
  return {
    version: 1,
    seed: 1,
    turn: 4, // año 2, primavera
    playerFactionId: factions[0].id,
    provinces,
    factions: factionMap,
    characters,
    armies: {},
    wars,
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
  };
}

describe('factionAI — la IA muerde de verdad (unidad mínima, AGENTE N)', () => {
  it('con ventaja de fuerza, un ejército tribal ataca y conquista una guarnición débil adyacente (sin guerra)', () => {
    const tribal = makeFaction({ id: 'tribu', ai: 'tribal' });
    const home = makeProvince({ id: 1, ownerId: 'tribu', neighbors: [2], garrison: 50 });
    const target = makeProvince({ id: 2, ownerId: null, neighbors: [1], garrison: 5, terrain: 'plains' });
    const state = baseState([tribal], [home, target]);
    state.armies.a1 = militiaArmy('a1', 'tribu', 1, 3); // ~13.5 de armyStrength: aplasta una guarnición de ~4.5

    // sanity check del propio arreglo: la defensa REAL de la guarnición débil
    // (en las unidades correctas) es una fracción pequeña de nuestra fuerza.
    const defense = __testing.provinceDefenseAt(state, target, 'tribu');
    const myStrength = armyStrength(state, state.armies.a1);
    expect(myStrength).toBeGreaterThan(defense * 2);

    const log = runFactionAI(state, new Rng(123), 'tribu');

    const updatedTarget = state.provinces.find((p) => p.id === 2)!;
    expect(updatedTarget.ownerId, `log: ${log.join(' | ')}`).toBe('tribu');
    expect(state.armies.a1.provinceId).toBe(2);
  });

  it('en guerra, "consolidated" (umbral 1.35x) NO ataca con 1.2x de ventaja, pero "ambitious" (1.15x) sí atacaría', () => {
    const enemy = makeFaction({ id: 'enemigo', ai: 'tribal' });
    const targetProvince = makeProvince({
      id: 2, ownerId: 'enemigo', neighbors: [1], garrison: 100, terrain: 'plains',
      settlement: { name: 'Villa 2', level: 2, fortLevel: 0 },
    });

    // defensa real de esa provincia (garrison a plena ratio ~ una milicia, sin bonus de terreno/fuerte).
    const probeState = baseState([enemy], [targetProvince]);
    const defense = __testing.provinceDefenseAt(probeState, targetProvince, 'atacante');
    const milicia = getUnitType('milicia');
    const perFullUnit = (milicia.attack + milicia.defense) / 2 + milicia.armor * 0.5;
    expect(defense).toBeCloseTo(perFullUnit, 5); // sanity: coincide con garrisonDefensePower()

    // construimos un ejército con armyStrength = 1.2 * defense EXACTO: un pelotón
    // de milicia a plena dotación (perFullUnit) + uno parcial que afina el resto.
    const desiredStrength = 1.2 * defense;
    const remainder = desiredStrength - perFullUnit; // < perFullUnit por construcción (1.2x es una ventaja modesta)
    const partialMen = Math.round((remainder / perFullUnit) * milicia.menMax);

    function buildScenario(archetype: Faction['ai']) {
      const attacker = makeFaction({ id: 'atacante', ai: archetype });
      const enemy2 = makeFaction({ id: 'enemigo', ai: 'tribal' });
      const home = makeProvince({ id: 1, ownerId: 'atacante', neighbors: [2], garrison: 50 });
      const target = makeProvince({
        id: 2, ownerId: 'enemigo', neighbors: [1], garrison: 100, terrain: 'plains',
        settlement: { name: 'Villa 2', level: 2, fortLevel: 0 },
      });
      const war: War = {
        id: 'w1', attackerId: 'atacante', defenderId: 'enemigo', cb: 'reclamo',
        warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0,
      };
      const state = baseState([attacker, enemy2], [home, target], [war]);
      state.armies.a1 = militiaArmy('a1', 'atacante', 1, 1, partialMen); // 1 pelotón completo + 1 parcial (ajuste fino)
      return state;
    }

    const consolidatedState = buildScenario('consolidated');
    const myStrengthConsolidated = armyStrength(consolidatedState, consolidatedState.armies.a1);
    expect(myStrengthConsolidated).toBeCloseTo(desiredStrength, 1);
    expect(myStrengthConsolidated).toBeGreaterThan(defense * __testing.attackThreshold('ambitious'));
    expect(myStrengthConsolidated).toBeLessThan(defense * __testing.attackThreshold('consolidated'));

    runFactionAI(consolidatedState, new Rng(7), 'atacante');
    expect(consolidatedState.armies.a1.provinceId, 'consolidated NO debería haber cruzado a la provincia 2 con solo 1.2x').toBe(1);
    expect(consolidatedState.provinces.find((p) => p.id === 2)!.ownerId).toBe('enemigo');

    const ambitiousState = buildScenario('ambitious');
    runFactionAI(ambitiousState, new Rng(7), 'atacante');
    expect(ambitiousState.armies.a1.provinceId, 'ambitious SÍ debería haber atacado con 1.2x (umbral 1.15x)').toBe(2);
  });

  it('en guerra, un ejército avanza de verdad hacia el frente: la distancia BFS al enemigo decrece en 3 turnos', () => {
    // cadena lineal de 5 provincias propias 1-2-3-4-5; la 5 es del enemigo.
    const attacker = makeFaction({ id: 'atacante', ai: 'ambitious' });
    const enemy = makeFaction({ id: 'enemigo', ai: 'tribal' });
    const provinces: Province[] = [
      makeProvince({ id: 1, ownerId: 'atacante', neighbors: [2] }),
      makeProvince({ id: 2, ownerId: 'atacante', neighbors: [1, 3] }),
      makeProvince({ id: 3, ownerId: 'atacante', neighbors: [2, 4] }),
      makeProvince({ id: 4, ownerId: 'atacante', neighbors: [3, 5] }),
      makeProvince({ id: 5, ownerId: 'enemigo', neighbors: [4], garrison: 100 }),
    ];
    const war: War = {
      id: 'w1', attackerId: 'atacante', defenderId: 'enemigo', cb: 'reclamo',
      warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0,
    };
    const state = baseState([attacker, enemy], provinces, [war]);
    state.armies.a1 = militiaArmy('a1', 'atacante', 1, 0);
    // fuerza modesta: no queremos que en el mismo turno alcance Y conquiste la 5,
    // solo que se ACERQUE (el umbral de ataque real se cubre en el test anterior).
    state.armies.a1.units = [{ typeId: 'milicia', men: 40, morale: 8, xp: 0 }];

    const isEnemyGoal = (p: Province) => p.ownerId === 'enemigo';
    const passable = (p: Province) => p.ownerId === 'atacante' || p.ownerId === null || p.ownerId === 'enemigo';

    const distances: number[] = [];
    distances.push(__testing.bfsDistanceTo(state, state.armies.a1.provinceId, isEnemyGoal, passable) ?? -1);
    for (let turn = 0; turn < 3; turn++) {
      state.armies.a1.movement = state.armies.a1.movementMax; // el motor de turno real resetea esto cada turno
      runFactionAI(state, new Rng(turn + 1), 'atacante');
      distances.push(__testing.bfsDistanceTo(state, state.armies.a1.provinceId, isEnemyGoal, passable) ?? -1);
    }

    expect(distances[0]).toBe(4); // provincia 1 -> provincia 5: 4 saltos
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i], `distancias: ${distances.join(', ')}`).toBeLessThan(distances[i - 1]);
    }
    expect(distances[distances.length - 1]).toBe(1); // tras 3 turnos, a un salto del frente
  });
});
