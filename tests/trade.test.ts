/**
 * Tests de poder blando de Fase 3 (GDD §10 / §5.1, AGENTE U): comercio y
 * lujos, vasallaje, sobornos y agentes v1 (espionaje).
 *
 * Mismo patrón que tests/diplomacy.test.ts y tests/ai.test.ts: GameState
 * construido a mano (sin newGame, sin depender de contenido de otros
 * agentes), 100% determinista vía Rng(seed) explícito. Las semillas de
 * sabotageGarrison (6 = éxito, 1 = fallo para chance(0.6)) se verificaron
 * por fuerza bruta contra la implementación real de Rng (mulberry32).
 */
import { describe, expect, it } from 'vitest';
import { relKey } from '../src/core/types';
import { Rng } from '../src/core/state/rng';
import { runFactionAI } from '../src/core/ai/factionAI';
import {
  bribeBreakAlliance, bribeOpinion, bribeOpinionRequirement, breakTreaty, canDeclareWar,
  joinAlliesToWar, proposeVassalage, vassalageRequirement, vassalsOf,
} from '../src/core/systems/diplomacy';
import {
  luxuryLegitimacy, proposeTradeTreaty, tradeIncome, tradeRequirement, tributeFlows,
} from '../src/core/systems/trade';
import {
  sabotageGarrison, sabotageRequirement, scoutFaction, scoutRequirement,
} from '../src/core/systems/espionage';
import type {
  Army, Character, Faction, GameState, LuxuryId, Province, War,
} from '../src/core/types';

// ---------- constructor mínimo de GameState (mismo patrón que diplomacy.test.ts) ----------

function makeProvince(
  over: Partial<Province> & { id: number; ownerId: string | null; neighbors: number[] },
): Province {
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
    baseTax: over.baseTax ?? 100,
    baseFood: over.baseFood ?? 1,
    baseManpower: over.baseManpower ?? 1,
    garrison: over.garrison ?? 0,
    luxury: over.luxury ?? null,
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
    alive: over.alive ?? true,
    vassalOfId: over.vassalOfId ?? null,
  };
}

function makeCharacter(id: string, factionId: string): Character {
  return {
    id, name: `Gobernante ${id}`, factionId, role: 'ruler', age: 40,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [], alive: true,
  };
}

/** ejército de N unidades 'milicia' a plena dotación (~4.5 de armyStrength cada una, aurelios). */
function militiaArmy(id: string, factionId: string, provinceId: number, fullUnits: number): Army {
  const units: Army['units'] = [];
  for (let i = 0; i < fullUnits; i++) units.push({ typeId: 'milicia', men: 100, morale: 8, xp: 0 });
  return {
    id, name: `Hueste ${id}`, factionId, provinceId, units, generalId: null, movement: 2, movementMax: 2,
  };
}

function baseState(factions: Faction[], provinces: Province[], wars: War[] = []): GameState {
  const characters: Record<string, Character> = {};
  for (const f of factions) characters[f.rulerId] = makeCharacter(f.rulerId, f.id);
  const factionMap: Record<string, Faction> = {};
  for (const f of factions) factionMap[f.id] = f;
  return {
    version: 1,
    seed: 1,
    turn: 4, // año 2, primavera (seasonOf = 0: sin bonus de otoño, matemática limpia)
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

function setRelation(
  state: GameState, a: string, b: string, opinion: number, treaties: GameState['relations'][string]['treaties'] = [],
): void {
  state.relations[relKey(a, b)] = { opinion, treaties: [...treaties] };
}

// ============================================================================
// TRATADO COMERCIAL
// ============================================================================

describe('proposeTradeTreaty', () => {
  it('tradeRequirement bloquea por guerra, opinión < -10, o tratado ya existente', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const war: War = { id: 'w', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };

    const s1 = baseState([a, b], [], [war]);
    expect(tradeRequirement(s1, 'a', 'b')).not.toBeNull();
    expect(proposeTradeTreaty(s1, new Rng(1), 'a', 'b').ok).toBe(false);

    const s2 = baseState([a, b], []);
    setRelation(s2, 'a', 'b', -11);
    expect(tradeRequirement(s2, 'a', 'b')).not.toBeNull();

    const s3 = baseState([a, b], []);
    setRelation(s3, 'a', 'b', 50, ['trade']);
    expect(tradeRequirement(s3, 'a', 'b')).not.toBeNull();
  });

  it('con opinión >= 0 acepta (sin depender de frontera) y aplica los efectos completos', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated', dynastyName: 'Casa Mercante' });
    const b = makeFaction({ id: 'b', ai: 'ambitious', dynastyName: 'Casa Compradora' });
    const state = baseState([a, b], []); // sin provincias: sin frontera posible
    setRelation(state, 'a', 'b', 0);

    const result = proposeTradeTreaty(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual(['trade']);
    expect(rel.opinion).toBe(10);
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('economia');
    expect(entry.text).toContain('Casa Mercante');
    expect(entry.text).toContain('Casa Compradora');
  });

  it('con opinión negativa (pero >= -10) rechaza si NO comparte frontera', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated', dynastyName: 'Casa Lejana' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', -5);

    const result = proposeTradeTreaty(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(false);
    expect(state.relations[relKey('a', 'b')].treaties).toEqual([]);
    expect(state.relations[relKey('a', 'b')].opinion).toBe(-5); // declinar no penaliza
  });

  it('con opinión negativa (pero >= -10) acepta si SÍ comparte frontera', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const p1 = makeProvince({ id: 1, ownerId: 'a', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'b', neighbors: [1] });
    const state = baseState([a, b], [p1, p2]);
    setRelation(state, 'a', 'b', -5);

    const result = proposeTradeTreaty(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    expect(state.relations[relKey('a', 'b')].treaties).toContain('trade');
  });
});

// ============================================================================
// tradeIncome (PURA)
// ============================================================================

describe('tradeIncome', () => {
  it('+2 por tratado, +1 por cada lujo distinto que el socio tenga y yo no; ignora socios sin tratado o muertos', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const c = makeFaction({ id: 'c', ai: 'tribal' });
    const d = makeFaction({ id: 'd', ai: 'tribal' }); // sin tratado: no cuenta
    const dead = makeFaction({ id: 'dead', ai: 'tribal', alive: false }); // muerta: no cuenta

    const pa = makeProvince({ id: 1, ownerId: 'a', neighbors: [], luxury: 'sal' });
    const pb1 = makeProvince({ id: 2, ownerId: 'b', neighbors: [], luxury: 'sal' }); // compartido: no suma
    const pb2 = makeProvince({ id: 3, ownerId: 'b', neighbors: [], luxury: 'vino' }); // distinto: +1
    const pc = makeProvince({ id: 4, ownerId: 'c', neighbors: [], luxury: 'seda' }); // distinto: +1
    const pd = makeProvince({ id: 5, ownerId: 'd', neighbors: [], luxury: 'especias' });
    const pdead = makeProvince({ id: 6, ownerId: 'dead', neighbors: [], luxury: 'vino' });

    const state = baseState([a, b, c, d, dead], [pa, pb1, pb2, pc, pd, pdead]);
    setRelation(state, 'a', 'b', 0, ['trade']);
    setRelation(state, 'a', 'c', 0, ['trade']);
    setRelation(state, 'a', 'd', 0); // sin 'trade'
    setRelation(state, 'a', 'dead', 0, ['trade']); // 'trade' pero la facción está muerta

    const income = tradeIncome(state, 'a');

    // b: 2 (flat) + 1 (vino, que a no tiene) = 3. c: 2 + 1 (seda) = 3. Total 6.
    expect(income).toBe(6);
  });

  it('sin ningún tratado comercial, el ingreso es 0', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const state = baseState([a, b], []);
    expect(tradeIncome(state, 'a')).toBe(0);
  });

  it('es PURA: no muta el estado', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'ambitious' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 0, ['trade']);
    const before = JSON.stringify(state);
    tradeIncome(state, 'a');
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ============================================================================
// luxuryLegitimacy (PURA)
// ============================================================================

describe('luxuryLegitimacy', () => {
  function withLuxuries(luxuries: LuxuryId[]): GameState {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const provinces = luxuries.map((lux, i) => makeProvince({ id: i + 1, ownerId: 'a', neighbors: [], luxury: lux }));
    return baseState([a], provinces);
  }

  it('0 con ningún lujo o solo 1 distinto', () => {
    expect(luxuryLegitimacy(withLuxuries([]), 'a')).toBe(0);
    expect(luxuryLegitimacy(withLuxuries(['sal']), 'a')).toBe(0);
    expect(luxuryLegitimacy(withLuxuries(['sal', 'sal']), 'a')).toBe(0); // repetido: sigue siendo 1 distinto
  });

  it('+1 con exactamente 2 lujos distintos', () => {
    expect(luxuryLegitimacy(withLuxuries(['sal', 'seda']), 'a')).toBe(1);
  });

  it('+2 con 3 o 4 lujos distintos (tope: no sigue subiendo)', () => {
    expect(luxuryLegitimacy(withLuxuries(['sal', 'seda', 'especias']), 'a')).toBe(2);
    expect(luxuryLegitimacy(withLuxuries(['sal', 'seda', 'especias', 'vino']), 'a')).toBe(2);
  });
});

// ============================================================================
// tributeFlows (PURA)
// ============================================================================

describe('tributeFlows', () => {
  it('cobra 15% del taxIncome del vasallo al señor; ignora no-vasallos y pares con alguien muerto', () => {
    const lord = makeFaction({ id: 'lord', ai: 'consolidated' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const freeFaction = makeFaction({ id: 'libre', ai: 'ambitious' }); // no vasalla: sin flujo
    const deadLord = makeFaction({ id: 'muerto', ai: 'consolidated', alive: false });
    const orphan = makeFaction({ id: 'huerfano', ai: 'tribal', vassalOfId: 'muerto' }); // señor muerto: sin flujo
    const deadVassal = makeFaction({ id: 'vasallo_muerto', ai: 'tribal', alive: false, vassalOfId: 'lord' }); // vasallo muerto: sin flujo

    const pVassal = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [], baseTax: 100 });
    const pFree = makeProvince({ id: 2, ownerId: 'libre', neighbors: [], baseTax: 100 });
    const pOrphan = makeProvince({ id: 3, ownerId: 'huerfano', neighbors: [], baseTax: 100 });

    const state = baseState([lord, vassal, freeFaction, deadLord, orphan, deadVassal], [pVassal, pFree, pOrphan]);
    const goldBefore = { lord: lord.gold, vasallo: vassal.gold };

    const flows = tributeFlows(state);

    expect(flows).toEqual([{ from: 'vasallo', to: 'lord', gold: 15 }]); // 100 de baseTax * 0.15 = 15
    // PURA: no cobra de verdad, el integrador lo hace en turn.ts.
    expect(state.factions.lord.gold).toBe(goldBefore.lord);
    expect(state.factions.vasallo.gold).toBe(goldBefore.vasallo);
  });

  it('sin ningún vasallo, devuelve una lista vacía', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const state = baseState([a], []);
    expect(tributeFlows(state)).toEqual([]);
  });
});

// ============================================================================
// VASALLAJE
// ============================================================================

describe('vassalageRequirement / proposeVassalage', () => {
  it('vassalageRequirement bloquea autovasallaje, vasallaje duplicado, vasallaje ajeno, y señor que ya es vasallo', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const otherLordVassal = makeFaction({ id: 'v2', ai: 'tribal', vassalOfId: 'otro' });
    const vassalLord = makeFaction({ id: 'senor_vasallo', ai: 'consolidated', vassalOfId: 'lord' });
    const target = makeFaction({ id: 'objetivo', ai: 'tribal' });
    const state = baseState([lord, vassal, otherLordVassal, vassalLord, target], []);

    expect(vassalageRequirement(state, 'lord', 'lord')).not.toBeNull();
    expect(vassalageRequirement(state, 'lord', 'vasallo')).toContain('ya es vasalla vuestra');
    expect(vassalageRequirement(state, 'lord', 'v2')).toContain('ya es vasalla de otro señor');
    expect(vassalageRequirement(state, 'senor_vasallo', 'objetivo')).toContain('vasalla no puede exigir');
    expect(vassalageRequirement(state, 'lord', 'objetivo')).toBeNull();
  });

  it('acepta cuando el vasallo tiene <=2 provincias (aunque no haya guerra)', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious', dynastyName: 'Casa Fuerte' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', dynastyName: 'Casa Débil' });
    const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [] }); // única provincia
    const state = baseState([lord, vassal], [p1]);
    state.armies.army_lord = militiaArmy('army_lord', 'lord', 2, 3); // ~13.5 de fuerza; vasallo sin ejércitos: 0
    setRelation(state, 'lord', 'vasallo', 0);

    const result = proposeVassalage(state, new Rng(1), 'lord', 'vasallo');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('lord', 'vasallo')];
    expect(rel.treaties).toContain('vassalage');
    expect(rel.opinion).toBe(20);
    expect(state.factions.vasallo.vassalOfId).toBe('lord');
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('guerra');
    expect(entry.text).toContain('Casa Débil');
    expect(entry.text).toContain('Casa Fuerte');
    expect(entry.text).toContain('hincó la rodilla');
  });

  it('acepta cuando el vasallo va perdiendo la guerra contra el señor (warScore < -30 desde su perspectiva), aunque tenga más de 2 provincias', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal' });
    const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [] });
    const p2 = makeProvince({ id: 2, ownerId: 'vasallo', neighbors: [] });
    const p3 = makeProvince({ id: 3, ownerId: 'vasallo', neighbors: [] }); // 3 provincias: NO por pocas tierras
    const war: War = { id: 'w', attackerId: 'lord', defenderId: 'vasallo', cb: 'reclamo', warScore: 50, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const state = baseState([lord, vassal], [p1, p2, p3], [war]);
    state.armies.army_lord = militiaArmy('army_lord', 'lord', 4, 3); // vasallo sin ejércitos: 0 < 0.45x siempre

    const result = proposeVassalage(state, new Rng(1), 'lord', 'vasallo');

    expect(result.ok).toBe(true);
    expect(state.factions.vasallo.vassalOfId).toBe('lord');
    // la guerra entre señor y vasallo termina al jurar vasallaje.
    expect(state.wars).toHaveLength(0);
  });

  it('rechaza si el vasallo NO va suficientemente debilitado (fuerza >= 0.45x), sin importar provincias o guerra', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious', dynastyName: 'Casa Altiva' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', dynastyName: 'Casa Firme' });
    const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [] }); // 1 provincia (cumpliría "pocas tierras")
    const state = baseState([lord, vassal], [p1]);
    state.armies.army_lord = militiaArmy('army_lord', 'lord', 2, 3); // ~13.5
    state.armies.army_vasallo = militiaArmy('army_vasallo', 'vasallo', 1, 2); // ~9.0 (9/13.5 = 0.667 >= 0.45)

    const result = proposeVassalage(state, new Rng(1), 'lord', 'vasallo');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Casa Firme');
    expect(state.factions.vasallo.vassalOfId).toBeNull();
    expect(state.relations[relKey('lord', 'vasallo')]?.treaties ?? []).not.toContain('vassalage');
  });

  it('rechaza si está debilitado pero NI en guerra perdida NI con pocas provincias', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal' });
    const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [] });
    const p2 = makeProvince({ id: 2, ownerId: 'vasallo', neighbors: [] });
    const p3 = makeProvince({ id: 3, ownerId: 'vasallo', neighbors: [] }); // 3 provincias
    const state = baseState([lord, vassal], [p1, p2, p3]); // sin guerra
    state.armies.army_lord = militiaArmy('army_lord', 'lord', 1, 5); // fuerte; vasallo sin ejércitos (0, overwhelmed=true)

    const result = proposeVassalage(state, new Rng(1), 'lord', 'vasallo');

    expect(result.ok).toBe(false);
    expect(state.factions.vasallo.vassalOfId).toBeNull();
  });
});

// ============================================================================
// canDeclareWar veta vasallos
// ============================================================================

describe('canDeclareWar veta vasallos (Fase 3, AGENTE U)', () => {
  it('un vasallo no puede declarar la guerra por su cuenta', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const target = makeFaction({ id: 'objetivo', ai: 'consolidated' });
    const state = baseState([lord, vassal, target], []);

    const res = canDeclareWar(state, 'vasallo', 'objetivo');

    expect(res.ok).toBe(false);
    expect(res.reason).toContain('vasalla');
  });

  it('nadie puede declarar la guerra directamente a un vasallo: hay que declarársela a su señor', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious', dynastyName: 'Casa Señora' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const attacker = makeFaction({ id: 'atacante', ai: 'consolidated' });
    const state = baseState([lord, vassal, attacker], []);

    const res = canDeclareWar(state, 'atacante', 'vasallo');

    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Casa Señora');
  });

  it('sigue permitiendo declarar la guerra al señor mismo, y a facciones sin vínculo de vasallaje', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const attacker = makeFaction({ id: 'atacante', ai: 'consolidated' });
    const state = baseState([lord, vassal, attacker], []);

    expect(canDeclareWar(state, 'atacante', 'lord').ok).toBe(true);
  });
});

// ============================================================================
// breakTreaty limpia vassalOfId al romper 'vassalage'
// ============================================================================

describe('breakTreaty y vasallaje', () => {
  it('cuando el SEÑOR rompe el vínculo, libera al vasallo (vassalOfId a null)', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const state = baseState([lord, vassal], []);
    setRelation(state, 'lord', 'vasallo', 50, ['vassalage']);

    const result = breakTreaty(state, 'lord', 'vasallo', 'vassalage');

    expect(result.ok).toBe(true);
    expect(state.factions.vasallo.vassalOfId).toBeNull();
    expect(state.relations[relKey('lord', 'vasallo')].treaties).toEqual([]);
  });

  it('cuando el VASALLO rompe el vínculo (se rebela), también queda libre', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const state = baseState([lord, vassal], []);
    setRelation(state, 'lord', 'vasallo', 50, ['vassalage']);

    const result = breakTreaty(state, 'vasallo', 'lord', 'vassalage');

    expect(result.ok).toBe(true);
    expect(state.factions.vasallo.vassalOfId).toBeNull();
  });

  it('tras liberarse, el ex-vasallo puede declarar la guerra de nuevo', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const state = baseState([lord, vassal], []);
    setRelation(state, 'lord', 'vasallo', 50, ['vassalage']);
    expect(canDeclareWar(state, 'vasallo', 'lord').ok).toBe(false);

    breakTreaty(state, 'lord', 'vasallo', 'vassalage');

    expect(canDeclareWar(state, 'vasallo', 'lord').ok).toBe(true);
  });
});

// ============================================================================
// vassalsOf / joinAlliesToWar arrastra vasallos a la guerra
// ============================================================================

describe('vassalsOf / joinAlliesToWar arrastra vasallos', () => {
  it('vassalsOf devuelve solo vasallos VIVOS de la facción', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const v1 = makeFaction({ id: 'v1', ai: 'tribal', vassalOfId: 'lord' });
    const v2dead = makeFaction({ id: 'v2', ai: 'tribal', vassalOfId: 'lord', alive: false });
    const notVassal = makeFaction({ id: 'libre', ai: 'consolidated' });
    const state = baseState([lord, v1, v2dead, notVassal], []);

    expect(vassalsOf(state, 'lord')).toEqual(['v1']);
    expect(vassalsOf(state, 'libre')).toEqual([]);
  });

  it('arrastra al vasallo del defensor a una guerra espejo contra el atacante, con opinión -30 y crónica', () => {
    const attacker = makeFaction({ id: 'atk', ai: 'ambitious', dynastyName: 'Casa Atacante' });
    const defender = makeFaction({ id: 'def', ai: 'consolidated', dynastyName: 'Casa Defendida' });
    const vassal = makeFaction({ id: 'vas', ai: 'tribal', dynastyName: 'Casa Vasalla', vassalOfId: 'def' });
    const state = baseState([attacker, defender, vassal], []);
    setRelation(state, 'atk', 'vas', 0);

    const war: War = { id: 'w0', attackerId: 'atk', defenderId: 'def', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn };
    state.wars.push(war);
    const chronicleBefore = state.chronicle.length;

    const messages = joinAlliesToWar(state, war);

    expect(messages).toHaveLength(1);
    expect(state.wars).toHaveLength(2);
    const mirror = state.wars.find((w) => w.id !== war.id)!;
    expect(mirror.attackerId).toBe('atk');
    expect(mirror.defenderId).toBe('vas');
    expect(state.relations[relKey('atk', 'vas')].opinion).toBe(-30);
    expect(state.chronicle.length).toBe(chronicleBefore + 1);
    expect(state.chronicle.at(-1)!.text).toContain('Casa Vasalla');
    expect(state.chronicle.at(-1)!.text).toContain('Casa Defendida');
  });

  it('no duplica la guerra si el vasallo ya está en guerra con el atacante', () => {
    const attacker = makeFaction({ id: 'atk', ai: 'ambitious' });
    const defender = makeFaction({ id: 'def', ai: 'consolidated' });
    const vassal = makeFaction({ id: 'vas', ai: 'tribal', vassalOfId: 'def' });
    const preexisting: War = { id: 'w_pre', attackerId: 'atk', defenderId: 'vas', cb: 'sin_causa', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const state = baseState([attacker, defender, vassal], [], [preexisting]);

    const war: War = { id: 'w0', attackerId: 'atk', defenderId: 'def', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn };
    state.wars.push(war);

    const messages = joinAlliesToWar(state, war);

    expect(messages).toHaveLength(0);
    expect(state.wars).toHaveLength(2); // la preexistente + war, ninguna nueva
  });
});

// ============================================================================
// SOBORNO
// ============================================================================

describe('bribeOpinion', () => {
  it('bribeOpinionRequirement bloquea autosoborno y oro insuficiente', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious', gold: 10 });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);

    expect(bribeOpinionRequirement(state, 'a', 'a')).not.toBeNull();
    expect(bribeOpinionRequirement(state, 'a', 'b')).toContain('oro');
    expect(bribeOpinion(state, new Rng(1), 'a', 'b').ok).toBe(false);
  });

  it('sube la opinión +15 y cobra 50 de oro, sin narrar crónica (es un soborno, no un acto público)', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious', dynastyName: 'Casa Sobornadora', gold: 1000 });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Cortesana' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 0);
    const chronicleBefore = state.chronicle.length;

    const result = bribeOpinion(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    expect(state.factions.a.gold).toBe(950);
    expect(state.relations[relKey('a', 'b')].opinion).toBe(15);
    expect(state.chronicle.length).toBe(chronicleBefore);
  });
});

describe('bribeBreakAlliance', () => {
  it('exige tres casas distintas, alianza existente entre target/third, y oro suficiente', () => {
    const briber = makeFaction({ id: 'briber', ai: 'ambitious', gold: 1000 });
    const target = makeFaction({ id: 'target', ai: 'consolidated' });
    const third = makeFaction({ id: 'third', ai: 'tribal' });

    const s1 = baseState([briber, target, third], []);
    expect(bribeBreakAlliance(s1, new Rng(1), 'briber', 'briber', 'third').ok).toBe(false);

    const s2 = baseState([briber, target, third], []); // sin alianza target-third
    expect(bribeBreakAlliance(s2, new Rng(1), 'briber', 'target', 'third').ok).toBe(false);

    const s3 = baseState([briber, target, third], []);
    setRelation(s3, 'target', 'third', 10, ['alliance']);
    briber.gold = 10; // insuficiente
    expect(bribeBreakAlliance(s3, new Rng(1), 'briber', 'target', 'third').ok).toBe(false);
  });

  it('rechaza sin coste si target valora demasiado su alianza con third (opinión >= 20)', () => {
    const briber = makeFaction({ id: 'briber', ai: 'ambitious', gold: 1000 });
    const target = makeFaction({ id: 'target', ai: 'consolidated', dynastyName: 'Casa Leal' });
    const third = makeFaction({ id: 'third', ai: 'tribal', dynastyName: 'Casa Aliada' });
    const state = baseState([briber, target, third], []);
    setRelation(state, 'target', 'third', 20, ['alliance']);

    const result = bribeBreakAlliance(state, new Rng(1), 'briber', 'target', 'third');

    expect(result.ok).toBe(false);
    expect(state.factions.briber.gold).toBe(1000); // no se cobra si rechaza
    expect(state.relations[relKey('target', 'third')].treaties).toContain('alliance');
  });

  it('acepta si target no valora tanto la alianza (opinión < 20): cobra 120 y rompe la alianza target-third', () => {
    const briber = makeFaction({ id: 'briber', ai: 'ambitious', dynastyName: 'Casa Corruptora', gold: 1000 });
    const target = makeFaction({ id: 'target', ai: 'consolidated', dynastyName: 'Casa Comprada', legitimacy: 60 });
    const third = makeFaction({ id: 'third', ai: 'tribal', dynastyName: 'Casa Traicionada' });
    const state = baseState([briber, target, third], []);
    setRelation(state, 'target', 'third', 15, ['alliance']);

    const result = bribeBreakAlliance(state, new Rng(1), 'briber', 'target', 'third');

    expect(result.ok).toBe(true);
    expect(state.factions.briber.gold).toBe(880); // 1000 - 120
    const rel = state.relations[relKey('target', 'third')];
    expect(rel.treaties).toEqual([]); // breakTreaty ya la quitó
    expect(rel.opinion).toBe(-15); // 15 - 30 (coste estándar de breakTreaty)
    expect(state.factions.target.legitimacy).toBe(50); // 60 - 10 (coste estándar de breakTreaty)
    expect(result.message).toContain('Casa Corruptora');
    expect(result.message).toContain('Casa Comprada');
    // breakTreaty ya narró la crónica de la ruptura: no se duplica.
    expect(state.chronicle.at(-1)!.text).toContain('Casa Comprada');
  });
});

// ============================================================================
// ESPIONAJE: sabotageGarrison
// ============================================================================

describe('sabotageGarrison', () => {
  it('sabotageRequirement bloquea provincia sin señor, propia provincia, y oro insuficiente', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal', gold: 1000 });
    const neutral = makeProvince({ id: 1, ownerId: null, neighbors: [] });
    const mine = makeProvince({ id: 2, ownerId: 'a', neighbors: [] });
    const enemy = makeProvince({ id: 3, ownerId: 'b', neighbors: [], garrison: 100 });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const state = baseState([a, b], [neutral, mine, enemy]);

    expect(sabotageRequirement(state, 'a', 1)).toContain('señor');
    expect(sabotageRequirement(state, 'a', 2)).toContain('propia');
    state.factions.a.gold = 10;
    expect(sabotageRequirement(state, 'a', 3)).toContain('oro');
  });

  it('semilla determinista de ÉXITO (6): reduce la guarnición 40%, cobra 80 de oro, sin penalización de opinión ni crónica', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal', dynastyName: 'Casa Saboteadora', gold: 1000 });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const target = makeProvince({ id: 1, ownerId: 'b', neighbors: [], garrison: 100 });
    const state = baseState([a, b], [target]);
    const chronicleBefore = state.chronicle.length;

    const result = sabotageGarrison(state, new Rng(6), 'a', 1);

    expect(result.ok).toBe(true);
    expect(state.factions.a.gold).toBe(920); // 1000 - 80
    expect(state.provinces[0].garrison).toBe(60); // 100 - floor(100*0.4)
    expect(state.relations[relKey('a', 'b')]?.opinion ?? 0).toBe(0);
    expect(state.chronicle.length).toBe(chronicleBefore);
  });

  it('semilla determinista de FALLO (1): NO reduce la guarnición, pero SÍ cobra el oro, penaliza opinión -25 y narra el escándalo', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal', dynastyName: 'Casa Descubierta', gold: 1000 });
    const b = makeFaction({ id: 'b', ai: 'consolidated', dynastyName: 'Casa Ultrajada' });
    const target = makeProvince({ id: 1, ownerId: 'b', neighbors: [], garrison: 100 });
    const state = baseState([a, b], [target]);
    const chronicleBefore = state.chronicle.length;

    const result = sabotageGarrison(state, new Rng(1), 'a', 1);

    expect(result.ok).toBe(false);
    expect(state.factions.a.gold).toBe(920); // el oro se paga aunque falle
    expect(state.provinces[0].garrison).toBe(100); // intacta
    expect(state.relations[relKey('a', 'b')].opinion).toBe(-25);
    expect(state.chronicle.length).toBe(chronicleBefore + 1);
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('mundo');
    expect(entry.text).toContain('Casa Descubierta');
    expect(entry.text).toContain('Casa Ultrajada');
  });
});

// ============================================================================
// ESPIONAJE: scoutFaction
// ============================================================================

describe('scoutFaction', () => {
  it('scoutRequirement bloquea autoespionaje y oro insuficiente', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious', gold: 10 });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);

    expect(scoutRequirement(state, 'a', 'a')).not.toBeNull();
    expect(scoutRequirement(state, 'a', 'b')).toContain('oro');
  });

  it('devuelve en el mensaje un informe real (oro, ejércitos totales, fuerza) y cobra 40 de oro', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious', gold: 1000 });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Vigilada', gold: 250 });
    const state = baseState([a, b], []);
    state.armies.e1 = militiaArmy('e1', 'b', 1, 1); // ~4.5
    state.armies.e2 = militiaArmy('e2', 'b', 1, 1); // ~4.5 más → total ~9.0

    const result = scoutFaction(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    expect(state.factions.a.gold).toBe(960); // 1000 - 40
    expect(result.message).toContain('Casa Vigilada');
    expect(result.message).toContain('250'); // oro real del objetivo
    expect(result.message).toContain('2 ejército'); // ejércitos totales reales
    expect(result.message).toContain('9'); // fuerza militar total real (redondeada)
  });
});

// ============================================================================
// DETERMINISMO
// ============================================================================

describe('determinismo', () => {
  it('una secuencia de comercio + soborno + sabotaje + espionaje produce el mismo estado final en dos corridas', () => {
    function run(): GameState {
      const a = makeFaction({ id: 'a', ai: 'ambitious' });
      const b = makeFaction({ id: 'b', ai: 'consolidated' });
      const c = makeFaction({ id: 'c', ai: 'tribal' });
      const p1 = makeProvince({ id: 1, ownerId: 'a', neighbors: [2, 3] });
      const p2 = makeProvince({ id: 2, ownerId: 'b', neighbors: [1], garrison: 100 });
      const p3 = makeProvince({ id: 3, ownerId: 'c', neighbors: [1] });
      const state = baseState([a, b, c], [p1, p2, p3]);
      setRelation(state, 'a', 'b', 5);
      setRelation(state, 'a', 'c', 0);
      const rng = new Rng(42);
      proposeTradeTreaty(state, rng, 'a', 'b');
      bribeOpinion(state, rng, 'a', 'c');
      sabotageGarrison(state, rng, 'a', 2);
      scoutFaction(state, rng, 'a', 'b');
      return state;
    }
    const s1 = run();
    const s2 = run();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it('proposeVassalage es determinista de punta a punta (sin depender de la semilla, es puro umbral)', () => {
    function run(seed: number): GameState {
      const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
      const vassal = makeFaction({ id: 'vasallo', ai: 'tribal' });
      const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [] });
      const state = baseState([lord, vassal], [p1]);
      state.armies.army_lord = militiaArmy('army_lord', 'lord', 2, 3);
      proposeVassalage(state, new Rng(seed), 'lord', 'vasallo');
      return state;
    }
    expect(JSON.stringify(run(1))).toBe(JSON.stringify(run(999)));
  });
});

// ============================================================================
// factionAI usa las nuevas ramas de poder blando (GDD §10 Fase 3, AGENTE U)
// ============================================================================

describe('runFactionAI — la IA usa comercio/vasallaje/sabotaje (AGENTE U)', () => {
  it('consolidated (o cultura sarradio) propone tratado comercial a un vecino no hostil al menos una vez entre varias semillas (30%)', () => {
    let traded = false;
    for (let seed = 1; seed <= 80 && !traded; seed++) {
      const a = makeFaction({ id: 'a', ai: 'consolidated' });
      const b = makeFaction({ id: 'b', ai: 'ambitious' });
      const p1 = makeProvince({ id: 1, ownerId: 'a', neighbors: [2] });
      const p2 = makeProvince({ id: 2, ownerId: 'b', neighbors: [1] });
      const state = baseState([a, b], [p1, p2]);
      setRelation(state, 'a', 'b', 5); // >= 0, no dispara matrimonio (requiere 10) ni alianza (requiere 25)

      runFactionAI(state, new Rng(seed), 'a');

      if (state.relations[relKey('a', 'b')].treaties.includes('trade')) traded = true;
    }
    expect(traded).toBe(true);
  });

  it('un señor fuerte exige vasallaje a un vecino aplastado al menos una vez entre varias semillas (20%)', () => {
    let vassalized = false;
    for (let seed = 1; seed <= 150 && !vassalized; seed++) {
      const strong = makeFaction({ id: 'fuerte', ai: 'ambitious' });
      const weak = makeFaction({ id: 'debil', ai: 'consolidated' });
      const p1 = makeProvince({ id: 1, ownerId: 'fuerte', neighbors: [2] });
      const p2 = makeProvince({ id: 2, ownerId: 'debil', neighbors: [1] }); // única provincia: cumple "pocas tierras"
      const state = baseState([strong, weak], [p1, p2]);
      state.armies.army_fuerte = militiaArmy('army_fuerte', 'fuerte', 1, 5); // ~22.5; débil sin ejércitos: 0
      setRelation(state, 'fuerte', 'debil', 0);

      runFactionAI(state, new Rng(seed), 'fuerte');

      if (state.factions.debil.vassalOfId === 'fuerte') vassalized = true;
    }
    expect(vassalized).toBe(true);
  });

  it('tribal con tesoro de sobra (>200 oro) intenta sabotaje contra un vecino fronterizo al menos una vez entre varias semillas (15%)', () => {
    let attempted = false;
    for (let seed = 1; seed <= 150 && !attempted; seed++) {
      const tribal = makeFaction({ id: 'tribu', ai: 'tribal', gold: 1000 });
      const neighbor = makeFaction({ id: 'vecino', ai: 'consolidated' });
      const p1 = makeProvince({ id: 1, ownerId: 'tribu', neighbors: [2] });
      const p2 = makeProvince({ id: 2, ownerId: 'vecino', neighbors: [1], garrison: 100 });
      const state = baseState([tribal, neighbor], [p1, p2]);
      setRelation(state, 'tribu', 'vecino', 0);

      runFactionAI(state, new Rng(seed), 'tribu');

      // única acción posible en este escenario (fuerza 0 en ambos bandos anula
      // las demás ramas): si gastó oro, fue el sabotaje (éxito o descubierto).
      if (state.factions.tribu.gold < 1000) attempted = true;
    }
    expect(attempted).toBe(true);
  });

  it('nunca deja que un vasallo declare la guerra por su cuenta (canDeclareWar ya lo veta; aquí se confirma en el flujo completo de la IA)', () => {
    const lord = makeFaction({ id: 'lord', ai: 'ambitious' });
    const vassal = makeFaction({ id: 'vasallo', ai: 'tribal', vassalOfId: 'lord' });
    const prey = makeFaction({ id: 'presa', ai: 'consolidated' });
    const p1 = makeProvince({ id: 1, ownerId: 'vasallo', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'presa', neighbors: [1] });
    const state = baseState([lord, vassal, prey], [p1, p2]);
    state.armies.army_vasallo = militiaArmy('army_vasallo', 'vasallo', 1, 8); // ventaja aplastante

    for (let seed = 1; seed <= 20; seed++) {
      runFactionAI(state, new Rng(seed), 'vasallo');
    }

    expect(state.wars).toHaveLength(0);
  });
});
