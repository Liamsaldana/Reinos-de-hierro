/**
 * Tests del motor táctico hexagonal (GDD §8) — AGENTE F.
 *
 * No depende de `content/newGame.ts` (agente B) ni de otros sistemas: registra
 * sus PROPIOS UnitType mutando `UNIT_TYPES` con Object.assign (igual que
 * combat.test.ts) y construye el GameState a mano.
 */
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES } from '../src/core/content/units';
import { Rng } from '../src/core/state/rng';
import type {
  Army, Character, Faction, GameState, Province, UnitType, War,
} from '../src/core/types';
import {
  applyTacticalResult, createTacticalBattle, finishDeployment, legalMoveHexes, runAIActivation,
} from '../src/core/tactical/api';
import { cellKey, offsetToAxial } from '../src/core/tactical/grid';
import type { TacticalState } from '../src/core/tactical/types';

// ---------------------------------------------------------------- UnitType test
Object.assign(UNIT_TYPES, {
  t_inf: {
    id: 't_inf', name: 'Infantería de hierro', category: 'infantry', tier: 1, culture: null,
    attack: 9, defense: 10, armor: 3, rangedPower: 0, initiative: 5, speed: 3,
    moraleMax: 12, menMax: 100, cost: { gold: 10, manpower: 50 }, upkeep: 1,
  },
  t_spear: {
    id: 't_spear', name: 'Lanceros del valle', category: 'spear', tier: 1, culture: null,
    attack: 7, defense: 11, armor: 2, rangedPower: 0, initiative: 4, speed: 3,
    moraleMax: 12, menMax: 100, cost: { gold: 10, manpower: 45 }, upkeep: 1,
  },
  t_cav: {
    id: 't_cav', name: 'Jinetes de la marca', category: 'cavalry', tier: 1, culture: null,
    attack: 13, defense: 7, armor: 3, rangedPower: 0, initiative: 8, speed: 7,
    moraleMax: 11, menMax: 80, cost: { gold: 20, manpower: 40 }, upkeep: 2,
  },
  t_arc: {
    id: 't_arc', name: 'Arqueros del bosque', category: 'ranged', tier: 1, culture: null,
    attack: 4, defense: 5, armor: 1, rangedPower: 9, initiative: 6, speed: 3,
    moraleMax: 10, menMax: 80, cost: { gold: 15, manpower: 30 }, upkeep: 1,
  },
  milicia: {
    id: 'milicia', name: 'Milicia local', category: 'infantry', tier: 1, culture: null,
    attack: 6, defense: 7, armor: 2, rangedPower: 0, initiative: 8, speed: 8,
    moraleMax: 9, menMax: 100, cost: { gold: 0, manpower: 0 }, upkeep: 0,
  },
} satisfies Record<string, UnitType>);

// ---------------------------------------------------------------- constructores
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
    iron: false, horses: false, baseTax: 1, baseFood: 1, baseManpower: 1,
    garrison: over.garrison ?? 0,
  };
}

function makeFaction(id: string, ai: Faction['ai']): Faction {
  return {
    id, name: `Facción ${id}`, dynastyName: `Casa ${id}`, cultureId: 'aurelios', religionId: 'aureismo',
    colorPrimary: '#111', colorSecondary: '#222', bannerSeed: 1, ai,
    rulerId: `ruler_${id}`, heirId: null, gold: 1000, manpower: 5000, foodStock: 100,
    legitimacy: 80, alive: true,
  };
}

function makeChar(id: string, factionId: string, martial: number): Character {
  return {
    id, name: `General ${id}`, factionId, role: 'general', age: 40,
    attributes: { martial, stewardship: 4, diplomacy: 4, intrigue: 4 }, traits: [], alive: true,
  };
}

function army(id: string, factionId: string, provinceId: number, generalId: string | null, units: Army['units']): Army {
  return { id, name: `Hueste ${id}`, factionId, provinceId, generalId, movement: 2, movementMax: 2, units };
}

/** GameState con 3 provincias (1 y 3 propias de cada bando, 2 en disputa) y guerra f1-f2. */
function baseState(battleTerrain: Province['terrain'] = 'plains'): GameState {
  const p1 = makeProvince({ id: 1, ownerId: 'f1', neighbors: [2] });
  const p2 = makeProvince({ id: 2, ownerId: 'f2', neighbors: [1, 3], terrain: battleTerrain });
  const p3 = makeProvince({ id: 3, ownerId: 'f2', neighbors: [2] });
  const f1 = makeFaction('f1', 'player');
  const f2 = makeFaction('f2', 'consolidated');
  const war: War = {
    id: 'w1', attackerId: 'f1', defenderId: 'f2', cb: 'reclamo',
    warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0,
  };
  return {
    version: 1, seed: 1, turn: 4, playerFactionId: 'f1',
    provinces: [p1, p2, p3],
    factions: { f1, f2 },
    characters: {
      g1: makeChar('g1', 'f1', 6),
      g2: makeChar('g2', 'f2', 5),
    },
    armies: {},
    wars: [war], relations: {}, chronicle: [], rngState: 1, lastBattle: null, outcome: 'ongoing',
  };
}

/** Dos huestes equilibradas en la provincia 2 (atacante f1 invade). */
function balancedBattle(state: GameState): void {
  state.armies.att = army('att', 'f1', 2, 'g1', [
    { typeId: 't_inf', men: 100, morale: 12, xp: 0 },
    { typeId: 't_inf', men: 100, morale: 12, xp: 0 },
    { typeId: 't_spear', men: 100, morale: 12, xp: 0 },
    { typeId: 't_arc', men: 80, morale: 10, xp: 0 },
    { typeId: 't_cav', men: 80, morale: 11, xp: 0 },
  ]);
  state.armies.def = army('def', 'f2', 2, 'g2', [
    { typeId: 't_inf', men: 100, morale: 12, xp: 0 },
    { typeId: 't_spear', men: 100, morale: 12, xp: 0 },
    { typeId: 't_spear', men: 100, morale: 12, xp: 0 },
    { typeId: 't_arc', men: 80, morale: 10, xp: 0 },
    { typeId: 't_cav', men: 80, morale: 11, xp: 0 },
  ]);
}

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function runToEnd(ts: TacticalState): number {
  finishDeployment(ts);
  let guard = 0;
  while (ts.phase === 'battle') {
    runAIActivation(ts);
    if (++guard > 100000) throw new Error('bucle de IA no termina');
  }
  return ts.round;
}

// ------------------------------------------------------------------------ tests
describe('motor táctico: creación y determinismo', () => {
  it('misma semilla produce un TacticalState JSON idéntico', () => {
    const s1 = baseState(); balancedBattle(s1);
    const s2 = deepClone(s1);
    const ts1 = createTacticalBattle(s1, new Rng(9090), 'f1', 2);
    const ts2 = createTacticalBattle(s2, new Rng(9090), 'f1', 2);
    expect(JSON.stringify(ts1)).toBe(JSON.stringify(ts2));
  });

  it('coloca ambos bandos en sus zonas y no muta el estado estratégico', () => {
    const state = baseState(); balancedBattle(state);
    const before = JSON.stringify(state);
    const ts = createTacticalBattle(state, new Rng(1), 'f1', 2);
    expect(JSON.stringify(state)).toBe(before); // no muta GameState
    const att = ts.units.filter(u => u.side === 'attacker');
    const def = ts.units.filter(u => u.side === 'defender');
    expect(att.length).toBe(5);
    expect(def.length).toBe(5);
    for (const u of att) expect(u.coord.r).toBeGreaterThanOrEqual(ts.rows - 3);
    for (const u of def) expect(u.coord.r).toBeLessThanOrEqual(2);
    expect(ts.playerSide).toBe('attacker');
    expect(ts.attackerGeneral?.abilityCharges).toBe(2);
  });
});

describe('motor táctico: movimiento legal', () => {
  it('legalMoveHexes queda dentro de la rejilla y evita celdas bloqueadas/ocupadas', () => {
    const state = baseState('mountain'); balancedBattle(state);
    const ts = createTacticalBattle(state, new Rng(77), 'f1', 2);
    finishDeployment(ts);
    const cells = new Map(ts.cells.map(c => [cellKey(c.coord), c]));
    const occupied = new Set(ts.units.filter(u => !u.routed).map(u => cellKey(u.coord)));

    let checked = 0;
    for (const u of ts.units) {
      const hexes = legalMoveHexes(ts, u.id);
      for (const h of hexes) {
        const cell = cells.get(cellKey(h));
        expect(cell).toBeDefined();          // dentro de la rejilla
        expect(cell!.blocked).toBe(false);   // nunca una celda bloqueada
        expect(occupied.has(cellKey(h))).toBe(false); // nunca ocupada por otra unidad
        expect(h.r).toBeGreaterThanOrEqual(0);
        expect(h.r).toBeLessThan(ts.rows);
      }
      checked += hexes.length;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('motor táctico: batalla IA vs IA', () => {
  it('una batalla completa termina en ≤12 rondas, sin lanzar y con ganador', () => {
    const rounds: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const state = baseState(); balancedBattle(state);
      const ts = createTacticalBattle(state, new Rng(seed * 131 + 5), 'f1', 2);
      const r = runToEnd(ts);
      expect(ts.phase).toBe('finished');
      expect(ts.winner === 'attacker' || ts.winner === 'defender').toBe(true);
      expect(r).toBeLessThanOrEqual(12);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(ts.log.length).toBeGreaterThan(5);
      rounds.push(r);
    }
    // pacing objetivo del GDD (~4-8 rondas): la media debe caer en ese rango
    const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    expect(avg).toBeGreaterThanOrEqual(4);
    expect(avg).toBeLessThanOrEqual(8);
  });
});

describe('motor táctico: volcado al estado estratégico', () => {
  it('applyTacticalResult conserva hombres (0 ≤ final ≤ inicial) y produce un reporte coherente', () => {
    const state = baseState(); balancedBattle(state);
    const initialAtt = state.armies.att.units.reduce((s, u) => s + u.men, 0);
    const initialDef = state.armies.def.units.reduce((s, u) => s + u.men, 0);

    const ts = createTacticalBattle(state, new Rng(4242), 'f1', 2);
    runToEnd(ts);
    const report = applyTacticalResult(state, new Rng(4242), ts);

    // conservación de hombres
    expect(report.attacker.losses).toBeGreaterThanOrEqual(0);
    expect(report.attacker.losses).toBeLessThanOrEqual(initialAtt);
    expect(report.defender.losses).toBeGreaterThanOrEqual(0);
    expect(report.defender.losses).toBeLessThanOrEqual(initialDef);
    for (const a of Object.values(state.armies)) {
      for (const u of a.units) {
        expect(u.men).toBeGreaterThan(0); // instancias vacías eliminadas
        expect(u.men).toBeLessThanOrEqual(100);
      }
    }

    // reporte coherente
    expect(report.winner === 'attacker' || report.winner === 'defender').toBe(true);
    expect(report.attacker.factionId).toBe('f1');
    expect(report.defender.factionId).toBe('f2');
    expect(report.narrative.length).toBeGreaterThanOrEqual(6);
    expect(report.narrative.length).toBeLessThanOrEqual(10);
    expect(state.lastBattle).toBe(report);
    expect(state.chronicle.some(c => c.kind === 'batalla')).toBe(true);
    expect(Math.abs(report.warScoreDelta)).toBeGreaterThanOrEqual(4);
    // el warScore de la guerra cambió en la magnitud del delta
    expect(state.wars[0].warScore).toBe(report.warScoreDelta);
  });

  it('si gana el atacante la guarnición neutral queda en 0', () => {
    const state = baseState();
    state.provinces[1].ownerId = null;        // provincia 2 sin señor
    state.provinces[1].garrison = 120;        // guarnición de milicia
    state.armies.invasor = army('invasor', 'f1', 2, 'g1', [
      { typeId: 't_inf', men: 100, morale: 12, xp: 0 },
      { typeId: 't_inf', men: 100, morale: 12, xp: 0 },
      { typeId: 't_cav', men: 80, morale: 11, xp: 0 },
    ]);
    const ts = createTacticalBattle(state, new Rng(555), 'f1', 2);
    // la guarnición neutral debe generar pelotones defensores
    expect(ts.units.some(u => u.side === 'defender' && u.sourceArmyId === null)).toBe(true);
    runToEnd(ts);
    const report = applyTacticalResult(state, new Rng(555), ts);
    if (report.winner === 'attacker') {
      expect(state.provinces[1].garrison).toBe(0);
    }
    expect(report.defender.factionId).toBeNull();
  });
});

describe('motor táctico: terreno de costa', () => {
  it('el río de la costa tiene vados transitables (celdas rio no bloqueadas)', () => {
    let foundFord = false;
    for (let seed = 1; seed <= 6 && !foundFord; seed++) {
      const state = baseState('coast'); balancedBattle(state);
      const ts = createTacticalBattle(state, new Rng(seed * 13), 'f1', 2);
      const rioCells = ts.cells.filter(c => c.terrain === 'rio');
      expect(rioCells.length).toBeGreaterThan(0);          // hay río
      const fords = rioCells.filter(c => !c.blocked);
      expect(fords.length).toBeGreaterThanOrEqual(1);      // al menos un vado
      expect(fords.length).toBeLessThanOrEqual(2);         // 1-2 vados (cuello de botella)
      // el resto del río está bloqueado
      expect(rioCells.some(c => c.blocked)).toBe(true);
      if (fords.length >= 1) foundFord = true;
    }
    expect(foundFord).toBe(true);
    // el vado usa las mismas coords axiales que la rejilla (offsetToAxial)
    expect(cellKey(offsetToAxial(0, 6))).toBe('-3,6');
  });
});
