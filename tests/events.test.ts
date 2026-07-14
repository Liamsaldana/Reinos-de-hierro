import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/state/rng';
import type { Army, Attributes, Character, Faction, GameState, Province } from '../src/core/types';
import { EVENT_DEFS } from '../src/core/events/defs';
import { applyEventChoice, rollTurnEvents } from '../src/core/events';
import type { PendingEvent } from '../src/core/events';

// ---------- constructores de estado sintético (sin newGame) ----------

function mkProvince(id: number, ownerId: string | null, opts: Partial<Province> = {}): Province {
  return {
    id,
    name: `Provincia ${id}`,
    terrain: 'plains',
    elevation: 0.3,
    center: [id, 0],
    polygon: [[0, 0]],
    neighbors: [],
    ownerId,
    settlement: { name: `Villa ${id}`, level: 2, fortLevel: 0 },
    iron: false,
    horses: false,
    baseTax: 5,
    baseFood: 5,
    baseManpower: 5,
    garrison: 300,
    ...opts,
  };
}

function mkFaction(id: string, overrides: Partial<Faction> = {}): Faction {
  return {
    id,
    name: `Reino ${id}`,
    dynastyName: `Casa ${id}`,
    cultureId: 'aurelios',
    religionId: 'aureismo',
    colorPrimary: '#111111',
    colorSecondary: '#222222',
    bannerSeed: 1,
    ai: id === 'f1' ? 'player' : 'consolidated',
    rulerId: `ruler_${id}`,
    heirId: null,
    gold: 200,
    manpower: 1000,
    foodStock: 100,
    legitimacy: 60,
    alive: true,
    ...overrides,
  };
}

function mkCharacter(
  id: string, factionId: string, role: Character['role'], overrides: Partial<Character> = {},
): Character {
  return {
    id,
    name: `Persona ${id}`,
    factionId,
    role,
    age: 35,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [],
    alive: true,
    ...overrides,
  };
}

function mkArmy(id: string, factionId: string, provinceId: number, units: Army['units']): Army {
  return { id, name: `Ejército ${id}`, factionId, provinceId, units, generalId: null, movement: 2, movementMax: 2 };
}

/** turno 19 => estación 3 (invierno), año 5: cumple hambruna_invierno y presagio_norte. */
function baseState(turn = 19): GameState {
  const provinces = [
    mkProvince(1, 'f1', { garrison: 300 }),
    mkProvince(2, 'f1', { garrison: 250 }),
    mkProvince(3, 'f2', { garrison: 200 }),
  ];
  const factions: Record<string, Faction> = {
    f1: mkFaction('f1', { rulerId: 'ruler_f1', heirId: null, legitimacy: 30 }),
    f2: mkFaction('f2', { rulerId: 'ruler_f2' }),
  };
  const characters: Record<string, Character> = {
    ruler_f1: mkCharacter('ruler_f1', 'f1', 'ruler', { age: 40 }),
    ruler_f2: mkCharacter('ruler_f2', 'f2', 'ruler', { age: 40 }),
    gen_f1: mkCharacter('gen_f1', 'f1', 'general', { age: 30 }),
  };
  const armies: Record<string, Army> = {
    army_f1: mkArmy('army_f1', 'f1', 1, [{ typeId: 'milicia', men: 100, morale: 8, xp: 0 }]),
  };
  return {
    version: 1,
    seed: 1,
    turn,
    playerFactionId: 'f1',
    provinces,
    factions,
    characters,
    armies,
    wars: [],
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
  };
}

function findDef(id: string) {
  const def = EVENT_DEFS.find(d => d.id === id);
  if (!def) throw new Error(`def de prueba no encontrado: ${id}`);
  return def;
}

/** construye un PendingEvent "manual" a partir de build(), para probar applyEventChoice sin depender del sorteo. */
function pendingFrom(defId: string, state: GameState, rng: Rng): PendingEvent {
  const def = findDef(defId);
  const built = def.build(state, rng);
  return {
    defId: def.id,
    title: built.title,
    text: built.text,
    choices: built.choices.map(c => c.label),
    payload: built.payload,
  };
}

describe('rollTurnEvents', () => {
  it('es determinista: la misma semilla produce exactamente los mismos eventos propuestos', () => {
    const s1 = baseState();
    const s2 = baseState();
    const events1 = rollTurnEvents(s1, new Rng(777));
    const events2 = rollTurnEvents(s2, new Rng(777));
    expect(JSON.stringify(events1)).toBe(JSON.stringify(events2));
  });

  it('propone como máximo `max` eventos y nunca repite defId en el mismo turno', () => {
    const s = baseState();
    const events = rollTurnEvents(s, new Rng(42), 2);
    expect(events.length).toBeLessThanOrEqual(2);
    expect(new Set(events.map(e => e.defId)).size).toBe(events.length);

    const s2 = baseState();
    const many = rollTurnEvents(s2, new Rng(42), 10);
    expect(new Set(many.map(e => e.defId)).size).toBe(many.length);
    expect(many.length).toBeLessThanOrEqual(EVENT_DEFS.length);
  });

  it('máx por defecto es 2', () => {
    const s = baseState();
    const events = rollTurnEvents(s, new Rng(3));
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it('un turno completo (roll + aplicar la primera opción de cada evento) es determinista', () => {
    function run(seed: number): GameState {
      const s = baseState();
      const rng = new Rng(seed);
      const events = rollTurnEvents(s, rng);
      for (const ev of events) applyEventChoice(s, rng, ev, 0);
      return s;
    }
    const a = run(555);
    const b = run(555);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('condiciones de las defs', () => {
  it('hambruna_invierno solo se propone en invierno', () => {
    const def = findDef('hambruna_invierno');
    for (let season = 0; season < 4; season++) {
      const s = baseState(16 + season); // año 5, estación = season
      expect(def.condition(s)).toBe(season === 3);
    }
  });

  it('presagio_norte solo en invierno y con año >= 5', () => {
    const def = findDef('presagio_norte');
    expect(def.condition(baseState(19))).toBe(true); // año 5, invierno
    expect(def.condition(baseState(3))).toBe(false); // año 1, invierno: año insuficiente
    expect(def.condition(baseState(18))).toBe(false); // año 5, otoño: estación incorrecta
  });

  it('revuelta_campesina exige legitimidad < 40 y al menos una provincia propia', () => {
    const def = findDef('revuelta_campesina');

    const highLegit = baseState();
    highLegit.factions.f1.legitimacy = 80;
    expect(def.condition(highLegit)).toBe(false);

    const lowLegitNoProvinces = baseState();
    lowLegitNoProvinces.factions.f1.legitimacy = 20;
    for (const p of lowLegitNoProvinces.provinces) if (p.ownerId === 'f1') p.ownerId = null;
    expect(def.condition(lowLegitNoProvinces)).toBe(false);

    const eligible = baseState();
    eligible.factions.f1.legitimacy = 20;
    expect(def.condition(eligible)).toBe(true);
  });

  it('nacimiento_heredero exige heirId nulo y gobernante vivo menor de 55', () => {
    const def = findDef('nacimiento_heredero');

    expect(def.condition(baseState())).toBe(true);

    const withHeir = baseState();
    withHeir.factions.f1.heirId = 'ya_existe';
    expect(def.condition(withHeir)).toBe(false);

    const oldRuler = baseState();
    oldRuler.characters.ruler_f1.age = 60;
    expect(def.condition(oldRuler)).toBe(false);

    const deadRuler = baseState();
    deadRuler.characters.ruler_f1.alive = false;
    expect(def.condition(deadRuler)).toBe(false);
  });

  it('traicion_general exige al menos un general vivo propio', () => {
    const def = findDef('traicion_general');
    expect(def.condition(baseState())).toBe(true);

    const noGenerals = baseState();
    noGenerals.characters.gen_f1.alive = false;
    expect(def.condition(noGenerals)).toBe(false);
  });

  it('propuesta_matrimonio y disputa_lindes exigen otra facción viva', () => {
    const matrimonio = findDef('propuesta_matrimonio');
    const lindes = findDef('disputa_lindes');
    expect(matrimonio.condition(baseState())).toBe(true);
    expect(lindes.condition(baseState())).toBe(true);

    const alone = baseState();
    alone.factions.f2.alive = false;
    expect(matrimonio.condition(alone)).toBe(false);
    expect(lindes.condition(alone)).toBe(false);
  });
});

describe('estructura de las defs', () => {
  it('todos los ids son únicos y hay ~15 eventos', () => {
    const ids = EVENT_DEFS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EVENT_DEFS.length).toBeGreaterThanOrEqual(15);
  });

  it('toda def construye entre 2 y 4 choices, con título/texto no vacíos y choices bien formadas', () => {
    const s = baseState();
    for (const def of EVENT_DEFS) {
      const built = def.build(s, new Rng(123));
      expect(built.title.length, `${def.id}: title vacío`).toBeGreaterThan(0);
      expect(built.text.length, `${def.id}: text vacío`).toBeGreaterThan(0);
      expect(built.choices.length, `${def.id}: número de choices`).toBeGreaterThanOrEqual(2);
      expect(built.choices.length, `${def.id}: número de choices`).toBeLessThanOrEqual(4);
      for (const c of built.choices) {
        expect(c.label.length, `${def.id}: choice label vacío`).toBeGreaterThan(0);
        expect(typeof c.effect).toBe('function');
      }
    }
  });
});

describe('applyEventChoice: efectos concretos', () => {
  it('nacimiento_heredero (celebrar) crea un personaje heredero, gasta 20 oro y sube 5 de legitimidad', () => {
    const s = baseState();
    const rng = new Rng(5);
    const ev = pendingFrom('nacimiento_heredero', s, rng);
    const goldBefore = s.factions.f1.gold;
    const legitBefore = s.factions.f1.legitimacy;

    const lines = applyEventChoice(s, rng, ev, 0);

    expect(s.factions.f1.heirId).not.toBeNull();
    const heir = s.characters[s.factions.f1.heirId!];
    expect(heir).toBeDefined();
    expect(heir.role).toBe('heir');
    expect(heir.alive).toBe(true);
    expect(s.factions.f1.gold).toBe(goldBefore - 20);
    expect(s.factions.f1.legitimacy).toBe(legitBefore + 5);
    expect(lines.length).toBeGreaterThan(0);
    expect(s.chronicle).toHaveLength(1);
    expect(s.chronicle[0].kind).toBe('dinastia');
    expect(s.chronicle[0].turn).toBe(s.turn);
  });

  it('nacimiento_heredero (bautizo discreto) crea heredero sin coste', () => {
    const s = baseState();
    const rng = new Rng(6);
    const ev = pendingFrom('nacimiento_heredero', s, rng);
    const goldBefore = s.factions.f1.gold;
    const legitBefore = s.factions.f1.legitimacy;

    applyEventChoice(s, rng, ev, 1);

    expect(s.factions.f1.heirId).not.toBeNull();
    expect(s.factions.f1.gold).toBe(goldBefore);
    expect(s.factions.f1.legitimacy).toBe(legitBefore);
  });

  it('enfermedad_gobernante: pagar médicos baja legitimidad sin tocar atributos', () => {
    const s = baseState();
    const rng = new Rng(3);
    const ev = pendingFrom('enfermedad_gobernante', s, rng);
    const legitBefore = s.factions.f1.legitimacy;
    const attrsBefore = { ...s.characters.ruler_f1.attributes };

    applyEventChoice(s, rng, ev, 0);

    expect(s.factions.f1.legitimacy).toBe(legitBefore - 10);
    expect(s.characters.ruler_f1.attributes).toEqual(attrsBefore);
  });

  it('enfermedad_gobernante: no pagar médicos baja el atributo congelado en el payload', () => {
    const s = baseState();
    const rng = new Rng(3);
    const ev = pendingFrom('enfermedad_gobernante', s, rng);
    const attrKey = ev.payload!.attr as keyof Attributes;
    const before = s.characters.ruler_f1.attributes[attrKey];

    applyEventChoice(s, rng, ev, 1);

    expect(s.characters.ruler_f1.attributes[attrKey]).toBeLessThan(before);
  });

  it('traicion_general: pagarle cuesta 60 oro y lo mantiene vivo', () => {
    const s = baseState();
    const rng = new Rng(9);
    const ev = pendingFrom('traicion_general', s, rng);
    const goldBefore = s.factions.f1.gold;

    applyEventChoice(s, rng, ev, 0);

    expect(s.factions.f1.gold).toBe(goldBefore - 60);
    expect(s.characters.gen_f1.alive).toBe(true);
  });

  it('traicion_general: dejarlo ir lo mata y limpia generalId de sus ejércitos', () => {
    const s = baseState();
    s.armies.army_f1.generalId = 'gen_f1';
    const rng = new Rng(9);
    const ev = pendingFrom('traicion_general', s, rng);

    applyEventChoice(s, rng, ev, 1);

    expect(s.characters.gen_f1.alive).toBe(false);
    expect(s.armies.army_f1.generalId).toBeNull();
  });

  it('pretendiente_trono: ignorar cuesta 15 legitimidad; pagar cuesta 80 oro', () => {
    const s1 = baseState();
    const rng1 = new Rng(1);
    const ev1 = pendingFrom('pretendiente_trono', s1, rng1);
    const legitBefore = s1.factions.f1.legitimacy;
    applyEventChoice(s1, rng1, ev1, 0);
    expect(s1.factions.f1.legitimacy).toBe(legitBefore - 15);

    const s2 = baseState();
    const rng2 = new Rng(1);
    const ev2 = pendingFrom('pretendiente_trono', s2, rng2);
    const goldBefore = s2.factions.f1.gold;
    applyEventChoice(s2, rng2, ev2, 1);
    expect(s2.factions.f1.gold).toBe(goldBefore - 80);
  });

  it('hambruna_invierno: racionar baja comida y legitimidad; comprar grano baja oro', () => {
    const s1 = baseState();
    const rng1 = new Rng(2);
    const ev1 = pendingFrom('hambruna_invierno', s1, rng1);
    const amount = Number(ev1.payload!.amount);
    const foodBefore = s1.factions.f1.foodStock;
    const legitBefore = s1.factions.f1.legitimacy;
    applyEventChoice(s1, rng1, ev1, 0);
    expect(s1.factions.f1.foodStock).toBe(Math.max(0, foodBefore - amount));
    expect(s1.factions.f1.legitimacy).toBe(legitBefore - 15);

    const s2 = baseState();
    const rng2 = new Rng(2);
    const ev2 = pendingFrom('hambruna_invierno', s2, rng2);
    const goldBefore = s2.factions.f1.gold;
    applyEventChoice(s2, rng2, ev2, 1);
    expect(s2.factions.f1.gold).toBe(Math.max(0, goldBefore - amount * 2));
  });

  it('revuelta_campesina: ignorar deja la provincia sin señor con guarnición 400', () => {
    const s = baseState();
    s.factions.f1.legitimacy = 20;
    const rng = new Rng(4);
    const ev = pendingFrom('revuelta_campesina', s, rng);
    const provinceId = Number(ev.payload!.provinceId);

    applyEventChoice(s, rng, ev, 0);

    const province = s.provinces.find(p => p.id === provinceId)!;
    expect(province.ownerId).toBeNull();
    expect(province.garrison).toBe(400);
  });

  it('revuelta_campesina: reprimir cuesta 300 de levas y conserva la provincia', () => {
    const s = baseState();
    s.factions.f1.legitimacy = 20;
    const rng = new Rng(4);
    const ev = pendingFrom('revuelta_campesina', s, rng);
    const provinceId = Number(ev.payload!.provinceId);
    const manpowerBefore = s.factions.f1.manpower;

    applyEventChoice(s, rng, ev, 1);

    expect(s.factions.f1.manpower).toBe(manpowerBefore - 300);
    expect(s.provinces.find(p => p.id === provinceId)!.ownerId).toBe('f1');
  });

  it('reliquia_aurelia: consagrar sube legitimidad; vender sube oro', () => {
    const s1 = baseState();
    const rng1 = new Rng(7);
    const ev1 = pendingFrom('reliquia_aurelia', s1, rng1);
    const legitBefore = s1.factions.f1.legitimacy;
    applyEventChoice(s1, rng1, ev1, 0);
    expect(s1.factions.f1.legitimacy).toBe(legitBefore + 10);

    const s2 = baseState();
    const rng2 = new Rng(7);
    const ev2 = pendingFrom('reliquia_aurelia', s2, rng2);
    const goldBefore = s2.factions.f1.gold;
    applyEventChoice(s2, rng2, ev2, 1);
    expect(s2.factions.f1.gold).toBe(goldBefore + 50);
  });

  it('applyEventChoice re-resuelve el mismo objetivo congelado en el payload (plaga_provincia)', () => {
    const s = baseState();
    const rng = new Rng(21);
    const ev = pendingFrom('plaga_provincia', s, rng);
    const provinceId = Number(ev.payload!.provinceId);
    const targetName = s.provinces.find(p => p.id === provinceId)!.name;

    // rng distinto en la aplicación: si build() ignorara el payload, podría
    // elegir una provincia distinta a la mostrada en el evento propuesto.
    const rngApply = new Rng(999999);
    const lines = applyEventChoice(s, rngApply, ev, 0);

    expect(lines.join(' ')).toContain(targetName);
  });

  it('applyEventChoice escribe una entrada de crónica con el kind del def y devuelve líneas', () => {
    const s = baseState();
    const rng = new Rng(11);
    const ev = pendingFrom('reliquia_aurelia', s, rng);

    const lines = applyEventChoice(s, rng, ev, 0);

    expect(lines.length).toBeGreaterThan(0);
    expect(s.chronicle).toHaveLength(1);
    expect(s.chronicle[0].kind).toBe('mundo');
    expect(s.chronicle[0].text.length).toBeGreaterThan(0);
  });

  it('applyEventChoice lanza con un choiceIndex fuera de rango', () => {
    const s = baseState();
    const rng = new Rng(11);
    const ev = pendingFrom('reliquia_aurelia', s, rng);
    expect(() => applyEventChoice(s, rng, ev, 99)).toThrow();
  });

  it('applyEventChoice lanza con un defId desconocido', () => {
    const s = baseState();
    const rng = new Rng(11);
    const fake: PendingEvent = { defId: 'no_existe', title: 't', text: 't', choices: ['a', 'b'] };
    expect(() => applyEventChoice(s, rng, fake, 0)).toThrow();
  });
});
