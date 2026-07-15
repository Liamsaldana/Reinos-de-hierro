/**
 * Tests de diplomacia profunda (GDD §10 v1+, AGENTE R): matrimonios con
 * herencia simple, alianzas defensivas que arrastran a la guerra, pactos de
 * no agresión, y que la IA de facción realmente los use.
 *
 * Mismo patrón que tests/ai.test.ts y tests/combat.test.ts: GameState
 * construido a mano (sin newGame, sin depender de contenido de otros
 * agentes), 100% determinista vía Rng(seed) explícito. Las semillas de las
 * pruebas de "opinión negativa" (7 = acepta, 1 = rechaza para chance(0.2))
 * se buscaron por fuerza bruta contra la implementación real de Rng
 * (mulberry32) y quedan documentadas en el comentario de cada test.
 */
import { describe, expect, it } from 'vitest';
import { relKey } from '../src/core/types';
import { Rng } from '../src/core/state/rng';
import { runFactionAI } from '../src/core/ai/factionAI';
import {
  alliesOf, allianceRequirement, breakTreaty, canDeclareWar, formAlliance,
  joinAlliesToWar, marriageHeirFaction, marriageRequirement, nonAggressionRequirement,
  proposeMarriage, signNonAggression, transferRealm,
} from '../src/core/systems/diplomacy';
import type {
  Character, Faction, GameState, Province, TreatyType, War,
} from '../src/core/types';

// ---------- constructor mínimo de GameState (mismo patrón que ai.test.ts) ----------

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
    alive: over.alive ?? true,
  };
}

function makeCharacter(id: string, factionId: string): Character {
  return {
    id, name: `Gobernante ${id}`, factionId, role: 'ruler', age: 40,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [], alive: true,
  };
}

/** ejército de N unidades 'milicia' a plena dotación (misma convención que tests/ai.test.ts). */
function militiaArmy(id: string, factionId: string, provinceId: number, fullUnits: number) {
  const units = [];
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

function setRelation(state: GameState, a: string, b: string, opinion: number, treaties: TreatyType[] = []): void {
  state.relations[relKey(a, b)] = { opinion, treaties: [...treaties] };
}

// ============================================================================
// MATRIMONIO
// ============================================================================

describe('proposeMarriage', () => {
  it('bloquea por precondición: en guerra, opinión < -20, o lazo ya existente', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const war: War = { id: 'w', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };

    const s1 = baseState([a, b], [], [war]);
    setRelation(s1, 'a', 'b', 50);
    expect(marriageRequirement(s1, 'a', 'b')).not.toBeNull();
    expect(proposeMarriage(s1, new Rng(1), 'a', 'b').ok).toBe(false);

    const s2 = baseState([a, b], []);
    setRelation(s2, 'a', 'b', -21);
    expect(marriageRequirement(s2, 'a', 'b')).not.toBeNull();
    expect(proposeMarriage(s2, new Rng(1), 'a', 'b').ok).toBe(false);

    const s3 = baseState([a, b], []);
    setRelation(s3, 'a', 'b', 50, ['marriage_tie']);
    expect(marriageRequirement(s3, 'a', 'b')).not.toBeNull();
    expect(proposeMarriage(s3, new Rng(1), 'a', 'b').ok).toBe(false);
  });

  it('con opinión >= 0 acepta siempre (sin depender del Rng) y aplica los efectos completos', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious', dynastyName: 'Casa Varga' });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Haraldsen' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 10);

    // semilla "mala" (rechazaría un chance() si se llamara): confirma que la
    // rama opinion>=0 ni siquiera consulta el Rng.
    const result = proposeMarriage(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual(['marriage_tie']);
    expect(rel.opinion).toBe(35); // 10 + 25
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('dinastia');
    expect(entry.text).toContain('Casa Varga');
    expect(entry.text).toContain('Casa Haraldsen');

    // "ambas direcciones son la misma relación": se ve igual desde cualquier orden.
    expect(state.relations[relKey('b', 'a')]).toBe(rel);
  });

  it('con opinión negativa, semilla 7 acepta (chance(0.2) < 0.2 en la primera tirada)', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', -20); // chance = 0.3 + (-20/200) = 0.2

    const result = proposeMarriage(state, new Rng(7), 'a', 'b');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toContain('marriage_tie');
    expect(rel.opinion).toBe(5); // -20 + 25
  });

  it('con opinión negativa, semilla 1 rechaza (chance(0.2) >= 0.2 en la primera tirada)', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Rechazo' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', -20);
    const chronicleBefore = state.chronicle.length;

    const result = proposeMarriage(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Casa Rechazo');
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual([]);
    expect(rel.opinion).toBe(-25); // -20 - 5
    expect(state.chronicle.length).toBe(chronicleBefore); // el rechazo no narra crónica
  });
});

// ============================================================================
// ALIANZA — "exige opinión/lazo"
// ============================================================================

describe('formAlliance', () => {
  it('allianceRequirement exige opinión >= 20 o lazo de sangre (precondición dura)', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });

    const s1 = baseState([a, b], []);
    setRelation(s1, 'a', 'b', 10);
    expect(allianceRequirement(s1, 'a', 'b')).not.toBeNull();
    const r1 = formAlliance(s1, new Rng(1), 'a', 'b');
    expect(r1.ok).toBe(false);
    expect(s1.relations[relKey('a', 'b')].opinion).toBe(10); // sin penalización por no cumplir precondición

    const s2 = baseState([a, b], []);
    setRelation(s2, 'a', 'b', 5, ['marriage_tie']);
    expect(allianceRequirement(s2, 'a', 'b')).toBeNull(); // el lazo basta para la precondición
  });

  it('con precondición cumplida pero opinión < 25 (sin lazo, sin amenaza común) la IA declina sin penalizar opinión', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Cautelosa' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 20); // pasa la precondición (>=20) pero no el umbral de aceptación (25)

    const result = formAlliance(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Casa Cautelosa');
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual([]);
    expect(rel.opinion).toBe(20); // declinar una alianza no cuesta opinión (a diferencia del matrimonio)
  });

  it('acepta con opinión >= 25 y aplica los efectos completos', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated', dynastyName: 'Casa Temük' });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Haraldsen' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 25);

    const result = formAlliance(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual(['alliance']);
    expect(rel.opinion).toBe(40); // 25 + 15
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('guerra');
    expect(entry.text).toContain('Casa Temük');
    expect(entry.text).toContain('Casa Haraldsen');
  });

  it('acepta con lazo de sangre y opinión >= 10 aunque no llegue a 25', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 10, ['marriage_tie']);

    const result = formAlliance(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    expect(state.relations[relKey('a', 'b')].treaties).toContain('alliance');
  });

  it('acepta por amenaza común aunque la opinión no llegue a 25 y no haya lazo', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const c = makeFaction({ id: 'c', ai: 'ambitious' }); // la amenaza común
    const warAC: War = { id: 'w1', attackerId: 'c', defenderId: 'a', cb: 'sin_causa', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const warBC: War = { id: 'w2', attackerId: 'c', defenderId: 'b', cb: 'sin_causa', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const state = baseState([a, b, c], [], [warAC, warBC]);
    setRelation(state, 'a', 'b', 20); // pasa precondición, no pasa el umbral 25 por sí solo

    const result = formAlliance(state, new Rng(1), 'a', 'b');

    expect(result.ok).toBe(true);
    expect(state.relations[relKey('a', 'b')].treaties).toContain('alliance');
  });
});

// ============================================================================
// NO AGRESIÓN
// ============================================================================

describe('signNonAggression', () => {
  it('rechaza solo con opinión < -40; en el resto de casos acepta y trae tregua implícita', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal', dynastyName: 'Casa Hostil' });

    const s1 = baseState([a, b], []);
    setRelation(s1, 'a', 'b', -41);
    const rejected = signNonAggression(s1, new Rng(1), 'a', 'b');
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('Casa Hostil');
    expect(s1.relations[relKey('a', 'b')].treaties).toEqual([]);

    const s2 = baseState([a, b], []);
    setRelation(s2, 'a', 'b', -30);
    const accepted = signNonAggression(s2, new Rng(1), 'a', 'b');
    expect(accepted.ok).toBe(true);
    const rel = s2.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual(['non_aggression']);
    expect(rel.opinion).toBe(-22); // -30 + 8
    expect(rel.truceUntilTurn).toBe(s2.turn + 12);
  });

  it('bloquea por precondición si ya están en guerra o si ya hay un pacto vigente', () => {
    const a = makeFaction({ id: 'a', ai: 'consolidated' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const war: War = { id: 'w', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };

    const s1 = baseState([a, b], [], [war]);
    expect(nonAggressionRequirement(s1, 'a', 'b')).not.toBeNull();

    const s2 = baseState([a, b], []);
    setRelation(s2, 'a', 'b', 0, ['non_aggression']);
    expect(nonAggressionRequirement(s2, 'a', 'b')).not.toBeNull();
  });
});

// ============================================================================
// ROMPER TRATADO
// ============================================================================

describe('breakTreaty', () => {
  it('quita el tratado, penaliza opinión -30 y legitimidad -10 SOLO de quien rompe, y narra crónica', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal', dynastyName: 'Casa Rota', legitimacy: 60 });
    const b = makeFaction({ id: 'b', ai: 'consolidated', legitimacy: 60 });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 50, ['alliance']);

    const result = breakTreaty(state, 'a', 'b', 'alliance');

    expect(result.ok).toBe(true);
    const rel = state.relations[relKey('a', 'b')];
    expect(rel.treaties).toEqual([]);
    expect(rel.opinion).toBe(20); // 50 - 30
    expect(state.factions.a.legitimacy).toBe(50); // 60 - 10, quien rompe
    expect(state.factions.b.legitimacy).toBe(60); // intacta
    const entry = state.chronicle.at(-1)!;
    expect(entry.kind).toBe('guerra');
    expect(entry.text).toContain('Casa Rota');
  });

  it('falla sin mutar nada si ese tratado no existe entre ambas casas', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal', legitimacy: 60 });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 50, ['marriage_tie']);
    const chronicleBefore = state.chronicle.length;

    const result = breakTreaty(state, 'a', 'b', 'alliance');

    expect(result.ok).toBe(false);
    expect(state.relations[relKey('a', 'b')].treaties).toEqual(['marriage_tie']);
    expect(state.factions.a.legitimacy).toBe(60);
    expect(state.chronicle.length).toBe(chronicleBefore);
  });

  it('al romper un pacto de no agresión, también limpia la tregua implícita que trajo', () => {
    const a = makeFaction({ id: 'a', ai: 'tribal' });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 0);
    signNonAggression(state, new Rng(1), 'a', 'b'); // crea el pacto + tregua

    expect(state.relations[relKey('a', 'b')].truceUntilTurn).toBeDefined();
    breakTreaty(state, 'a', 'b', 'non_aggression');

    expect(state.relations[relKey('a', 'b')].truceUntilTurn).toBeUndefined();
  });
});

// ============================================================================
// canDeclareWar — "bloquea con pacto/tregua"
// ============================================================================

describe('canDeclareWar', () => {
  it('permite declarar la guerra cuando no hay guerra, tregua ni pacto', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    expect(canDeclareWar(state, 'a', 'b').ok).toBe(true);
  });

  it('bloquea si ya hay guerra activa', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const war: War = { id: 'w', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const state = baseState([a, b], [], [war]);
    const res = canDeclareWar(state, 'a', 'b');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('guerra');
  });

  it('bloquea si hay una tregua vigente', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 0);
    state.relations[relKey('a', 'b')].truceUntilTurn = state.turn + 5;
    const res = canDeclareWar(state, 'a', 'b');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('tregua');
  });

  it('bloquea si hay un pacto de no agresión sin tregua asociada (mensaje específico del pacto)', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    // pacto sin tregua explícita (a mano, para aislar este branch del de "tregua vigente"
    // — en la práctica signNonAggression siempre trae ambos a la vez, ver test siguiente).
    setRelation(state, 'a', 'b', 0, ['non_aggression']);

    const res = canDeclareWar(state, 'a', 'b');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('no agresión');
  });

  it('signNonAggression bloquea canDeclareWar (por su tregua implícita), y romper el pacto desbloquea de verdad', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 0);
    signNonAggression(state, new Rng(1), 'a', 'b');

    expect(canDeclareWar(state, 'a', 'b').ok).toBe(false);

    breakTreaty(state, 'a', 'b', 'non_aggression');
    expect(canDeclareWar(state, 'a', 'b').ok).toBe(true); // "romperlo primero" desbloquea de verdad
  });
});

// ============================================================================
// ALIANZAS Y ARRASTRE A LA GUERRA
// ============================================================================

describe('alliesOf / joinAlliesToWar', () => {
  it('alliesOf devuelve solo facciones vivas con alianza activa, nunca a sí misma', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const c = makeFaction({ id: 'c', ai: 'tribal' });
    const d = makeFaction({ id: 'd', ai: 'tribal', alive: false });
    const state = baseState([a, b, c, d], []);
    setRelation(state, 'b', 'c', 50, ['alliance']);
    setRelation(state, 'b', 'd', 50, ['alliance']); // aliada pero muerta: no cuenta
    setRelation(state, 'a', 'b', 50); // sin alianza

    expect(alliesOf(state, 'b')).toEqual(['c']);
    expect(alliesOf(state, 'a')).toEqual([]);
  });

  it('crea una guerra espejo por cada aliado defensivo del defensor, con penalización de opinión y crónica', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' }); // atacante original
    const b = makeFaction({ id: 'b', ai: 'consolidated', dynastyName: 'Casa Defendida' }); // defensor original
    const c = makeFaction({ id: 'c', ai: 'tribal', dynastyName: 'Casa Aliada' }); // aliado del defensor
    const state = baseState([a, b, c], []);
    setRelation(state, 'b', 'c', 50, ['alliance']);
    setRelation(state, 'a', 'c', 0);

    const war: War = { id: 'w0', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn };
    state.wars.push(war);
    const chronicleBefore = state.chronicle.length;

    const messages = joinAlliesToWar(state, war);

    expect(messages).toHaveLength(1);
    expect(state.wars).toHaveLength(2);
    const mirror = state.wars.find((w) => w.id !== war.id)!;
    expect(mirror.attackerId).toBe('a');
    expect(mirror.defenderId).toBe('c');
    expect(mirror.cb).toBe(war.cb);
    expect(state.relations[relKey('a', 'c')].opinion).toBe(-30);
    expect(state.chronicle.length).toBe(chronicleBefore + 1);
    expect(state.chronicle.at(-1)!.text).toContain('Casa Aliada');
    expect(state.chronicle.at(-1)!.text).toContain('Casa Defendida');
  });

  it('no duplica la guerra si el aliado ya está en guerra con el atacante', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'consolidated' });
    const c = makeFaction({ id: 'c', ai: 'tribal' });
    const preexisting: War = { id: 'w_ac', attackerId: 'a', defenderId: 'c', cb: 'sin_causa', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 };
    const state = baseState([a, b, c], [], [preexisting]);
    setRelation(state, 'b', 'c', 50, ['alliance']);

    const war: War = { id: 'w0', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn };
    state.wars.push(war);

    const messages = joinAlliesToWar(state, war);

    expect(messages).toHaveLength(0);
    expect(state.wars).toHaveLength(2); // la preexistente + war, ninguna nueva
  });
});

// ============================================================================
// HERENCIA POR MATRIMONIO
// ============================================================================

describe('marriageHeirFaction / transferRealm', () => {
  it('devuelve null si no hay ningún lazo de sangre', () => {
    const a = makeFaction({ id: 'a', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const state = baseState([a, b], []);
    setRelation(state, 'a', 'b', 50); // opinión alta, pero sin lazo
    expect(marriageHeirFaction(state, 'a')).toBeNull();
  });

  it('devuelve la casa ligada de mayor opinión entre varios lazos, e ignora casas muertas', () => {
    const dead = makeFaction({ id: 'dead', ai: 'ambitious' });
    const low = makeFaction({ id: 'low', ai: 'tribal' });
    const high = makeFaction({ id: 'high', ai: 'consolidated' });
    const extinct = makeFaction({ id: 'extinct', ai: 'tribal', alive: false });
    const state = baseState([dead, low, high, extinct], []);
    setRelation(state, 'dead', 'low', 10, ['marriage_tie']);
    setRelation(state, 'dead', 'high', 40, ['marriage_tie']);
    setRelation(state, 'dead', 'extinct', 90, ['marriage_tie']); // mayor opinión, pero muerta: no puede heredar

    expect(marriageHeirFaction(state, 'dead')).toBe('high');
  });

  it('desempata por id ascendente si dos candidatos tienen la misma opinión', () => {
    const dead = makeFaction({ id: 'dead', ai: 'ambitious' });
    const b = makeFaction({ id: 'b', ai: 'tribal' });
    const c = makeFaction({ id: 'c', ai: 'consolidated' });
    const state = baseState([dead, b, c], []);
    setRelation(state, 'dead', 'c', 10, ['marriage_tie']);
    setRelation(state, 'dead', 'b', 10, ['marriage_tie']);

    expect(marriageHeirFaction(state, 'dead')).toBe('b');
  });

  it('transferRealm mueve las provincias, disuelve los ejércitos del muerto y narra crónica épica', () => {
    const from = makeFaction({ id: 'from', ai: 'ambitious', dynastyName: 'Casa Extinta' });
    const to = makeFaction({ id: 'to', ai: 'tribal', dynastyName: 'Casa Heredera' });
    const p1 = makeProvince({ id: 1, ownerId: 'from', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'from', neighbors: [1] });
    const p3 = makeProvince({ id: 3, ownerId: 'to', neighbors: [] });
    const state = baseState([from, to], [p1, p2, p3]);
    state.armies.army_from = militiaArmy('army_from', 'from', 1, 2);
    const chronicleBefore = state.chronicle.length;

    const messages = transferRealm(state, 'from', 'to');

    expect(state.provinces.find((p) => p.id === 1)!.ownerId).toBe('to');
    expect(state.provinces.find((p) => p.id === 2)!.ownerId).toBe('to');
    expect(state.provinces.find((p) => p.id === 3)!.ownerId).toBe('to'); // no tocada, ya era suya
    expect(state.armies.army_from).toBeUndefined();
    expect(state.chronicle.length).toBe(chronicleBefore + 2); // legado + disolución de huestes
    expect(messages).toHaveLength(2);
    expect(state.chronicle[chronicleBefore].kind).toBe('dinastia');
    expect(state.chronicle[chronicleBefore].text).toContain('Casa Heredera');
    expect(state.chronicle[chronicleBefore].text).toContain('Casa Extinta');
    // no decide extinción: eso es responsabilidad de turn.ts (el integrador).
    expect(state.factions.from.alive).toBe(true);
  });

  it('transferRealm es no-op si fromId === toId, y no narra nada si el muerto no tenía provincias ni ejércitos', () => {
    const from = makeFaction({ id: 'from', ai: 'ambitious' });
    const to = makeFaction({ id: 'to', ai: 'tribal' });
    const state = baseState([from, to], []);

    expect(transferRealm(state, 'from', 'from')).toEqual([]);

    const messages = transferRealm(state, 'from', 'to');
    expect(messages).toHaveLength(1); // "reclama el legado vacío"
  });
});

// ============================================================================
// DETERMINISMO
// ============================================================================

describe('determinismo', () => {
  it('la misma semilla en la zona probabilística de proposeMarriage produce el mismo estado final', () => {
    function run(): GameState {
      const a = makeFaction({ id: 'a', ai: 'ambitious' });
      const b = makeFaction({ id: 'b', ai: 'tribal' });
      const state = baseState([a, b], []);
      setRelation(state, 'a', 'b', -20);
      proposeMarriage(state, new Rng(7), 'a', 'b');
      return state;
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('una secuencia completa de acciones diplomáticas produce el mismo estado final en dos corridas independientes', () => {
    function run(): GameState {
      const a = makeFaction({ id: 'a', ai: 'ambitious' });
      const b = makeFaction({ id: 'b', ai: 'consolidated' });
      const c = makeFaction({ id: 'c', ai: 'tribal' });
      const state = baseState([a, b, c], []);
      setRelation(state, 'a', 'b', 30);
      setRelation(state, 'b', 'c', 10);
      const rng = new Rng(99);
      proposeMarriage(state, rng, 'a', 'b');
      formAlliance(state, rng, 'a', 'b');
      signNonAggression(state, rng, 'b', 'c');
      breakTreaty(state, 'a', 'b', 'alliance');
      return state;
    }
    const s1 = run();
    const s2 = run();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});

// ============================================================================
// factionAI usa diplomacia de verdad (GDD §10 v1+: "y que la IA la USE")
// ============================================================================

describe('runFactionAI — la IA usa diplomacia (AGENTE R)', () => {
  it('todos los arquetipos: si están muy debilitados frente a un vecino fronterizo, proponen no agresión al más fuerte (determinista, sin depender del Rng)', () => {
    const weak = makeFaction({ id: 'weak', ai: 'consolidated' });
    const strong = makeFaction({ id: 'strong', ai: 'ambitious' });
    const p1 = makeProvince({ id: 1, ownerId: 'weak', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'strong', neighbors: [1] });
    const state = baseState([weak, strong], [p1, p2]);
    setRelation(state, 'weak', 'strong', 0);
    // 'strong' tiene ejército (fuerza > 0); 'weak' no tiene ninguno → 0 < 0.7×fuerza siempre.
    state.armies.army_strong = militiaArmy('army_strong', 'strong', 2, 3);

    const log = runFactionAI(state, new Rng(1), 'weak');

    const rel = state.relations[relKey('weak', 'strong')];
    expect(rel.treaties, `log: ${log.join(' | ')}`).toContain('non_aggression');
  });

  it('tribal: rompe un pacto existente con una presa que cayó por debajo de 0.5x de su fuerza (determinista)', () => {
    const tribal = makeFaction({ id: 'tribu', ai: 'tribal', religionId: 'viejos_pactos' });
    // misma religión que la presa a propósito: así el paso 4 (declarar guerra)
    // NO dispara también en este test y queda aislado el efecto de breakTreaty.
    const prey = makeFaction({ id: 'presa', ai: 'consolidated', religionId: 'viejos_pactos' });
    const p1 = makeProvince({ id: 1, ownerId: 'tribu', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'presa', neighbors: [1] });
    const state = baseState([tribal, prey], [p1, p2]);
    state.armies.army_tribu = militiaArmy('army_tribu', 'tribu', 1, 3); // fuerza > 0; presa sin ejércitos: 0 < 0.5x siempre
    setRelation(state, 'tribu', 'presa', 20, ['non_aggression']);

    const log = runFactionAI(state, new Rng(1), 'tribu');

    const rel = state.relations[relKey('tribu', 'presa')];
    expect(rel.treaties, `log: ${log.join(' | ')}`).not.toContain('non_aggression');
    expect(state.factions.tribu.legitimacy).toBeLessThan(80); // asumió el coste
  });

  it('tribal: rompe el pacto Y declara la guerra en el mismo turno cuando además hay causa religiosa (combo predatorio completo)', () => {
    const tribal = makeFaction({ id: 'tribu', ai: 'tribal', religionId: 'viejos_pactos' });
    const prey = makeFaction({ id: 'presa', ai: 'consolidated', religionId: 'calculo' }); // religión distinta
    const p1 = makeProvince({ id: 1, ownerId: 'tribu', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'presa', neighbors: [1] });
    const state = baseState([tribal, prey], [p1, p2]);
    state.armies.army_tribu = militiaArmy('army_tribu', 'tribu', 1, 3);
    setRelation(state, 'tribu', 'presa', 20, ['non_aggression']);

    runFactionAI(state, new Rng(1), 'tribu');

    expect(state.wars).toHaveLength(1);
    expect(state.wars[0].attackerId).toBe('tribu');
    expect(state.wars[0].defenderId).toBe('presa');
  });

  it('NUNCA declara guerra si canDeclareWar dice que no, aunque la ventaja de fuerza sea aplastante', () => {
    const strong = makeFaction({ id: 'fuerte', ai: 'ambitious' });
    const weak = makeFaction({ id: 'debil', ai: 'tribal' });
    const p1 = makeProvince({ id: 1, ownerId: 'fuerte', neighbors: [2] });
    const p2 = makeProvince({ id: 2, ownerId: 'debil', neighbors: [1] });
    const state = baseState([strong, weak], [p1, p2]);
    state.armies.army_fuerte = militiaArmy('army_fuerte', 'fuerte', 1, 5); // ventaja aplastante (débil sin ejércitos)
    setRelation(state, 'fuerte', 'debil', 0);
    signNonAggression(state, new Rng(1), 'fuerte', 'debil'); // pacto vigente entre ambos

    runFactionAI(state, new Rng(2), 'fuerte');

    expect(state.wars).toHaveLength(0);
  });

  it('propone matrimonio a un vecino con buena opinión y sin lazo al menos una vez entre varias semillas (20% de probabilidad)', () => {
    let married = false;
    for (let seed = 1; seed <= 80 && !married; seed++) {
      const a = makeFaction({ id: 'a', ai: 'ambitious' });
      const b = makeFaction({ id: 'b', ai: 'consolidated' });
      const p1 = makeProvince({ id: 1, ownerId: 'a', neighbors: [2] });
      const p2 = makeProvince({ id: 2, ownerId: 'b', neighbors: [1] });
      const state = baseState([a, b], [p1, p2]);
      setRelation(state, 'a', 'b', 15); // >= 10, sin lazo

      runFactionAI(state, new Rng(seed), 'a');

      if (state.relations[relKey('a', 'b')].treaties.includes('marriage_tie')) married = true;
    }
    expect(married).toBe(true);
  });

  it('consolidated propone alianza a un vecino de opinión alta al menos una vez entre varias semillas (30% de probabilidad)', () => {
    let allied = false;
    for (let seed = 1; seed <= 80 && !allied; seed++) {
      const a = makeFaction({ id: 'a', ai: 'consolidated' });
      const b = makeFaction({ id: 'b', ai: 'ambitious' });
      const p1 = makeProvince({ id: 1, ownerId: 'a', neighbors: [2] });
      const p2 = makeProvince({ id: 2, ownerId: 'b', neighbors: [1] });
      const state = baseState([a, b], [p1, p2]);
      setRelation(state, 'a', 'b', 30); // >= 25, sin lazo

      runFactionAI(state, new Rng(seed), 'a');

      if (state.relations[relKey('a', 'b')].treaties.includes('alliance')) allied = true;
    }
    expect(allied).toBe(true);
  });
});
