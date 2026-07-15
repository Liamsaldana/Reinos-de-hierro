/**
 * Tests de construcción de edificios, mejora de fortificación y conversión
 * religiosa (Fase 2, GDD §9.1-9.2, §2.3) — AGENTE P.
 *
 * Estado armado a mano (sin newGame): control total sobre terreno/recursos/
 * asentamiento/fe para probar requisitos exactos sin pelear con el mapa
 * procedural. Mismo patrón que tests/combat.test.ts (AGENTE D).
 */
import { describe, expect, it } from 'vitest';
import {
  buildableIn, buildingSlots, cancelConstruction, startConstruction, tickConstruction, WALL_UPGRADE_ID,
} from '../src/core/systems/construction';
import { convertCost, convertProvince, religionTension } from '../src/core/systems/religion';
import {
  buildingEffects, foodProduction, legitimacyTick, manpowerGain, taxIncome,
} from '../src/core/systems/economy';
import { getBuilding } from '../src/core/content/buildings';
import type { Faction, GameState, Province } from '../src/core/types';

// ---------- constructor mínimo de GameState (sin newGame) ----------

function makeProvince(over: Partial<Province> & { id: number; ownerId: string | null }): Province {
  return {
    id: over.id,
    name: over.name ?? `Provincia ${over.id}`,
    terrain: over.terrain ?? 'plains',
    elevation: 0.3,
    center: [over.id, 0],
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    neighbors: over.neighbors ?? [],
    ownerId: over.ownerId,
    settlement: over.settlement ?? { name: `Villa ${over.id}`, level: 2, fortLevel: 0 },
    iron: over.iron ?? false,
    horses: over.horses ?? false,
    baseTax: over.baseTax ?? 5,
    baseFood: over.baseFood ?? 5,
    baseManpower: over.baseManpower ?? 100,
    garrison: over.garrison ?? 0,
    religionId: over.religionId ?? 'aureismo',
    buildings: over.buildings ?? [],
    buildQueue: over.buildQueue ?? null,
  };
}

function makeFaction(over: Partial<Faction> & { id: string }): Faction {
  return {
    id: over.id,
    name: over.name ?? `Facción ${over.id}`,
    dynastyName: over.dynastyName ?? `Casa ${over.id}`,
    cultureId: over.cultureId ?? 'aurelios',
    religionId: over.religionId ?? 'aureismo',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: over.ai ?? 'player',
    rulerId: over.rulerId ?? `ruler_${over.id}`,
    heirId: null,
    gold: over.gold ?? 500,
    manpower: over.manpower ?? 5000,
    foodStock: over.foodStock ?? 100,
    legitimacy: over.legitimacy ?? 60,
    alive: true,
  };
}

function baseState(provinces: Province[], factions: Record<string, Faction>): GameState {
  return {
    version: 1,
    seed: 1,
    turn: 4, // año 2, primavera (turn%4===0 → season 0, sin bonos estacionales)
    playerFactionId: 'f1',
    provinces,
    factions,
    characters: {},
    armies: {},
    wars: [],
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
    sieges: [],
  };
}

// ---------- startConstruction ----------

describe('construction: startConstruction', () => {
  it('rechaza si la provincia no es propia', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f2' });
    const f1 = makeFaction({ id: 'f1' });
    const f2 = makeFaction({ id: 'f2' });
    const state = baseState([p1], { f1, f2 });
    const res = startConstruction(state, 'f1', 1, 'granja');
    expect(res.ok).toBe(false);
  });

  it('rechaza sin oro suficiente y no cobra ni arma la cola', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', gold: 10 });
    const state = baseState([p1], { f1 });
    const res = startConstruction(state, 'f1', 1, 'granja');
    expect(res.ok).toBe(false);
    expect(state.factions.f1.gold).toBe(10);
    expect(state.provinces[0].buildQueue).toBeNull();
  });

  it('valida y cobra: el éxito arma buildQueue y descuenta el oro exacto', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const def = getBuilding('granja');

    const res = startConstruction(state, 'f1', 1, 'granja');

    expect(res.ok).toBe(true);
    expect(state.factions.f1.gold).toBe(500 - def.cost.gold);
    expect(state.provinces[0].buildQueue).toEqual({ buildingId: 'granja', turnsLeft: def.cost.turns });
  });

  it('rechaza una segunda obra mientras la cola está ocupada (una obra a la vez)', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    startConstruction(state, 'f1', 1, 'granja');
    const goldMidway = state.factions.f1.gold;

    const res = startConstruction(state, 'f1', 1, 'mercado');

    expect(res.ok).toBe(false);
    expect(state.factions.f1.gold).toBe(goldMidway); // no cobra dos veces
  });

  it('rechaza un edificio ya construido (no duplicado)', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', buildings: ['granja'] });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const res = startConstruction(state, 'f1', 1, 'granja');
    expect(res.ok).toBe(false);
  });

  it('respeta el cupo de ranuras (2 + nivel de asentamiento)', () => {
    const p1 = makeProvince({
      id: 1,
      ownerId: 'f1',
      settlement: { name: 'V', level: 1, fortLevel: 0 }, // cupo = 2+1 = 3
      buildings: ['granja', 'mercado', 'biblioteca'],
    });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });

    // la mejora de fortificación no consume ranura: sigue disponible.
    expect(buildableIn(state, 1).filter(b => b.id !== WALL_UPGRADE_ID)).toEqual([]);
    expect(buildableIn(state, 1).some(b => b.id === WALL_UPGRADE_ID)).toBe(true);

    const res = startConstruction(state, 'f1', 1, 'cuartel');
    expect(res.ok).toBe(false);
  });
});

// ---------- requisitos ----------

describe('construction: requisitos (puerto solo costa, mina solo hierro)', () => {
  it('puerto: rechazado tierra adentro, permitido en costa', () => {
    const inland = makeProvince({ id: 1, ownerId: 'f1', terrain: 'plains' });
    const coast = makeProvince({ id: 2, ownerId: 'f1', terrain: 'coast' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([inland, coast], { f1 });

    expect(buildableIn(state, 1).some(b => b.id === 'puerto')).toBe(false);
    expect(startConstruction(state, 'f1', 1, 'puerto').ok).toBe(false);

    expect(buildableIn(state, 2).some(b => b.id === 'puerto')).toBe(true);
    expect(startConstruction(state, 'f1', 2, 'puerto').ok).toBe(true);
  });

  it('mina: rechazada sin hierro, permitida con hierro', () => {
    const noIron = makeProvince({ id: 1, ownerId: 'f1', iron: false });
    const withIron = makeProvince({ id: 2, ownerId: 'f1', iron: true });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([noIron, withIron], { f1 });

    expect(buildableIn(state, 1).some(b => b.id === 'mina')).toBe(false);
    expect(startConstruction(state, 'f1', 1, 'mina').ok).toBe(false);

    expect(buildableIn(state, 2).some(b => b.id === 'mina')).toBe(true);
    expect(startConstruction(state, 'f1', 2, 'mina').ok).toBe(true);
  });

  it('corte: solo en la capital (settlement.level === 4)', () => {
    const town = makeProvince({ id: 1, ownerId: 'f1', settlement: { name: 'V', level: 3, fortLevel: 0 } });
    const capital = makeProvince({ id: 2, ownerId: 'f1', settlement: { name: 'C', level: 4, fortLevel: 2 } });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([town, capital], { f1 });

    expect(startConstruction(state, 'f1', 1, 'corte').ok).toBe(false);
    expect(startConstruction(state, 'f1', 2, 'corte').ok).toBe(true);
  });
});

// ---------- cancelConstruction ----------

describe('construction: cancelConstruction', () => {
  it('devuelve el 50% del oro pagado y libera la cola', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const def = getBuilding('mercado');
    startConstruction(state, 'f1', 1, 'mercado');
    const goldAfterStart = state.factions.f1.gold;

    const res = cancelConstruction(state, 'f1', 1);

    expect(res.ok).toBe(true);
    expect(state.factions.f1.gold).toBe(goldAfterStart + Math.floor(def.cost.gold * 0.5));
    expect(state.provinces[0].buildQueue).toBeNull();
  });

  it('rechaza cancelar si no hay obra en curso', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1' });
    const state = baseState([p1], { f1 });
    expect(cancelConstruction(state, 'f1', 1).ok).toBe(false);
  });
});

// ---------- tickConstruction ----------

describe('construction: tickConstruction completa y aplica efectos', () => {
  it('al llegar turnsLeft a 0, empuja el edificio a buildings y limpia la cola', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const def = getBuilding('granja');
    startConstruction(state, 'f1', 1, 'granja');

    for (let i = 0; i < def.cost.turns - 1; i++) {
      tickConstruction(state);
      expect(state.provinces[0].buildings).not.toContain('granja');
    }
    tickConstruction(state);

    expect(state.provinces[0].buildings).toContain('granja');
    expect(state.provinces[0].buildQueue).toBeNull();
  });

  it('registra crónica \'economia\' y mensaje SOLO para la provincia del jugador', () => {
    const mine = makeProvince({ id: 1, ownerId: 'f1' });
    const other = makeProvince({ id: 2, ownerId: 'f2' });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const f2 = makeFaction({ id: 'f2', gold: 500 });
    const state = baseState([mine, other], { f1, f2 });
    state.playerFactionId = 'f1';
    startConstruction(state, 'f1', 1, 'granja'); // 2 turnos
    startConstruction(state, 'f2', 2, 'granja'); // 2 turnos, misma duración

    const msgsTurn1 = tickConstruction(state);
    const msgsTurn2 = tickConstruction(state);

    expect(state.provinces[0].buildings).toContain('granja');
    expect(state.provinces[1].buildings).toContain('granja'); // la IA también termina su obra
    expect([...msgsTurn1, ...msgsTurn2].length).toBe(1); // solo el jugador genera mensaje
    expect(state.chronicle.length).toBe(1);
    expect(state.chronicle[0].kind).toBe('economia');
    expect(state.chronicle[0].text).toContain(mine.name);
  });

  it('efectos visibles en taxIncome antes/después de completar un mercado', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', baseTax: 5 });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const before = taxIncome(state, 'f1', 0);

    const def = getBuilding('mercado');
    startConstruction(state, 'f1', 1, 'mercado');
    for (let i = 0; i < def.cost.turns; i++) tickConstruction(state);

    const after = taxIncome(state, 'f1', 0);
    expect(after - before).toBeCloseTo(def.effects.taxFlat ?? 0);
  });

  it('efectos visibles en foodProduction antes/después de completar una granja', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', baseFood: 5 });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const before = foodProduction(state, 'f1', 0);

    const def = getBuilding('granja');
    startConstruction(state, 'f1', 1, 'granja');
    for (let i = 0; i < def.cost.turns; i++) tickConstruction(state);

    const after = foodProduction(state, 'f1', 0);
    expect(after - before).toBeCloseTo(def.effects.foodFlat ?? 0);
  });

  it('manpowerGain sube el flat exacto de un cuartel tras completarse', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', baseManpower: 100 });
    const f1 = makeFaction({ id: 'f1', gold: 500 });
    const state = baseState([p1], { f1 });
    const before = manpowerGain(state, 'f1');

    const def = getBuilding('cuartel');
    startConstruction(state, 'f1', 1, 'cuartel');
    for (let i = 0; i < def.cost.turns; i++) tickConstruction(state);

    const after = manpowerGain(state, 'f1');
    expect(after - before).toBe(def.effects.manpowerFlat ?? 0);
  });
});

// ---------- mejora de fortificación ----------

describe('construction: mejora de fortificación (muralla_up)', () => {
  it('sube fortLevel de uno en uno, con coste creciente, hasta el cap 3', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', settlement: { name: 'V', level: 2, fortLevel: 0 } });
    const f1 = makeFaction({ id: 'f1', gold: 100000 });
    const state = baseState([p1], { f1 });

    const costs: number[] = [];
    for (let level = 0; level < 3; level++) {
      const before = state.factions.f1.gold;
      const res = startConstruction(state, 'f1', 1, WALL_UPGRADE_ID);
      expect(res.ok).toBe(true);
      costs.push(before - state.factions.f1.gold);

      const turns = state.provinces[0].buildQueue!.turnsLeft;
      for (let i = 0; i < turns; i++) tickConstruction(state);
      expect(state.provinces[0].settlement.fortLevel).toBe(level + 1);
    }

    expect(costs[1]).toBeGreaterThan(costs[0]);
    expect(costs[2]).toBeGreaterThan(costs[1]);

    // al máximo (ciudadela): ya no aparece en buildableIn ni se puede iniciar de nuevo.
    expect(state.provinces[0].settlement.fortLevel).toBe(3);
    expect(buildableIn(state, 1).some(b => b.id === WALL_UPGRADE_ID)).toBe(false);
    expect(startConstruction(state, 'f1', 1, WALL_UPGRADE_ID).ok).toBe(false);
  });
});

// ---------- buildingEffects / buildingSlots ----------

describe('buildingEffects', () => {
  it('suma los effects de todos los edificios construidos en la provincia', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', buildings: ['granja', 'mercado', 'biblioteca'] });
    expect(buildingEffects(p1)).toEqual({
      taxFlat: 3, foodFlat: 2, manpowerFlat: 0, researchFlat: 2, legitimacyFlat: 0,
    });
  });

  it('ignora ids de edificio desconocidos sin romper', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', buildings: ['granja', 'esto_no_existe'] });
    expect(buildingEffects(p1).foodFlat).toBe(2);
  });
});

describe('buildingSlots', () => {
  it('es 2 + el nivel de asentamiento', () => {
    const aldea = makeProvince({ id: 1, ownerId: 'f1', settlement: { name: 'V', level: 1, fortLevel: 0 } });
    const capital = makeProvince({ id: 2, ownerId: 'f1', settlement: { name: 'C', level: 4, fortLevel: 2 } });
    expect(buildingSlots(aldea)).toBe(3);
    expect(buildingSlots(capital)).toBe(6);
  });
});

// ---------- religión ----------

describe('religion: convertProvince', () => {
  it('cambia la fe, cobra oro y sube legitimidad', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', religionId: 'viejos_pactos' });
    const f1 = makeFaction({ id: 'f1', gold: 500, religionId: 'aureismo', legitimacy: 60 });
    const state = baseState([p1], { f1 });

    expect(religionTension(state, 1)).toBe(true);
    const cost = convertCost(state, 1);

    const res = convertProvince(state, 'f1', 1);

    expect(res.ok).toBe(true);
    expect(state.provinces[0].religionId).toBe('aureismo');
    expect(state.factions.f1.gold).toBe(500 - cost);
    expect(state.factions.f1.legitimacy).toBe(62);
    expect(religionTension(state, 1)).toBe(false);
    expect(state.chronicle.length).toBe(1);
    expect(state.chronicle[0].kind).toBe('mundo');
  });

  it('con templo construido, el coste es la mitad (30 en vez de 60)', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', religionId: 'viejos_pactos', buildings: ['templo'] });
    const f1 = makeFaction({ id: 'f1', gold: 500, religionId: 'aureismo' });
    const state = baseState([p1], { f1 });

    expect(convertCost(state, 1)).toBe(30);
    const res = convertProvince(state, 'f1', 1);
    expect(res.ok).toBe(true);
    expect(state.factions.f1.gold).toBe(500 - 30);
  });

  it('rechaza sin oro suficiente y no cambia nada', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', religionId: 'viejos_pactos' });
    const f1 = makeFaction({ id: 'f1', gold: 5, religionId: 'aureismo' });
    const state = baseState([p1], { f1 });
    const res = convertProvince(state, 'f1', 1);
    expect(res.ok).toBe(false);
    expect(state.provinces[0].religionId).toBe('viejos_pactos');
    expect(state.factions.f1.gold).toBe(5);
  });

  it('rechaza convertir una provincia que ya profesa la fe propia', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1', religionId: 'aureismo' });
    const f1 = makeFaction({ id: 'f1', gold: 500, religionId: 'aureismo' });
    const state = baseState([p1], { f1 });
    const res = convertProvince(state, 'f1', 1);
    expect(res.ok).toBe(false);
    expect(state.factions.f1.gold).toBe(500);
  });

  it('rechaza convertir una provincia ajena', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f2', religionId: 'viejos_pactos' });
    const f1 = makeFaction({ id: 'f1', gold: 500, religionId: 'aureismo' });
    const f2 = makeFaction({ id: 'f2', religionId: 'viejos_pactos' });
    const state = baseState([p1], { f1, f2 });
    const res = convertProvince(state, 'f1', 1);
    expect(res.ok).toBe(false);
  });
});

// ---------- legitimacyTick ----------

describe('legitimacyTick', () => {
  it('suma legitimacyFlat de templo/corte con tope +3/turno', () => {
    const p1 = makeProvince({
      id: 1,
      ownerId: 'f1',
      settlement: { name: 'C', level: 4, fortLevel: 2 },
      buildings: ['templo', 'corte'], // 1 + 2 = 3, exactamente en el tope
    });
    const f1 = makeFaction({ id: 'f1', legitimacy: 50 });
    const state = baseState([p1], { f1 });
    expect(legitimacyTick(state, 'f1')).toBe(3);
  });

  it('no empuja la legitimidad de edificios más allá de 80', () => {
    const p1 = makeProvince({
      id: 1,
      ownerId: 'f1',
      settlement: { name: 'C', level: 4, fortLevel: 2 },
      buildings: ['templo', 'corte'],
    });
    const f1 = makeFaction({ id: 'f1', legitimacy: 79 });
    const state = baseState([p1], { f1 });
    expect(legitimacyTick(state, 'f1')).toBe(1);
  });

  it('es 0 sin edificios de legitimidad', () => {
    const p1 = makeProvince({ id: 1, ownerId: 'f1' });
    const f1 = makeFaction({ id: 'f1', legitimacy: 50 });
    const state = baseState([p1], { f1 });
    expect(legitimacyTick(state, 'f1')).toBe(0);
  });
});

// ---------- determinismo ----------

describe('determinismo', () => {
  it('la misma secuencia de acciones produce el mismo estado final (sin RNG involucrado)', () => {
    const run = (): GameState => {
      const p1 = makeProvince({
        id: 1, ownerId: 'f1', terrain: 'coast', iron: true, religionId: 'viejos_pactos',
      });
      const f1 = makeFaction({ id: 'f1', gold: 1000, religionId: 'aureismo' });
      const state = baseState([p1], { f1 });

      startConstruction(state, 'f1', 1, 'mina');
      tickConstruction(state);
      tickConstruction(state);
      tickConstruction(state);
      convertProvince(state, 'f1', 1);
      startConstruction(state, 'f1', 1, WALL_UPGRADE_ID);
      tickConstruction(state);
      tickConstruction(state);
      return state;
    };

    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
