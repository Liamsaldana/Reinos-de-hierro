/**
 * Tests de LA CAPA MÍTICA (Fase 3, GDD §2.5, §13.1) — AGENTE S.
 *
 * Ejercita el pulso mítico de forma AISLADA del motor de turno (nunca llama
 * `endTurn`): el avance pálido se prueba llamando `tickMythic` + su `moveArmy`
 * interno directamente, tal y como hará el integrador dentro de `endTurn`. Se
 * mezcla `newGame` (mundo real) con estados sintéticos mínimos (control total)
 * según lo que cada prueba necesita, siguiendo el patrón de research.test.ts.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { getUnitType } from '../src/core/content/units';
import { moveArmy } from '../src/core/systems/actions';
import { Rng } from '../src/core/state/rng';
import type {
  Army, BattleReport, Character, Faction, FactionId, GameState, Province, ProvinceId,
} from '../src/core/types';
import {
  ESCARCHA_MIN_TURN, PALIDOS_FACTION_ID, PRESAGIO_CHAIN, canEquipVidrio, claimLostWeapon,
  ensureMythic, equipVidrio, forceEscarcha, palidosResistanceFactor, sellarGranTregua,
  tickMythic, weaponOfGeneral,
} from '../src/core/mythic';

// ---------- constructores de estado sintético ----------

function mkProvince(id: ProvinceId, z: number, ownerId: FactionId | null, over: Partial<Province> = {}): Province {
  return {
    id, name: `Provincia ${id}`, terrain: 'plains', elevation: 0.3,
    center: [0, z], polygon: [[0, z]], neighbors: [], ownerId,
    settlement: { name: `Villa ${id}`, level: 1, fortLevel: 0 },
    iron: false, horses: false, baseTax: 5, baseFood: 6, baseManpower: 100,
    garrison: 0, ...over,
  };
}

function mkFaction(id: FactionId, over: Partial<Faction> = {}): Faction {
  return {
    id, name: `Reino ${id}`, dynastyName: `Casa ${id}`, cultureId: 'aurelios', religionId: 'aureismo',
    colorPrimary: '#111', colorSecondary: '#222', bannerSeed: 1, ai: 'consolidated',
    rulerId: `ruler_${id}`, heirId: null, gold: 100, manpower: 100, foodStock: 100,
    legitimacy: 60, alive: true, ...over,
  };
}

function mkChar(id: string, factionId: FactionId, over: Partial<Character> = {}): Character {
  return {
    id, name: `Personaje ${id}`, factionId, role: 'general', age: 35,
    attributes: { martial: 5, stewardship: 5, diplomacy: 5, intrigue: 5 },
    traits: [], alive: true, ...over,
  };
}

function mkArmy(id: string, factionId: FactionId, provinceId: ProvinceId, over: Partial<Army> = {}): Army {
  return {
    id, name: `Hueste ${id}`, factionId, provinceId,
    units: [{ typeId: 'milicia', men: 100, morale: 8, xp: 0 }],
    generalId: null, movement: 2, movementMax: 2, ...over,
  };
}

function mkState(over: Partial<GameState> = {}): GameState {
  return {
    version: 1, seed: 1, turn: 0, playerFactionId: 'jugador',
    provinces: [], factions: {}, characters: {}, armies: {}, wars: [], relations: {},
    chronicle: [], rngState: 1, lastBattle: null, outcome: 'ongoing', ...over,
  };
}

// ======================================================================
// ensureMythic
// ======================================================================

describe('ensureMythic', () => {
  it('crea el estado mítico con defaults y es idempotente (misma referencia, no reinicia)', () => {
    const s = newGame(11);
    expect(s.mythic).toBeUndefined();

    const m1 = ensureMythic(s);
    expect(s.mythic).toBe(m1);
    expect(m1).toMatchObject({
      winterSeverity: 0, presagios: 0, escarchaActive: false, granTregua: false, namedWeapons: [],
    });
    expect(m1.vidrioArmies).toEqual([]);

    m1.presagios = 3;
    m1.winterSeverity = 7;
    const m2 = ensureMythic(s);
    expect(m2).toBe(m1);
    expect(m2.presagios).toBe(3); // NO reinicia
    expect(m2.winterSeverity).toBe(7);
  });

  it('rellena vidrioArmies si un save antiguo no lo traía, sin tocar el resto', () => {
    const s = newGame(11);
    s.mythic = { winterSeverity: 2, presagios: 1, escarchaActive: false, granTregua: false, namedWeapons: [] };
    const m = ensureMythic(s);
    expect(m.vidrioArmies).toEqual([]);
    expect(m.presagios).toBe(1);
  });
});

// ======================================================================
// tickMythic — inviernos y presagios
// ======================================================================

describe('tickMythic: inviernos y presagios', () => {
  it('en inviernos sube winterSeverity y narra los 6 presagios EN ORDEN', () => {
    const s = newGame(11);
    const rng = new Rng(1);

    let prevSeverity = 0;
    for (let w = 0; w < PRESAGIO_CHAIN.length; w++) {
      s.turn = 3 + w * 4; // turnos de invierno: 3, 7, 11, 15, 19, 23
      const msgs = tickMythic(s, rng);
      const m = s.mythic!;
      expect(m.presagios).toBe(w + 1);
      expect(m.winterSeverity).toBeGreaterThan(prevSeverity); // rng.int(1,3) >= 1
      prevSeverity = m.winterSeverity;
      expect(msgs[0]).toBe(PRESAGIO_CHAIN[w]); // el presagio se narra primero
    }

    // los 6 presagios están en la crónica, en orden.
    const omens = s.chronicle.filter(e => (PRESAGIO_CHAIN as readonly string[]).includes(e.text)).map(e => e.text);
    expect(omens).toEqual([...PRESAGIO_CHAIN]);

    // agotada la cadena, un invierno más NO añade presagios, y NO hay escarcha (turno < umbral).
    s.turn = 27;
    tickMythic(s, rng);
    expect(s.mythic!.presagios).toBe(PRESAGIO_CHAIN.length);
    expect(s.mythic!.escarchaActive).toBe(false);
  });

  it('fuera del invierno no narra presagios ni sube la severidad', () => {
    const s = newGame(11);
    const rng = new Rng(1);
    for (const turn of [0, 1, 2, 4, 5, 6]) { // ninguno es invierno (turn % 4 === 3)
      s.turn = turn;
      tickMythic(s, rng);
    }
    expect(s.mythic!.presagios).toBe(0);
    expect(s.mythic!.winterSeverity).toBe(0);
  });
});

// ======================================================================
// Siembra de acero estelar
// ======================================================================

describe('tickMythic: siembra de armas nombradas (acero estelar)', () => {
  it('con ≥2 presagios siembra 3 hojas: dos en generales de casas IA distintas, una perdida en el norte', () => {
    const s = newGame(11);
    const rng = new Rng(1);
    s.turn = 3; tickMythic(s, rng); // presagio 1
    expect(s.mythic!.namedWeapons).toHaveLength(0);
    s.turn = 7; tickMythic(s, rng); // presagio 2 -> siembra

    const weapons = s.mythic!.namedWeapons;
    expect(weapons).toHaveLength(3);
    for (const w of weapons) expect(w.bonusMartial).toBe(3);

    const borne = weapons.filter(w => w.bearerCharacterId != null);
    const lost = weapons.filter(w => w.bearerCharacterId == null);
    expect(borne).toHaveLength(2);
    expect(lost).toHaveLength(1);
    expect(lost[0].lostInProvinceId).not.toBeNull();

    // las dos portadas están en generales vivos de dos casas IA DISTINTAS.
    const houses = borne.map(w => s.characters[w.bearerCharacterId!].factionId);
    expect(new Set(houses).size).toBe(2);
    for (const w of borne) {
      const ch = s.characters[w.bearerCharacterId!];
      expect(ch.role).toBe('general');
      expect(ch.alive).toBe(true);
      expect(s.factions[ch.factionId].ai).not.toBe('player');
    }

    // no se re-siembra en ticks posteriores.
    s.turn = 11; tickMythic(s, rng);
    expect(s.mythic!.namedWeapons).toHaveLength(3);
  });
});

// ======================================================================
// weaponOfGeneral / armas caídas / claimLostWeapon
// ======================================================================

describe('armas nombradas: portar, caer y reclamar', () => {
  it('weaponOfGeneral devuelve el arma del portador, null en otro caso', () => {
    const s = mkState();
    const m = ensureMythic(s);
    m.namedWeapons = [{ id: 'w1', name: 'Alba de Invierno', bearerCharacterId: 'g1', lostInProvinceId: null, bonusMartial: 3 }];
    expect(weaponOfGeneral(s, 'g1')?.name).toBe('Alba de Invierno');
    expect(weaponOfGeneral(s, 'g2')).toBeNull();
    expect(weaponOfGeneral(s, null)).toBeNull();
  });

  it('al morir el portador, tickMythic deja el arma en el campo (lostInProvinceId de la última batalla)', () => {
    const s = mkState({
      turn: 41, // no invierno
      provinces: [mkProvince(0, 0, 'casa_a'), mkProvince(1, 20, 'casa_a')],
      factions: { casa_a: mkFaction('casa_a'), jugador: mkFaction('jugador', { ai: 'player' }) },
      characters: { g1: mkChar('g1', 'casa_a') },
      armies: { a1: mkArmy('a1', 'casa_a', 0, { generalId: 'g1' }) },
    });
    const m = ensureMythic(s);
    m.namedWeapons = [{ id: 'w1', name: 'Lamento del Cuervo', bearerCharacterId: 'g1', lostInProvinceId: null, bonusMartial: 3 }];

    // el general cae en batalla en la provincia 1 (autoresolve limpia generalId).
    s.characters.g1.alive = false;
    s.armies.a1.generalId = null;
    s.lastBattle = { provinceId: 1, attacker: { factionId: 'casa_a' } } as BattleReport;

    tickMythic(s, new Rng(1));
    const w = s.mythic!.namedWeapons[0];
    expect(w.bearerCharacterId).toBeNull();
    expect(w.lostInProvinceId).toBe(1);
  });

  it('claimLostWeapon: un ejército con general en la provincia del arma perdida la recupera', () => {
    const s = mkState({
      provinces: [mkProvince(5, 0, 'casa_a')],
      factions: { casa_a: mkFaction('casa_a') },
      characters: { g2: mkChar('g2', 'casa_a') },
      armies: { a2: mkArmy('a2', 'casa_a', 5, { generalId: 'g2' }) },
    });
    const m = ensureMythic(s);
    m.namedWeapons = [{ id: 'w1', name: 'Juramento de Aurelia', bearerCharacterId: null, lostInProvinceId: 5, bonusMartial: 3 }];

    // sin general en la provincia correcta: falla.
    expect(claimLostWeapon(s, 'inexistente').ok).toBe(false);

    const res = claimLostWeapon(s, 'a2');
    expect(res.ok).toBe(true);
    expect(s.mythic!.namedWeapons[0].bearerCharacterId).toBe('g2');
    expect(s.mythic!.namedWeapons[0].lostInProvinceId).toBeNull();
    expect(weaponOfGeneral(s, 'g2')?.name).toBe('Juramento de Aurelia');

    // ya reclamada: no queda nada que reclamar.
    expect(claimLostWeapon(s, 'a2').ok).toBe(false);
  });
});

// ======================================================================
// forceEscarcha
// ======================================================================

describe('forceEscarcha', () => {
  it('crea la facción-hueste, declara guerras y spawnea 2 huestes en el norte', () => {
    const s = newGame(11);
    const livingBefore = Object.values(s.factions).filter(f => f.alive).length;

    const msgs = forceEscarcha(s, new Rng(1));
    expect(msgs.length).toBeGreaterThan(0);

    const palidos = s.factions[PALIDOS_FACTION_ID];
    expect(palidos).toBeDefined();
    expect(palidos.ai).toBe('palidos');
    expect(palidos.colorPrimary).toBe('#9fb4c0');
    expect(palidos.dynastyName).toBe('Los Pálidos');
    expect(palidos.alive).toBe(true);
    expect(s.characters[palidos.rulerId].name).toBe('El Señor de la Escarcha');
    expect(s.provinces.some(p => p.ownerId === PALIDOS_FACTION_ID)).toBe(false); // sin provincias propias

    // guerra directa contra cada casa viva, sin declaración de legitimidad.
    const palidoWars = s.wars.filter(w => w.attackerId === PALIDOS_FACTION_ID);
    expect(palidoWars.length).toBe(livingBefore);
    for (const w of palidoWars) expect(w.cb).toBe('sin_causa');

    // dos huestes (4 pálidos + 1 engendro cada una) en las 2 provincias más al norte.
    const hosts = Object.values(s.armies).filter(a => a.factionId === PALIDOS_FACTION_ID);
    expect(hosts).toHaveLength(2);
    for (const h of hosts) {
      expect(h.units.filter(u => u.typeId === 'palido')).toHaveLength(4);
      expect(h.units.filter(u => u.typeId === 'engendro_de_escarcha')).toHaveLength(1);
    }
    const north2 = [...s.provinces].sort((a, b) => a.center[1] - b.center[1] || a.id - b.id).slice(0, 2).map(p => p.id);
    expect(new Set(hosts.map(h => h.provinceId))).toEqual(new Set(north2));

    // idempotente: una segunda llamada no duplica nada.
    expect(forceEscarcha(s, new Rng(1))).toEqual([]);
    expect(Object.values(s.armies).filter(a => a.factionId === PALIDOS_FACTION_ID)).toHaveLength(2);
  });

  it('el registro de las unidades míticas hace que getUnitType las conozca', () => {
    expect(getUnitType('palido').armor).toBe(8);
    expect(getUnitType('palido').moraleMax).toBe(20);
    expect(getUnitType('engendro_de_escarcha').category).toBe('cavalry');
    expect(getUnitType('engendro_de_escarcha').speed).toBe(16);
  });
});

// ======================================================================
// El umbral de la escarcha (seguridad del harness de simulación)
// ======================================================================

describe('umbral de la Larga Escarcha', () => {
  it(`no se dispara antes del turno ${ESCARCHA_MIN_TURN} aunque los 6 presagios estén narrados`, () => {
    const s = newGame(11);
    const rng = new Rng(1);
    const m = ensureMythic(s);
    m.presagios = PRESAGIO_CHAIN.length;

    s.turn = ESCARCHA_MIN_TURN - 1;
    tickMythic(s, rng);
    expect(s.mythic!.escarchaActive).toBe(false);

    s.turn = ESCARCHA_MIN_TURN;
    tickMythic(s, rng);
    expect(s.mythic!.escarchaActive).toBe(true);
  });
});

// ======================================================================
// Avance pálido: conquista hacia el sur
// ======================================================================

describe('avance pálido hacia el sur', () => {
  /**
   * Mundo-corredor norte→sur controlado: cadena p0..p4 (z creciente) que los
   * Pálidos deben conquistar, más 9 provincias "relleno" de la corona (jugador)
   * desconectadas, para que las conquistas del corredor queden por debajo del
   * 40% (sin disparar la derrota) y el jugador nunca pierda todo (sin victoria
   * ni derrota prematuras: el foco es el AVANCE).
   */
  function mkCorridorWorld(): GameState {
    const chain: Province[] = [
      mkProvince(0, -40, null),
      mkProvince(1, -20, null),
      mkProvince(2, 0, 'reino_norte', { garrison: 30 }),
      mkProvince(3, 20, 'reino_norte', { garrison: 30 }),
      mkProvince(4, 40, 'reino_norte', { garrison: 30 }),
    ];
    chain[0].neighbors = [1];
    chain[1].neighbors = [0, 2];
    chain[2].neighbors = [1, 3];
    chain[3].neighbors = [2, 4];
    chain[4].neighbors = [3];

    const filler: Province[] = [];
    for (let i = 0; i < 9; i++) filler.push(mkProvince(10 + i, 200 + i, 'corona'));

    return mkState({
      turn: 0,
      playerFactionId: 'corona',
      provinces: [...chain, ...filler],
      factions: {
        corona: mkFaction('corona', { ai: 'player' }),
        reino_norte: mkFaction('reino_norte', { ai: 'consolidated' }),
      },
      characters: {},
      armies: {},
    });
  }

  it('conquista la provincia más al sur en ≤10 ticks (tickMythic + moveArmy interno)', () => {
    const s = mkCorridorWorld();
    const rng = new Rng(7);
    forceEscarcha(s, rng); // huestes en p0 y p1 (las de menor z)

    let conqueredSouth = false;
    for (let t = 0; t < 10 && !conqueredSouth; t++) {
      tickMythic(s, rng);
      s.turn += 1;
      if (s.provinces.find(p => p.id === 4)!.ownerId === PALIDOS_FACTION_ID) conqueredSouth = true;
    }

    expect(conqueredSouth).toBe(true);
    // conquistaron el corredor entero arrebatándoselo a reino_norte.
    const palidoProvs = s.provinces.filter(p => p.ownerId === PALIDOS_FACTION_ID).map(p => p.id).sort((a, b) => a - b);
    expect(palidoProvs).toContain(4);
    expect(palidoProvs.length).toBeGreaterThanOrEqual(3);
    // el jugador (corona) conserva su territorio: sin desenlace prematuro.
    expect(s.outcome).toBe('ongoing');
  });
});

// ======================================================================
// Desenlace de la Larga Noche: victoria y derrota
// ======================================================================

describe('desenlace de la Larga Noche', () => {
  it('victoria (victory_larga_noche) al exterminar a los Pálidos', () => {
    const s = mkState({
      provinces: [mkProvince(0, 0, 'jugador'), mkProvince(1, 20, 'jugador')],
      factions: { jugador: mkFaction('jugador', { ai: 'player' }) },
    });
    forceEscarcha(s, new Rng(1)); // crea palidos + huestes en p0/p1
    // se exterminan: ni ejércitos ni provincias pálidas.
    for (const id of Object.keys(s.armies)) {
      if (s.armies[id].factionId === PALIDOS_FACTION_ID) delete s.armies[id];
    }
    expect(s.outcome).toBe('ongoing');

    tickMythic(s, new Rng(1));
    expect(s.outcome).toBe('victory_larga_noche');
  });

  it('derrota (defeat_palidos) cuando los Pálidos controlan ≥40% de las provincias', () => {
    // 5 provincias; ponemos 2 (40%) en manos pálidas.
    const provinces = [0, 1, 2, 3, 4].map(id => mkProvince(id, id * 10, 'jugador'));
    const s = mkState({
      provinces,
      factions: { jugador: mkFaction('jugador', { ai: 'player' }) },
    });
    forceEscarcha(s, new Rng(1));
    // aislamos el desenlace del avance: sin huestes que muevan el mapa.
    for (const id of Object.keys(s.armies)) {
      if (s.armies[id].factionId === PALIDOS_FACTION_ID) delete s.armies[id];
    }
    s.provinces[0].ownerId = PALIDOS_FACTION_ID;
    s.provinces[1].ownerId = PALIDOS_FACTION_ID; // 2/5 = 40%

    tickMythic(s, new Rng(1));
    expect(s.outcome).toBe('defeat_palidos');
  });

  it('no declara desenlace el mismo turno del spawn (la hueste tiene su primera marcha)', () => {
    const s = mkState({
      provinces: [mkProvince(0, 0, 'jugador'), mkProvince(1, 20, 'jugador')],
      factions: { jugador: mkFaction('jugador', { ai: 'player' }) },
      turn: ESCARCHA_MIN_TURN,
    });
    const m = ensureMythic(s);
    m.presagios = PRESAGIO_CHAIN.length;
    // borra huestes ANTES de que la escarcha arranque no aplica: aquí forzamos por tickMythic.
    tickMythic(s, new Rng(1)); // dispara la escarcha ESTE tick
    expect(s.mythic!.escarchaActive).toBe(true);
    // aunque hubiese 0 provincias pálidas, no se resuelve el desenlace el tick del spawn.
    expect(s.outcome).toBe('ongoing');
  });
});

// ======================================================================
// equipVidrio / canEquipVidrio
// ======================================================================

describe('equipVidrio', () => {
  let s: GameState;
  beforeEach(() => {
    s = mkState({
      provinces: [mkProvince(0, 0, 'reino', { vidrioIgneo: true })],
      factions: { reino: mkFaction('reino', { gold: 100, research: { active: null, points: 0, done: ['talla_de_vidrio_igneo'] } }) },
      armies: { a1: mkArmy('a1', 'reino', 0) },
      playerFactionId: 'reino',
    });
  });

  it('falla sin provincia de vidrio ígneo', () => {
    s.provinces[0].vidrioIgneo = false;
    expect(equipVidrio(s, 'a1').ok).toBe(false);
    expect(canEquipVidrio(s, 'a1')).toBe(false);
  });

  it('falla sin la tecnología talla_de_vidrio_igneo (aunque la tech no exista aún en el banco)', () => {
    s.factions.reino.research = { active: null, points: 0, done: [] };
    expect(equipVidrio(s, 'a1').ok).toBe(false);
  });

  it('falla sin oro suficiente', () => {
    s.factions.reino.gold = 10;
    expect(equipVidrio(s, 'a1').ok).toBe(false);
  });

  it('con provincia de vidrio + tecnología + 40 oro: equipa, cobra y registra el ejército', () => {
    expect(canEquipVidrio(s, 'a1')).toBe(true);
    const res = equipVidrio(s, 'a1');
    expect(res.ok).toBe(true);
    expect(s.factions.reino.gold).toBe(60);
    expect(s.mythic!.vidrioArmies).toContain('a1');

    // ya equipado: no vuelve a cobrar.
    expect(equipVidrio(s, 'a1').ok).toBe(false);
    expect(s.factions.reino.gold).toBe(60);
  });
});

// ======================================================================
// palidosResistanceFactor (pura)
// ======================================================================

describe('palidosResistanceFactor', () => {
  it('0.45 sin vidrio ni acero estelar; 1.25 con vidrio; 1.25 con arma nombrada; 1 fuera de la escarcha', () => {
    const s = mkState({
      factions: { reino: mkFaction('reino') },
      characters: { g1: mkChar('g1', 'reino') },
      armies: {
        plain: mkArmy('plain', 'reino', 0),
        hero: mkArmy('hero', 'reino', 0, { generalId: 'g1' }),
      },
    });
    const plain = s.armies.plain;
    const hero = s.armies.hero;

    // enemigo que no son los Pálidos → sin efecto.
    expect(palidosResistanceFactor(s, plain, 'otra_casa')).toBe(1);

    // enemigo Pálidos, sin vidrio ni arma → el acero común resbala.
    expect(palidosResistanceFactor(s, plain, PALIDOS_FACTION_ID)).toBe(0.45);

    // con vidrio ígneo equipado → muerde.
    const m = ensureMythic(s);
    m.vidrioArmies = ['plain'];
    expect(palidosResistanceFactor(s, plain, PALIDOS_FACTION_ID)).toBe(1.25);

    // con general portador de acero estelar → muerde, aunque no lleve vidrio.
    m.namedWeapons = [{ id: 'w', name: 'Alba de Invierno', bearerCharacterId: 'g1', lostInProvinceId: null, bonusMartial: 3 }];
    expect(palidosResistanceFactor(s, hero, PALIDOS_FACTION_ID)).toBe(1.25);
  });
});

// ======================================================================
// sellarGranTregua
// ======================================================================

describe('sellarGranTregua', () => {
  it('fuera de la escarcha no puede sellarse', () => {
    const s = mkState({ factions: { a: mkFaction('a'), b: mkFaction('b') } });
    expect(sellarGranTregua(s).ok).toBe(false);
  });

  it('durante la escarcha: pacifica las guerras entre casas, conserva las guerras pálidas y fija treguas', () => {
    const s = mkState({
      turn: 50,
      factions: { a: mkFaction('a'), b: mkFaction('b'), c: mkFaction('c') },
      wars: [
        { id: 'w_ab', attackerId: 'a', defenderId: 'b', cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0 },
      ],
    });
    const m = ensureMythic(s);
    m.escarchaActive = true;
    // guerra pálida contra 'a' (debe conservarse).
    s.wars.push({ id: 'w_pa', attackerId: PALIDOS_FACTION_ID, defenderId: 'a', cb: 'sin_causa', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 50 });

    const res = sellarGranTregua(s);
    expect(res.ok).toBe(true);
    expect(s.mythic!.granTregua).toBe(true);

    // la guerra a-vs-b desaparece; la guerra pálida sobrevive.
    expect(s.wars.some(w => w.id === 'w_ab')).toBe(false);
    expect(s.wars.some(w => w.id === 'w_pa')).toBe(true);

    // tregua entre cada par de casas vivas (a,b,c), hasta turno+40.
    for (const [x, y] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) {
      const key = x < y ? `${x}|${y}` : `${y}|${x}`;
      expect(s.relations[key].truceUntilTurn).toBe(90);
    }

    // no puede sellarse dos veces.
    expect(sellarGranTregua(s).ok).toBe(false);
  });
});

// ======================================================================
// Determinismo
// ======================================================================

describe('determinismo', () => {
  it('misma semilla → mismo estado tras N ticks con escarcha activa', () => {
    function run(): GameState {
      const s = newGame(11);
      const rng = new Rng(9999);
      forceEscarcha(s, rng);
      for (let i = 0; i < 8; i++) {
        tickMythic(s, rng);
        s.turn += 1;
      }
      return s;
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
