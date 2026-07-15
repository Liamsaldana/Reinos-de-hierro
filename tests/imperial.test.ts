/**
 * Tests de Fase 3 — La Era Tardía (GDD §11 era 3 sin pólvora, §9.2 máquinas
 * de asedio completas, §2.4 Remanente Imperial, §13.1 nuevas victorias) —
 * AGENTE W.
 *
 * Cuatro áreas, cada una en su propio `describe`:
 *  1. content/techs.ts — ERA 3 (requiere TODA la era 2 de su rama, costes
 *     130-180, `talla_de_vidrio_igneo` con id exacto y sin efecto propio).
 *  2. systems/siege.ts — `siegeEngineBonus` (máquinas de asedio): acelera
 *     `tickSieges` y abre "brecha" temporal en `assaultSiege`.
 *  3. systems/imperial.ts — `tickImperial` (el Remanente Imperial surge de
 *     forma determinista con semilla forzada, invierno + turno ≥32).
 *  4. systems/victory.ts — hegemonía (racha) y restauración (capitales +
 *     reclamo aureliano), con el orden de prioridad documentado.
 *
 * Todos los escenarios de siege/imperial/victory construyen su propio
 * `GameState` (con `newGame` para los de asedio, sintético a mano para
 * imperial/victoria) — mismo patrón que `tests/siege.test.ts`/`tests/ai.test.ts`:
 * cada archivo de test es dueño de sus propios helpers, sin depender de los
 * de otro archivo de test.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { moveArmy } from '../src/core/systems/actions';
import { assaultSiege, siegeEngineBonus, tickSieges } from '../src/core/systems/siege';
import { getUnitType } from '../src/core/content/units';
import { TECHS } from '../src/core/content/techs';
import { setActiveResearch } from '../src/core/systems/research';
import { idAt } from '../src/core/content/mapgen';
import { Rng } from '../src/core/state/rng';
import { runFactionAI } from '../src/core/ai/factionAI';
import { IMPERIAL_FACTION_ID, tickImperial } from '../src/core/systems/imperial';
import {
  casaVargaAncestralCapitalId, checkExtraVictories, hasAurelianClaim, isLeadingPower,
  powerScore, updateVictoryProgress,
} from '../src/core/systems/victory';
import type {
  Army, ArmyId, Character, Faction, FactionId, GameState, Province, ProvinceId, UnitInstance, War,
} from '../src/core/types';

// ============================================================================
// 1. content/techs.ts — ERA 3
// ============================================================================

describe('content/techs.ts — ERA 3 (Fase 3, AGENTE W)', () => {
  const all = Object.values(TECHS);
  const era3 = all.filter(t => t.era === 3);

  it('añade ~8 tecnologías de era 3, cubriendo las 3 ramas (4 militar, 2 economía, 2 estado)', () => {
    expect(era3.length).toBe(8);
    expect(era3.filter(t => t.branch === 'militar')).toHaveLength(4);
    expect(era3.filter(t => t.branch === 'economia')).toHaveLength(2);
    expect(era3.filter(t => t.branch === 'estado')).toHaveLength(2);
  });

  it("'talla_de_vidrio_igneo' existe con id EXACTO, en militar/era 3, sin efecto mecánico propio (la capa mítica la consultará por ese id)", () => {
    const tech = TECHS.talla_de_vidrio_igneo;
    expect(tech).toBeDefined();
    expect(tech.id).toBe('talla_de_vidrio_igneo');
    expect(tech.branch).toBe('militar');
    expect(tech.era).toBe(3);
    expect(tech.effects).toEqual({});
    expect(tech.blurb.length).toBeGreaterThan(0);
  });

  it(
    'toda tecnología de era 3 exige, explícitamente, TODAS las tecnologías de era 2 ya definidas en su '
      + 'misma rama — el máximo real alcanzable: ninguna rama del banco llega a tener 4 tecnologías de era 2 '
      + '(militar tiene 2, economía y estado tienen 3), así que "todas" es el gate más estricto posible',
    () => {
      for (const branch of ['militar', 'economia', 'estado'] as const) {
        const era2IdsOfBranch = all.filter(t => t.branch === branch && t.era === 2).map(t => t.id).sort();
        expect(era2IdsOfBranch.length).toBeLessThan(4); // documenta por qué "4" del encargo no era alcanzable
        const era3OfBranch = era3.filter(t => t.branch === branch);
        expect(era3OfBranch.length).toBeGreaterThan(0);
        for (const t of era3OfBranch) {
          expect([...t.requires].sort(), `${t.id}.requires`).toEqual(era2IdsOfBranch);
        }
      }
    },
  );

  it('los costes de era 3 están en la banda 130-180 (por encima de era 2, ~70-110)', () => {
    for (const t of era3) {
      expect(t.cost).toBeGreaterThanOrEqual(130);
      expect(t.cost).toBeLessThanOrEqual(180);
    }
  });

  it('los ids de era 3 son nuevos (no colisionan con ninguna tecnología v1)', () => {
    const v1Ids = new Set(all.filter(t => t.era !== 3).map(t => t.id));
    for (const t of era3) expect(v1Ids.has(t.id)).toBe(false);
  });

  it('ninguna tecnología de era 3 desbloquea unidades nuevas (el encargo no pedía ninguna)', () => {
    for (const t of era3) expect(t.effects.unlockUnits ?? []).toEqual([]);
  });

  it('setActiveResearch (research.ts, sin tocar) rechaza una tecnología de era 3 si falta CUALQUIERA de las de era 2 de su rama, y la acepta con todas completas', () => {
    const state: GameState = {
      version: 1, seed: 1, turn: 0, playerFactionId: 'f1', provinces: [],
      factions: {
        f1: {
          id: 'f1', name: 'Reino f1', dynastyName: 'Casa f1', cultureId: 'aurelios', religionId: 'aureismo',
          colorPrimary: '#111', colorSecondary: '#222', bannerSeed: 1, ai: 'player',
          rulerId: 'ruler_f1', heirId: null, gold: 0, manpower: 0, foodStock: 0, legitimacy: 60, alive: true,
          research: { active: null, points: 0, done: ['forja_veterana'] }, // falta doctrina_de_marcha
        },
      },
      characters: {}, armies: {}, wars: [], relations: {}, chronicle: [],
      rngState: 1, lastBattle: null, outcome: 'ongoing',
    };

    expect(setActiveResearch(state, 'f1', 'acero_de_forja_fria').ok).toBe(false);
    state.factions.f1.research!.done.push('doctrina_de_marcha');
    expect(setActiveResearch(state, 'f1', 'acero_de_forja_fria').ok).toBe(true);
  });
});

// ============================================================================
// 2. systems/siege.ts — siegeEngineBonus (máquinas de asedio)
// ============================================================================

const SIEGE_SEED = 7;
const SIEGE_PLAYER: FactionId = 'casa_varga';
const SIEGE_ENEMY: FactionId = 'clan_haraldsen';

interface SiegeFixture {
  state: GameState;
  armyId: ArmyId;
  targetProvinceId: ProvinceId;
  targetProvince: Province;
}

/**
 * Parte de una partida real (`newGame`) y fuerza una guerra sintética sobre
 * la primera provincia vecina de la capital del jugador — mismo patrón que
 * `tests/siege.test.ts:siegeScenario` (determinista pase lo que pase el
 * mapa procedural de la semilla). Fuerza terreno 'plains' para que los
 * números de fuerza sean los mismos, seed a seed, en los tests estadísticos.
 */
function siegeFixture(overrides?: { fortLevel?: 0 | 1 | 2 | 3; garrison?: number }): SiegeFixture {
  const state = newGame(SIEGE_SEED);
  const army = Object.values(state.armies).find(a => a.factionId === SIEGE_PLAYER) as Army;
  const homeProvince = state.provinces.find(p => p.id === army.provinceId)!;
  const targetProvinceId = homeProvince.neighbors[0];
  const targetProvince = state.provinces.find(p => p.id === targetProvinceId)!;

  targetProvince.ownerId = SIEGE_ENEMY;
  targetProvince.terrain = 'plains';
  targetProvince.settlement = { ...targetProvince.settlement, fortLevel: overrides?.fortLevel ?? 2 };
  targetProvince.garrison = overrides?.garrison ?? 300;

  const war: War = {
    id: 'war_synth', attackerId: SIEGE_PLAYER, defenderId: SIEGE_ENEMY, cb: 'reclamo',
    warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn,
  };
  state.wars.push(war);

  return { state, armyId: army.id, targetProvinceId, targetProvince };
}

function addCatapults(state: GameState, armyId: ArmyId, count: number): void {
  const army = state.armies[armyId];
  const type = getUnitType('catapulta');
  for (let i = 0; i < count; i++) {
    army.units.push({ typeId: 'catapulta', men: type.menMax, morale: type.moraleMax, xp: 0 });
  }
}

describe('systems/siege.ts — siegeEngineBonus (Fase 3, AGENTE W)', () => {
  it('cuenta catapultas vivas presentes en la provincia sitiada, con tope 2', () => {
    const { state, armyId, targetProvinceId } = siegeFixture();
    const rng = new Rng(state.rngState);
    moveArmy(state, rng, armyId, targetProvinceId);
    const siege = state.sieges![0];

    expect(siegeEngineBonus(state, siege)).toBe(0);

    addCatapults(state, armyId, 1);
    expect(siegeEngineBonus(state, siege)).toBe(1);

    addCatapults(state, armyId, 1); // 2 en total
    expect(siegeEngineBonus(state, siege)).toBe(2);

    addCatapults(state, armyId, 5); // 7 en total: el tope sigue en 2
    expect(siegeEngineBonus(state, siege)).toBe(2);
  });

  it('una catapulta muerta (men=0) no cuenta', () => {
    const { state, armyId, targetProvinceId } = siegeFixture();
    const rng = new Rng(state.rngState);
    moveArmy(state, rng, armyId, targetProvinceId);
    const siege = state.sieges![0];

    addCatapults(state, armyId, 2);
    expect(siegeEngineBonus(state, siege)).toBe(2);
    state.armies[armyId].units.filter(u => u.typeId === 'catapulta').forEach(u => { u.men = 0; });
    expect(siegeEngineBonus(state, siege)).toBe(0);
  });

  it('una catapulta en un ejército que ya no está presente en la provincia sitiada no cuenta', () => {
    const { state, armyId, targetProvinceId, targetProvince } = siegeFixture();
    const rng = new Rng(state.rngState);
    moveArmy(state, rng, armyId, targetProvinceId);
    const siege = state.sieges![0];

    addCatapults(state, armyId, 2);
    expect(siegeEngineBonus(state, siege)).toBe(2);

    state.armies[armyId].provinceId = targetProvince.neighbors[0]; // se aleja, sigue listado en besiegerArmyIds
    expect(siegeEngineBonus(state, siege)).toBe(0);
  });

  it('un ejército de otra facción con catapultas (no sitiador) no cuenta', () => {
    const { state, armyId, targetProvinceId } = siegeFixture();
    const rng = new Rng(state.rngState);
    moveArmy(state, rng, armyId, targetProvinceId);
    const siege = state.sieges![0];

    state.armies.otro = {
      id: 'otro', name: 'Otra hueste', factionId: SIEGE_ENEMY, provinceId: targetProvinceId,
      generalId: null, movement: 2, movementMax: 2,
      units: [{ typeId: 'catapulta', men: 50, morale: 8, xp: 0 }],
    };
    expect(siegeEngineBonus(state, siege)).toBe(0);
  });

  describe('tickSieges: acelera la pérdida de provisiones', () => {
    it('cada catapulta presente resta 40 provisiones extra por turno, tope 2 catapultas (80 extra)', () => {
      const { state, armyId, targetProvinceId } = siegeFixture({ garrison: 550, fortLevel: 3 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);

      // turno FIJO (no acumulado) en cada medición, siempre fuera de invierno
      // (temporadas 0/1/2 = primavera/verano/otoño): así las 3 mediciones
      // aíslan el efecto de las catapultas sin que la 3ª pise el extra de
      // invierno (PROVISIONS_LOSS_WINTER=180) por simple acumulación de turnos.
      const before1 = state.sieges![0].provisions;
      state.turn = 1; // verano
      tickSieges(state, new Rng(state.rngState));
      const lossWithoutEngines = before1 - state.sieges![0].provisions;
      expect(lossWithoutEngines).toBe(120); // PROVISIONS_LOSS de siege.ts

      addCatapults(state, armyId, 2);
      const before2 = state.sieges![0].provisions;
      state.turn = 2; // otoño
      tickSieges(state, new Rng(state.rngState));
      const lossWithTwoEngines = before2 - state.sieges![0].provisions;
      expect(lossWithTwoEngines).toBe(120 + 2 * 40); // 200

      addCatapults(state, armyId, 3); // 5 catapultas en total: el tope sigue en 2
      const before3 = state.sieges![0].provisions;
      state.turn = 4; // primavera de nuevo (4 % 4 === 0), sigue sin ser invierno
      tickSieges(state, new Rng(state.rngState));
      const lossWithFiveEngines = before3 - state.sieges![0].provisions;
      expect(lossWithFiveEngines).toBe(120 + 2 * 40); // sigue en 200, NO 320: el tope se respeta
    });

    it('sin ninguna catapulta presente, el comportamiento es exactamente el de antes de esta feature (aditivo, no rompe siege.test.ts)', () => {
      const { state, armyId, targetProvinceId } = siegeFixture({ garrison: 40, fortLevel: 2 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);
      const provisionsMax = state.sieges![0].provisionsMax;
      expect(provisionsMax).toBe(40 * 2 + 2 * 300); // 680, igual que tests/siege.test.ts

      let ticks = 0;
      while ((state.sieges ?? []).length > 0 && ticks < 20) {
        state.turn += 1;
        tickSieges(state, new Rng(state.rngState));
        ticks += 1;
      }
      expect(ticks).toBe(6); // idéntico al test de rendición de tests/siege.test.ts
    });
  });

  describe('assaultSiege: brecha temporal (catapultas)', () => {
    it('el fortLevel se restaura EXACTAMENTE al original tras el asalto, gane o pierda, haya o no brecha', () => {
      const { state, armyId, targetProvinceId, targetProvince } = siegeFixture({ garrison: 550, fortLevel: 3 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);
      addCatapults(state, armyId, 2);
      const siegeId = state.sieges![0].id;
      expect(targetProvince.settlement.fortLevel).toBe(3);

      assaultSiege(state, new Rng(12345), siegeId);

      expect(targetProvince.settlement.fortLevel).toBe(3);
    });

    it('sin catapultas, no hay brecha (fortLevel nunca se toca, ni siquiera temporalmente) y el mensaje no menciona brecha', () => {
      const { state, armyId, targetProvinceId } = siegeFixture({ garrison: 15, fortLevel: 2 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);
      const siegeId = state.sieges![0].id;

      const result = assaultSiege(state, new Rng(1), siegeId);

      expect(result.message).not.toContain('brecha');
    });

    it('con 2 catapultas (brecha de 1 nivel de fortificación), el mensaje del asalto menciona la brecha', () => {
      const { state, armyId, targetProvinceId } = siegeFixture({ garrison: 550, fortLevel: 3 });
      const rngStart = new Rng(state.rngState);
      moveArmy(state, rngStart, armyId, targetProvinceId);
      addCatapults(state, armyId, 2);
      const siegeId = state.sieges![0].id;

      const result = assaultSiege(state, new Rng(12345), siegeId);

      expect(result.message).toContain('brecha');
    });

    it('un asalto con 2 catapultas contra una ciudadela (fortLevel 3) muy guarnicionada gana más a menudo en 20 semillas que el mismo asalto sin catapultas', () => {
      // Calibrado empíricamente contra el motor real (ver evidencia en el reporte):
      // un solo pelotón de 40 milicianos atacando una ciudadela (fortLevel 3,
      // guarnición 550) es un enfrentamiento CERCANO — sin catapultas gana muy
      // pocas de las 20 semillas; la brecha de 1 nivel (2 catapultas) empuja la
      // balanza con claridad. Con fuerzas muy desiguales (p.ej. el ejército
      // inicial completo) el atacante ya gana ~20/20 sin ayuda y el efecto de
      // la brecha no se podría medir — por eso el pelotón se recorta a mano.
      function winRate(withEngines: boolean): number {
        let wins = 0;
        for (let seed = 1; seed <= 20; seed++) {
          const { state, armyId, targetProvinceId } = siegeFixture({ garrison: 550, fortLevel: 3 });
          state.armies[armyId].units = [{ typeId: 'milicia', men: 40, morale: 8, xp: 0 } as UnitInstance];
          const rngStart = new Rng(state.rngState);
          moveArmy(state, rngStart, armyId, targetProvinceId);
          if (withEngines) addCatapults(state, armyId, 2);
          const siegeId = state.sieges![0].id;
          const result = assaultSiege(state, new Rng(seed * 1000 + 3), siegeId);
          if (result.battle?.winner === 'attacker') wins++;
        }
        return wins;
      }

      const winsWithout = winRate(false);
      const winsWith = winRate(true);

      expect(winsWithout, `sin catapultas: ${winsWithout}/20`).toBeLessThanOrEqual(10);
      expect(winsWith, `con catapultas: ${winsWith}/20`).toBeGreaterThanOrEqual(15);
      expect(winsWith).toBeGreaterThan(winsWithout);
    });
  });
});

// ============================================================================
// 3. systems/imperial.ts — tickImperial (Remanente Imperial)
// ============================================================================

function seedWhereChanceIs(p: number, wantTrue: boolean): number {
  for (let seed = 1; seed <= 200000; seed++) {
    if (new Rng(seed).chance(p) === wantTrue) return seed;
  }
  throw new Error(`no se encontró semilla determinista para chance(${p}) === ${wantTrue}`);
}

// 0.15 refleja EMERGENCE_CHANCE_PER_WINTER (privada en imperial.ts) — ver su docstring.
const FAVORABLE_SEED = seedWhereChanceIs(0.15, true);
const UNFAVORABLE_SEED = seedWhereChanceIs(0.15, false);

function mkProvince(over: Partial<Province> & { id: number; ownerId: string | null; neighbors: number[] }): Province {
  return {
    id: over.id,
    name: over.name ?? `Provincia ${over.id}`,
    terrain: over.terrain ?? 'plains',
    elevation: 0.3,
    center: over.center ?? [over.id, 0],
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    neighbors: over.neighbors,
    ownerId: over.ownerId,
    settlement: over.settlement ?? { name: `Villa ${over.id}`, level: 2, fortLevel: 0 },
    iron: over.iron ?? false,
    horses: over.horses ?? false,
    baseTax: 5,
    baseFood: 5,
    baseManpower: 100,
    garrison: over.garrison ?? 0,
  };
}

function mkFaction(over: Partial<Faction> & { id: string }): Faction {
  return {
    id: over.id,
    name: over.name ?? `Facción ${over.id}`,
    dynastyName: over.dynastyName ?? `Casa ${over.id}`,
    cultureId: over.cultureId ?? 'norlander',
    religionId: over.religionId ?? 'viejos_pactos',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: over.ai ?? 'ambitious',
    rulerId: over.rulerId ?? `ruler_${over.id}`,
    heirId: null,
    gold: over.gold ?? 100,
    manpower: over.manpower ?? 500,
    foodStock: 100,
    legitimacy: over.legitimacy ?? 60,
    alive: over.alive ?? true,
  };
}

function mkCharacter(id: string, factionId: string): Character {
  return {
    id, name: `Gobernante ${id}`, factionId, role: 'ruler', age: 40,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [], alive: true,
  };
}

/**
 * Mundo mínimo con 3 facciones vivas y territorio repartido a propósito:
 *  - 'jugador': 1 capital (id 1) + provincia 2.
 *  - 'rival_a': DOS capitales (id 3 e id 4) — la mayor cantidad de capitales
 *    del mapa, así que debe ser el objetivo del reclamo del Remanente.
 *  - 'rival_b': 1 capital (id 5).
 *  - sin señor: id 6 (nivel 3, el más alto sin dueño — candidato a capital
 *    imperial por la regla "mayor settlement.level") e id 7 (nivel 1).
 *  - centros (`Province.center`) elegidos para que, si 6 y 7 tuvieran dueño,
 *    la provincia 6 siga siendo la más central del mapa (usado en el test
 *    del fallback "sin tierra sin señor").
 */
function buildWorld(): GameState {
  const jugador = mkFaction({ id: 'jugador', cultureId: 'norlander', ai: 'player' });
  const rivalA = mkFaction({ id: 'rival_a', cultureId: 'estepara' });
  const rivalB = mkFaction({ id: 'rival_b', cultureId: 'aurelios' });

  const provinces: Province[] = [
    mkProvince({
      id: 1, ownerId: 'jugador', neighbors: [2, 3], center: [-30, -20],
      settlement: { name: 'Capital Jugador', level: 4, fortLevel: 2 },
    }),
    mkProvince({ id: 2, ownerId: 'jugador', neighbors: [1, 4], center: [-20, -10] }),
    mkProvince({
      id: 3, ownerId: 'rival_a', neighbors: [1, 5], center: [10, -20],
      settlement: { name: 'Capital Rival A', level: 4, fortLevel: 2 },
    }),
    mkProvince({
      id: 4, ownerId: 'rival_a', neighbors: [2, 6], center: [20, 10],
      settlement: { name: 'Segunda Capital Rival A', level: 4, fortLevel: 1 },
    }),
    mkProvince({
      id: 5, ownerId: 'rival_b', neighbors: [3, 7], center: [-10, 20],
      settlement: { name: 'Capital Rival B', level: 4, fortLevel: 1 },
    }),
    mkProvince({
      id: 6, ownerId: null, neighbors: [4, 7], center: [2, 1],
      settlement: { name: 'Villa 6', level: 3, fortLevel: 0 },
    }),
    mkProvince({
      id: 7, ownerId: null, neighbors: [5, 6], center: [30, 30],
      settlement: { name: 'Aldea 7', level: 1, fortLevel: 0 },
    }),
  ];

  const factions: Record<FactionId, Faction> = { jugador, rival_a: rivalA, rival_b: rivalB };
  const characters: Record<string, Character> = {
    [jugador.rulerId]: mkCharacter(jugador.rulerId, 'jugador'),
    [rivalA.rulerId]: mkCharacter(rivalA.rulerId, 'rival_a'),
    [rivalB.rulerId]: mkCharacter(rivalB.rulerId, 'rival_b'),
  };

  return {
    version: 1,
    seed: 1,
    turn: 0,
    playerFactionId: 'jugador',
    provinces,
    factions,
    characters,
    armies: {},
    wars: [],
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
  };
}

describe('systems/imperial.ts — tickImperial (Fase 3, AGENTE W)', () => {
  it('no surge antes del turno 32, aunque sea invierno y la tirada sería favorable', () => {
    const state = buildWorld();
    state.turn = 31; // 31 % 4 === 3: invierno, pero por debajo del umbral
    const messages = tickImperial(state, new Rng(FAVORABLE_SEED));
    expect(messages).toEqual([]);
    expect(state.factions[IMPERIAL_FACTION_ID]).toBeUndefined();
  });

  it('no surge fuera de invierno, aunque turn>=32 y la tirada sería favorable', () => {
    const state = buildWorld();
    state.turn = 36; // 36 % 4 === 0: primavera
    const messages = tickImperial(state, new Rng(FAVORABLE_SEED));
    expect(messages).toEqual([]);
    expect(state.factions[IMPERIAL_FACTION_ID]).toBeUndefined();
  });

  it('no surge en invierno con turno>=32 si la tirada es desfavorable', () => {
    const state = buildWorld();
    state.turn = 35; // 35 % 4 === 3: invierno
    const messages = tickImperial(state, new Rng(UNFAVORABLE_SEED));
    expect(messages).toEqual([]);
    expect(state.factions[IMPERIAL_FACTION_ID]).toBeUndefined();
  });

  it('con turno≥32, invierno y una tirada favorable (semilla forzada), SURGE el Remanente: facción, capital de nivel 4, dos huestes de 6 unidades tier 2 y guerra con cb "reclamo" contra quien más capitales tiene', () => {
    const state = buildWorld();
    state.turn = 35;
    const chronicleBefore = state.chronicle.length;

    const messages = tickImperial(state, new Rng(FAVORABLE_SEED));

    expect(messages.length).toBeGreaterThan(0);

    const remnant = state.factions[IMPERIAL_FACTION_ID];
    expect(remnant).toBeDefined();
    expect(remnant.ai).toBe('imperial');
    expect(remnant.name).toBe('Remanente de Aurelia');
    expect(remnant.dynastyName).toBe('Casa Aureliana');
    expect(remnant.cultureId).toBe('aurelios');
    expect(remnant.religionId).toBe('aureismo');
    expect(remnant.colorPrimary).toBe('#5a4fa0');
    expect(remnant.colorSecondary).toBe('#D9C8A0');
    expect(remnant.alive).toBe(true);
    expect(state.characters[remnant.rulerId]).toBeDefined();

    // capital: la provincia SIN SEÑOR de mayor settlement.level (id 6, nivel 3 > id 7 nivel 1).
    const capital = state.provinces.find(p => p.id === 6)!;
    expect(capital.ownerId).toBe(IMPERIAL_FACTION_ID);
    expect(capital.settlement.level).toBe(4);
    expect(capital.settlement.fortLevel).toBe(2);

    // dos huestes de 6 unidades tier 2 cada una, a plena dotación, en la capital.
    const armies = Object.values(state.armies).filter(a => a.factionId === IMPERIAL_FACTION_ID);
    expect(armies).toHaveLength(2);
    for (const army of armies) {
      expect(army.provinceId).toBe(capital.id);
      expect(army.units).toHaveLength(6);
      for (const u of army.units) {
        expect(getUnitType(u.typeId).tier).toBe(2);
        expect(u.men).toBe(getUnitType(u.typeId).menMax);
        expect(u.men).toBeGreaterThan(0);
      }
    }

    // guerra: reclamo contra 'rival_a' (2 capitales, más que jugador o rival_b, 1 cada uno).
    const war = state.wars.find(w => w.attackerId === IMPERIAL_FACTION_ID);
    expect(war).toBeDefined();
    expect(war!.defenderId).toBe('rival_a');
    expect(war!.cb).toBe('reclamo');

    // crónica de trueno + crónica de guerra.
    expect(state.chronicle.length).toBeGreaterThan(chronicleBefore);
    expect(state.chronicle.some(e => e.kind === 'mundo' && e.text.includes('Remanente de Aurelia'))).toBe(true);
    expect(state.chronicle.some(e => e.kind === 'guerra' && e.text.includes('Aureliana'))).toBe(true);
  });

  it('si no queda tierra sin señor en el mapa, la capital cae en la provincia más central del continente', () => {
    const state = buildWorld();
    state.provinces.find(p => p.id === 6)!.ownerId = 'jugador';
    state.provinces.find(p => p.id === 7)!.ownerId = 'jugador';
    state.turn = 35;

    tickImperial(state, new Rng(FAVORABLE_SEED));

    const remnant = state.factions[IMPERIAL_FACTION_ID];
    expect(remnant).toBeDefined();
    const capital = state.provinces.find(p => p.ownerId === IMPERIAL_FACTION_ID)!;
    expect(capital.id).toBe(6); // el centro [2,1] es, con diferencia, el más cercano al origen del mapa
  });

  it('no vuelve a surgir si ya existe (idempotente turno a turno, sin duplicar huestes)', () => {
    const state = buildWorld();
    state.turn = 35;
    tickImperial(state, new Rng(FAVORABLE_SEED));
    expect(state.factions[IMPERIAL_FACTION_ID]).toBeDefined();
    const armyCountAfterFirst = Object.keys(state.armies).length;

    state.turn = 39; // el invierno siguiente
    const messages2 = tickImperial(state, new Rng(seedWhereChanceIs(0.15, true)));

    expect(messages2).toEqual([]);
    expect(Object.keys(state.armies).length).toBe(armyCountAfterFirst);
  });

  it('runFactionAI no explota con el arquetipo "imperial" (factionAI.ts NO se toca — verificado en ejecución)', () => {
    const state = buildWorld();
    state.turn = 35;
    tickImperial(state, new Rng(FAVORABLE_SEED));
    expect(state.factions[IMPERIAL_FACTION_ID]).toBeDefined();

    expect(() => runFactionAI(state, new Rng(999), IMPERIAL_FACTION_ID)).not.toThrow();
    // sanity extra: tampoco lanza en varios turnos seguidos con movimiento reseteado.
    for (let i = 0; i < 5; i++) {
      for (const army of Object.values(state.armies)) army.movement = army.movementMax;
      expect(() => runFactionAI(state, new Rng(1000 + i), IMPERIAL_FACTION_ID)).not.toThrow();
    }
  });

  it('es determinista: la misma semilla forzada produce el mismo estado tras el surgimiento', () => {
    function run(): GameState {
      const state = buildWorld();
      state.turn = 35;
      tickImperial(state, new Rng(FAVORABLE_SEED));
      return state;
    }
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ============================================================================
// 4. systems/victory.ts — hegemonía y restauración
// ============================================================================

function mkVictoryFaction(id: string, over: Partial<Faction> = {}): Faction {
  return {
    id,
    name: `Reino ${id}`,
    dynastyName: `Casa ${id}`,
    cultureId: over.cultureId ?? 'norlander',
    religionId: over.religionId ?? 'viejos_pactos',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: over.ai ?? (id === 'jugador' ? 'player' : 'ambitious'),
    rulerId: `ruler_${id}`,
    heirId: null,
    gold: over.gold ?? 100,
    manpower: over.manpower ?? 100,
    foodStock: 100,
    legitimacy: 60,
    alive: over.alive ?? true,
  };
}

function mkVictoryProvince(id: number, ownerId: string | null, level: 1 | 2 | 3 | 4): Province {
  return {
    id,
    name: `Provincia ${id}`,
    terrain: 'plains',
    elevation: 0.3,
    center: [id, 0],
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    neighbors: [],
    ownerId,
    settlement: { name: `Villa ${id}`, level, fortLevel: 0 },
    iron: false,
    horses: false,
    baseTax: 5,
    baseFood: 5,
    baseManpower: 100,
    garrison: 0,
  };
}

function mkVictoryArmy(id: string, factionId: string, provinceId: number, men: number): Army {
  return {
    id, name: `Hueste ${id}`, factionId, provinceId,
    units: [{ typeId: 'milicia', men, morale: 8, xp: 0 }],
    generalId: null, movement: 2, movementMax: 2,
  };
}

function mkVictoryState(opts: {
  factions: Faction[];
  provinces: Province[];
  armies?: Army[];
  hegemonyStreakPlayer?: number;
}): GameState {
  const factions: Record<FactionId, Faction> = {};
  for (const f of opts.factions) factions[f.id] = f;
  const armies: Record<ArmyId, Army> = {};
  for (const a of opts.armies ?? []) armies[a.id] = a;
  return {
    version: 1, seed: 1, turn: 40, playerFactionId: 'jugador',
    provinces: opts.provinces, factions, characters: {}, armies, wars: [], relations: {}, chronicle: [],
    rngState: 1, lastBattle: null, outcome: 'ongoing',
    hegemonyStreakPlayer: opts.hegemonyStreakPlayer,
  };
}

describe('systems/victory.ts — hegemonía (Fase 3, AGENTE W)', () => {
  it('powerScore = provincias×2 + oro/50 + Σ fuerza de ejércitos', () => {
    // cultureId 'aurelios': attackMod 1.0 (content/cultures.ts) — matemática
    // limpia en el test, mismo truco que tests/ai.test.ts y tests/combat.test.ts.
    const jugador = mkVictoryFaction('jugador', { gold: 500, cultureId: 'aurelios' });
    const provinces = [mkVictoryProvince(1, 'jugador', 2), mkVictoryProvince(2, 'jugador', 2)];
    const army = mkVictoryArmy('a1', 'jugador', 1, 100);
    const state = mkVictoryState({ factions: [jugador], provinces, armies: [army] });

    const expected = 2 * 2 + 500 / 50 + (4.5); // 2 provincias, 500 oro, 1 pelotón de milicia a full (attack4+defense4)/2+armor*0.5=4.5
    expect(powerScore(state, 'jugador')).toBeCloseTo(expected, 5);
  });

  it('isLeadingPower: false en empate exacto en la cima (hegemonía exige ser el ÚNICO primero)', () => {
    const jugador = mkVictoryFaction('jugador', { gold: 100 });
    const rival = mkVictoryFaction('rival', { gold: 100 });
    const provinces = [mkVictoryProvince(1, 'jugador', 2), mkVictoryProvince(2, 'rival', 2)];
    const state = mkVictoryState({ factions: [jugador, rival], provinces });

    expect(powerScore(state, 'jugador')).toBeCloseTo(powerScore(state, 'rival'), 5);
    expect(isLeadingPower(state, 'jugador')).toBe(false);
  });

  it('la racha sube mientras el jugador es la mayor potencia, y se rompe (vuelve a 0) en cuanto deja de serlo', () => {
    const jugador = mkVictoryFaction('jugador', { gold: 10000 });
    const rival = mkVictoryFaction('rival', { gold: 10 });
    const provinces = [mkVictoryProvince(1, 'jugador', 2), mkVictoryProvince(2, 'rival', 2)];
    const state = mkVictoryState({ factions: [jugador, rival], provinces });

    expect(state.hegemonyStreakPlayer).toBeUndefined();
    updateVictoryProgress(state);
    expect(state.hegemonyStreakPlayer).toBe(1);
    updateVictoryProgress(state);
    expect(state.hegemonyStreakPlayer).toBe(2);
    updateVictoryProgress(state);
    expect(state.hegemonyStreakPlayer).toBe(3);

    // el rival adelanta de golpe al jugador: la racha se rompe.
    state.factions.rival.gold = 1_000_000;
    updateVictoryProgress(state);
    expect(state.hegemonyStreakPlayer).toBe(0);

    // vuelve a liderar: la racha arranca de nuevo desde 1, no desde donde se rompió.
    state.factions.rival.gold = 10;
    updateVictoryProgress(state);
    expect(state.hegemonyStreakPlayer).toBe(1);
  });

  it('checkExtraVictories devuelve "victory_hegemonia" al llegar a 16 (4 años), y null justo antes', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'norlander' });
    const rival = mkVictoryFaction('rival', { cultureId: 'estepara' });
    // ninguna de las dos capitales las controla el jugador entero: evita que
    // la restauración se cuele antes de tiempo en este test de hegemonía.
    const provinces = [mkVictoryProvince(1, 'jugador', 4), mkVictoryProvince(2, 'rival', 4)];
    const state = mkVictoryState({ factions: [jugador, rival], provinces, hegemonyStreakPlayer: 15 });

    expect(checkExtraVictories(state)).toBeNull();
    state.hegemonyStreakPlayer = 16;
    expect(checkExtraVictories(state)).toBe('victory_hegemonia');
  });

  it('checkExtraVictories no muta hegemonyStreakPlayer (solo lo lee; mutarlo es responsabilidad exclusiva de updateVictoryProgress)', () => {
    const jugador = mkVictoryFaction('jugador');
    const state = mkVictoryState({ factions: [jugador], provinces: [], hegemonyStreakPlayer: 5 });
    checkExtraVictories(state);
    expect(state.hegemonyStreakPlayer).toBe(5);
  });

  it('devuelve null si el jugador no está vivo (sin víctimas póstumas)', () => {
    const jugador = mkVictoryFaction('jugador', { alive: false });
    const state = mkVictoryState({ factions: [jugador], provinces: [], hegemonyStreakPlayer: 999 });
    expect(checkExtraVictories(state)).toBeNull();
  });
});

describe('systems/victory.ts — restauración imperial (Fase 3, AGENTE W)', () => {
  const ANCESTRAL_ID = casaVargaAncestralCapitalId();

  it('casaVargaAncestralCapitalId() es estable y coincide con idAt(2,2) de content/newGame.ts:FACTION_SETUPS[0]', () => {
    expect(ANCESTRAL_ID).toBe(idAt(2, 2));
    expect(casaVargaAncestralCapitalId()).toBe(ANCESTRAL_ID); // determinista entre llamadas
  });

  it('hasAurelianClaim: true si la cultura es aurelios, aunque no posea la capital ancestral', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'aurelios' });
    const state = mkVictoryState({ factions: [jugador], provinces: [mkVictoryProvince(ANCESTRAL_ID, 'otro', 4)] });
    expect(hasAurelianClaim(state, 'jugador')).toBe(true);
  });

  it('hasAurelianClaim: true si NO es cultura aurelios pero posee la provincia de la capital ancestral de Casa Varga', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'norlander' });
    const state = mkVictoryState({ factions: [jugador], provinces: [mkVictoryProvince(ANCESTRAL_ID, 'jugador', 4)] });
    expect(hasAurelianClaim(state, 'jugador')).toBe(true);
  });

  it('hasAurelianClaim: false sin cultura aurelios y sin poseer la capital ancestral', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'norlander' });
    const state = mkVictoryState({ factions: [jugador], provinces: [mkVictoryProvince(ANCESTRAL_ID, 'otro', 4)] });
    expect(hasAurelianClaim(state, 'jugador')).toBe(false);
  });

  it('restauración: cultura aurelios + controla TODAS las capitales de nivel 4 → "victory_restauracion"', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'aurelios' });
    const provinces = [
      mkVictoryProvince(ANCESTRAL_ID, 'jugador', 4),
      mkVictoryProvince(100, 'jugador', 4),
      mkVictoryProvince(101, 'jugador', 3), // no-capital: no cuenta, no hace falta poseerla
    ];
    const state = mkVictoryState({ factions: [jugador], provinces });
    expect(checkExtraVictories(state)).toBe('victory_restauracion');
  });

  it('restauración: cultura NO aurelios pero posee la capital original de Casa Varga + TODAS las capitales → "victory_restauracion"', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'estepara' });
    const provinces = [
      mkVictoryProvince(ANCESTRAL_ID, 'jugador', 4),
      mkVictoryProvince(100, 'jugador', 4),
    ];
    const state = mkVictoryState({ factions: [jugador], provinces });
    expect(checkExtraVictories(state)).toBe('victory_restauracion');
  });

  it('sin controlar TODAS las capitales, NO hay restauración aunque el jugador sea de cultura aurelios', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'aurelios' });
    const rival = mkVictoryFaction('rival', { cultureId: 'norlander' });
    const provinces = [
      mkVictoryProvince(ANCESTRAL_ID, 'jugador', 4),
      mkVictoryProvince(100, 'rival', 4), // una capital ajena: falta reunificar
    ];
    const state = mkVictoryState({ factions: [jugador, rival], provinces, hegemonyStreakPlayer: 0 });
    expect(checkExtraVictories(state)).toBeNull();
  });

  it('controlando TODAS las capitales pero SIN reclamo aureliano (ni cultura ni capital ancestral), NO hay restauración', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'norlander' });
    const provinces = [
      mkVictoryProvince(ANCESTRAL_ID, 'otro', 4), // la capital ancestral NO es del jugador
      mkVictoryProvince(100, 'jugador', 4),
    ];
    const state = mkVictoryState({ factions: [jugador], provinces, hegemonyStreakPlayer: 0 });
    expect(checkExtraVictories(state)).toBeNull();
  });

  it('sin ninguna provincia de nivel 4 en el mundo, no hay restauración (guard de "capitals.length > 0")', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'aurelios' });
    const state = mkVictoryState({ factions: [jugador], provinces: [mkVictoryProvince(1, 'jugador', 2)] });
    expect(checkExtraVictories(state)).toBeNull();
  });

  it('prioridad: si restauración Y hegemonía se cumplen a la vez, gana "victory_restauracion" (prioridad narrativa)', () => {
    const jugador = mkVictoryFaction('jugador', { cultureId: 'aurelios' });
    const provinces = [mkVictoryProvince(ANCESTRAL_ID, 'jugador', 4), mkVictoryProvince(100, 'jugador', 4)];
    const state = mkVictoryState({ factions: [jugador], provinces, hegemonyStreakPlayer: 99 });
    expect(checkExtraVictories(state)).toBe('victory_restauracion');
  });
});

// ============================================================================
// Integración: el cableado documentado (tickImperial → updateVictoryProgress
// → checkExtraVictories) tal y como turn.ts debería invocarlo — sin tocar
// turn.ts, solo probando que la composición funciona como se documentó.
// ============================================================================

describe('integración manual: orden de cableado documentado para turn.ts (Fase 3, AGENTE W)', () => {
  it('tickImperial, luego updateVictoryProgress, luego checkExtraVictories: no revienta y respeta la prioridad restauración > conquista', () => {
    const state = buildWorld();
    // el jugador ya controla las otras 2 capitales del mundo (3->rival_a la
    // tiene, así que se la damos al jugador para simular una conquista previa)
    // y es de cultura aurelios: solo le falta la capital que el Remanente está
    // a punto de fundar sobre la provincia 6 (nivel 3, sin señor).
    state.factions.jugador.cultureId = 'aurelios';
    state.provinces.find(p => p.id === 3)!.ownerId = 'jugador';
    state.provinces.find(p => p.id === 4)!.ownerId = 'jugador';
    state.provinces.find(p => p.id === 5)!.ownerId = 'jugador';
    state.turn = 35;

    expect(() => {
      tickImperial(state, new Rng(FAVORABLE_SEED));
      updateVictoryProgress(state);
      const extra = checkExtraVictories(state);
      if (extra) state.outcome = extra;
    }).not.toThrow();

    // el Remanente acaba de fundar SU capital (provincia 6): el jugador
    // todavía no la controla, así que la restauración NO puede haberse
    // disparado ya (haría falta conquistar también esa capital nueva).
    expect(state.provinces.find(p => p.id === 6)!.ownerId).toBe(IMPERIAL_FACTION_ID);
    expect(state.outcome).toBe('ongoing');

    // si el jugador ahora conquista esa última capital (simulado a mano, sin
    // pasar por combate real: no es el objeto de este test), la restauración
    // sí se dispara en el siguiente paso del cableado documentado.
    state.provinces.find(p => p.id === 6)!.ownerId = 'jugador';
    updateVictoryProgress(state);
    const extra = checkExtraVictories(state);
    expect(extra).toBe('victory_restauracion');
  });
});
