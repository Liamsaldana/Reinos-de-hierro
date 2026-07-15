/**
 * Tests de investigación (GDD §11) — AGENTE Q.
 *
 * NOTA para el integrador: `researchIncome` (economy.ts, agente P) y
 * `content/buildings.ts` viven fuera de esta propiedad; los tests que
 * dependen de la MAGNITUD real de `researchIncome` usan `newGame()` (que sí
 * la ejercita de verdad) y solo asumen que es positiva para una facción con
 * territorio — nunca un valor exacto, así no quedan acoplados a su fórmula.
 * El resto de tests construye un GameState sintético mínimo (sin `newGame`)
 * para no depender de mapgen/contenido de otros agentes.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { UNIT_TYPES } from '../src/core/content/units';
import { TECHS } from '../src/core/content/techs';
import type { TechDef } from '../src/core/content/techs';
import {
  getTechModifiers, isTechDone, isUnitUnlocked, pointsPerTurn, setActiveResearch, tickResearch,
} from '../src/core/systems/research';
import type { Faction, GameState } from '../src/core/types';

// ---------- constructor de estado sintético (sin newGame) ----------

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
    gold: 100,
    manpower: 100,
    foodStock: 100,
    legitimacy: 60,
    alive: true,
    // sin `research`: a propósito en el caso base, para ejercitar el fallback
    // opcional (Faction.research OPCIONAL, ver types.ts).
    ...overrides,
  };
}

/** Un solo reino jugador ('f1'), sin provincias — researchIncome no las necesita (base fija + edificios). */
function mkState(overrides: Partial<Faction> = {}): GameState {
  return {
    version: 1,
    seed: 1,
    turn: 0,
    playerFactionId: 'f1',
    provinces: [],
    factions: { f1: mkFaction('f1', overrides) },
    characters: {},
    armies: {},
    wars: [],
    relations: {},
    chronicle: [],
    rngState: 1,
    lastBattle: null,
    outcome: 'ongoing',
  };
}

/** Estado con dos facciones vivas, para distinguir jugador de IA en tickResearch. */
function mkTwoFactionState(): GameState {
  const s = mkState();
  s.factions.f2 = mkFaction('f2');
  return s;
}

function findTech(id: string): TechDef {
  const t = TECHS[id];
  if (!t) throw new Error(`tech de prueba no encontrada: ${id}`);
  return t;
}

// ======================================================================
// setActiveResearch
// ======================================================================

describe('setActiveResearch', () => {
  it('acepta una tecnología de era 1 sin requisitos', () => {
    const s = mkState();
    const r = setActiveResearch(s, 'f1', 'escudos_coordinados');
    expect(r.ok).toBe(true);
    expect(s.factions.f1.research?.active).toBe('escudos_coordinados');
    expect(s.factions.f1.research?.points).toBe(0);
  });

  it('rechaza una tecnología de era 2 sin sus requisitos de era 1', () => {
    const s = mkState();
    const r = setActiveResearch(s, 'f1', 'forja_veterana');
    expect(r.ok).toBe(false);
    expect(s.factions.f1.research?.active ?? null).toBeNull();
  });

  it('permite una tecnología de era 2 una vez completados sus 3 requisitos de era 1 de la misma rama', () => {
    const s = mkState({ research: { active: null, points: 0, done: ['escudos_coordinados', 'ballesta', 'picas_largas'] } });
    const r = setActiveResearch(s, 'f1', 'forja_veterana');
    expect(r.ok).toBe(true);
    expect(s.factions.f1.research?.active).toBe('forja_veterana');
  });

  it('rechaza una tecnología ya investigada', () => {
    const s = mkState({ research: { active: null, points: 0, done: ['escudos_coordinados'] } });
    const r = setActiveResearch(s, 'f1', 'escudos_coordinados');
    expect(r.ok).toBe(false);
  });

  it('rechaza un id de tecnología desconocido', () => {
    const s = mkState();
    const r = setActiveResearch(s, 'f1', 'no_existe');
    expect(r.ok).toBe(false);
  });

  it('rechaza una facción desconocida', () => {
    const s = mkState();
    const r = setActiveResearch(s, 'fantasma', 'escudos_coordinados');
    expect(r.ok).toBe(false);
  });

  it('cambiar de tecnología activa reinicia los puntos acumulados', () => {
    const s = mkState({ research: { active: 'escudos_coordinados', points: 20, done: [] } });
    const r = setActiveResearch(s, 'f1', 'ballesta');
    expect(r.ok).toBe(true);
    expect(s.factions.f1.research?.active).toBe('ballesta');
    expect(s.factions.f1.research?.points).toBe(0);
  });

  it('reseleccionar la misma tecnología activa NO reinicia los puntos', () => {
    const s = mkState({ research: { active: 'escudos_coordinados', points: 15, done: [] } });
    const r = setActiveResearch(s, 'f1', 'escudos_coordinados');
    expect(r.ok).toBe(true);
    expect(s.factions.f1.research?.points).toBe(15);
  });
});

// ======================================================================
// tickResearch
// ======================================================================

describe('tickResearch', () => {
  it('sin investigación activa no hace nada y no revienta con research ausente', () => {
    const s = mkState();
    const messages = tickResearch(s);
    expect(messages).toEqual([]);
    expect(s.factions.f1.research).toBeDefined();
    expect(s.factions.f1.research?.active).toBeNull();
  });

  it('acumula puntos por turno (con newGame, sobre una tecnología real) y termina completándola', () => {
    const state = newGame(11);
    const factionId = state.playerFactionId;
    const cost = findTech('escudos_coordinados').cost;
    expect(setActiveResearch(state, factionId, 'escudos_coordinados').ok).toBe(true);

    let completed = false;
    for (let i = 0; i < 200 && !completed; i++) {
      const before = state.factions[factionId].research!.points;
      tickResearch(state);
      const research = state.factions[factionId].research!;
      if (research.done.includes('escudos_coordinados')) { completed = true; break; }
      // mientras sigue activa, los puntos nunca retroceden
      expect(research.points).toBeGreaterThan(before);
      expect(research.points).toBeLessThan(cost);
    }
    expect(completed).toBe(true);
    const research = state.factions[factionId].research!;
    expect(research.active).toBeNull();
    expect(research.points).toBe(0);
    expect(isTechDone(state, factionId, 'escudos_coordinados')).toBe(true);
  });

  it('la tecnología erudición (researchMod) aumenta los puntos por turno', () => {
    const base = mkState({ research: { active: 'ballesta', points: 0, done: [] } });
    const withErudicion = mkState({ research: { active: 'ballesta', points: 0, done: ['erudicion'] } });

    const baseRate = pointsPerTurn(base, 'f1');
    const boostedRate = pointsPerTurn(withErudicion, 'f1');

    expect(boostedRate).toBeCloseTo(baseRate * 1.25, 6);
  });

  it('al completar añade crónica "mundo" solo para el jugador, y un mensaje para cualquier facción', () => {
    const s = mkTwoFactionState();
    const cost = findTech('escudos_coordinados').cost;
    s.factions.f1.research = { active: 'escudos_coordinados', points: cost - 1, done: [] };
    s.factions.f2.research = { active: 'escudos_coordinados', points: cost - 1, done: [] };

    const messages = tickResearch(s);

    expect(s.factions.f1.research.done).toContain('escudos_coordinados');
    expect(s.factions.f2.research.done).toContain('escudos_coordinados');
    expect(messages.length).toBe(2);
    expect(s.chronicle).toHaveLength(1);
    expect(s.chronicle[0].kind).toBe('mundo');
  });

  it('ignora facciones muertas', () => {
    const s = mkState({ alive: false, research: { active: 'escudos_coordinados', points: 999, done: [] } });
    tickResearch(s);
    expect(s.factions.f1.research?.active).toBe('escudos_coordinados');
    expect(s.factions.f1.research?.done).toEqual([]);
  });

  it('es determinista: mismo estado inicial produce el mismo resultado tras varios turnos', () => {
    function run(): GameState {
      const s = newGame(23);
      setActiveResearch(s, s.playerFactionId, 'escudos_coordinados');
      for (let i = 0; i < 15; i++) tickResearch(s);
      return s;
    }
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ======================================================================
// isTechDone / isUnitUnlocked
// ======================================================================

describe('isTechDone', () => {
  it('false por defecto, incluso sin Faction.research', () => {
    const s = mkState();
    expect(isTechDone(s, 'f1', 'escudos_coordinados')).toBe(false);
  });

  it('true tras marcarla como completada', () => {
    const s = mkState({ research: { active: null, points: 0, done: ['escudos_coordinados'] } });
    expect(isTechDone(s, 'f1', 'escudos_coordinados')).toBe(true);
  });

  it('false para una facción desconocida (no revienta)', () => {
    const s = mkState();
    expect(isTechDone(s, 'fantasma', 'escudos_coordinados')).toBe(false);
  });
});

describe('isUnitUnlocked', () => {
  it('infanteria_escudo: false al inicio, true tras completar escudos_coordinados', () => {
    const s = mkState();
    expect(isUnitUnlocked(s, 'f1', 'infanteria_escudo')).toBe(false);

    s.factions.f1.research = { active: null, points: 0, done: ['escudos_coordinados'] };
    expect(isUnitUnlocked(s, 'f1', 'infanteria_escudo')).toBe(true);
  });

  it('las 5 unidades tier 2 genéricas del árbol están bloqueadas hasta su tecnología', () => {
    const s = mkState();
    const gated: Record<string, string> = {
      infanteria_escudo: 'escudos_coordinados',
      ballesteros: 'ballesta',
      caballeria_choque: 'estribo',
      piqueros: 'picas_largas',
      catapulta: 'ingenios_de_asedio',
    };
    for (const [unitId, techId] of Object.entries(gated)) {
      expect(isUnitUnlocked(s, 'f1', unitId), `${unitId} debería empezar bloqueada`).toBe(false);
      const done = [...(s.factions.f1.research?.done ?? []), techId];
      s.factions.f1.research = { active: null, points: 0, done };
      expect(isUnitUnlocked(s, 'f1', unitId), `${unitId} debería desbloquearse con ${techId}`).toBe(true);
    }
  });

  it('las unidades tier 1 y las únicas culturales siempre están desbloqueadas, con o sin research', () => {
    const withResearch = mkState({ research: { active: null, points: 0, done: [] } });
    const withoutResearch = mkState();
    const freeUnits = Object.values(UNIT_TYPES).filter(u => u.tier === 1 || u.culture !== null);
    expect(freeUnits.length).toBeGreaterThan(0);
    for (const u of freeUnits) {
      expect(isUnitUnlocked(withResearch, 'f1', u.id), `${u.id} (tier ${u.tier})`).toBe(true);
      expect(isUnitUnlocked(withoutResearch, 'f1', u.id), `${u.id} sin research definido`).toBe(true);
    }
  });
});

// ======================================================================
// getTechModifiers
// ======================================================================

describe('getTechModifiers', () => {
  it('defaults neutros sin ninguna tecnología completada, incluso sin Faction.research', () => {
    const s = mkState();
    expect(getTechModifiers(s, 'f1')).toEqual({
      taxMod: 1, foodMod: 1, manpowerMod: 1, moraleFlat: 0, fortCap: 0, buildCostMod: 1, researchMod: 1,
    });
  });

  it('combina varios efectos: producto en los multiplicadores, suma en los planos', () => {
    const s = mkState({
      research: {
        active: null, points: 0,
        done: ['arado_pesado', 'acunacion', 'canteria', 'tacticas_de_campana', 'erudicion'],
      },
    });
    const mods = getTechModifiers(s, 'f1');
    expect(mods.foodMod).toBeCloseTo(1.1, 6);
    expect(mods.taxMod).toBeCloseTo(1.1, 6);
    expect(mods.fortCap).toBe(1);
    expect(mods.moraleFlat).toBe(1);
    expect(mods.researchMod).toBeCloseTo(1.25, 6);
    expect(mods.buildCostMod).toBe(1); // ingenieria_civil no está en `done`
  });

  it('los multiplicadores de la misma familia se multiplican entre sí (era 1 + era 2)', () => {
    const s = mkState({
      research: { active: null, points: 0, done: ['arado_pesado', 'canteria', 'acunacion', 'rutas_de_grano'] },
    });
    // arado_pesado (1.1) * rutas_de_grano (1.1) = 1.21
    expect(getTechModifiers(s, 'f1').foodMod).toBeCloseTo(1.21, 6);
  });

  it('ignora ids de tecnología desconocidos en `done` sin reventar (guardado viejo/contenido retirado)', () => {
    const s = mkState({ research: { active: null, points: 0, done: ['tech_fantasma'] } });
    expect(() => getTechModifiers(s, 'f1')).not.toThrow();
    expect(getTechModifiers(s, 'f1').taxMod).toBe(1);
  });
});

// ======================================================================
// estructura del banco de contenido (content/techs.ts)
// ======================================================================

describe('TECHS (banco de contenido)', () => {
  const all = Object.values(TECHS);

  it('tiene entre 20 y 32 tecnologías (20-25 de v1 + ~8 de era 3, Fase 3 — AGENTE W)', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all.length).toBeLessThanOrEqual(32);
  });

  it('cada entrada usa su propio id como clave, y los ids son únicos', () => {
    for (const [key, tech] of Object.entries(TECHS)) expect(tech.id).toBe(key);
    expect(new Set(all.map(t => t.id)).size).toBe(all.length);
  });

  it('solo usa las 3 ramas del alcance v1 y las eras 1|2|3 (era 3 llegó en Fase 3, AGENTE W)', () => {
    for (const t of all) {
      expect(['militar', 'economia', 'estado']).toContain(t.branch);
      expect([1, 2, 3]).toContain(t.era);
    }
  });

  it('nunca menciona pólvora (invariante del GDD: sin pólvora jamás)', () => {
    for (const t of all) {
      expect(`${t.name} ${t.blurb}`.toLowerCase()).not.toContain('pólvora');
      expect(`${t.name} ${t.blurb}`.toLowerCase()).not.toContain('polvora');
    }
  });

  it('todo `requires` apunta a una tecnología existente de la MISMA rama', () => {
    for (const t of all) {
      for (const reqId of t.requires) {
        const req = TECHS[reqId];
        expect(req, `${t.id} requiere "${reqId}", que no existe`).toBeDefined();
        expect(req.branch, `${t.id} (${t.branch}) requiere "${reqId}" de otra rama (${req.branch})`).toBe(t.branch);
      }
    }
  });

  it('toda tecnología de era 2 exige al menos 3 requisitos de era 1 de su misma rama', () => {
    for (const t of all.filter(x => x.era === 2)) {
      const era1Reqs = t.requires.filter(id => TECHS[id]?.era === 1);
      expect(era1Reqs.length, `${t.id} solo exige ${era1Reqs.length} tecnologías de era 1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('no hay ciclos en `requires`', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    function visit(id: string): void {
      if (done.has(id)) return;
      if (visiting.has(id)) throw new Error(`ciclo detectado en ${id}`);
      visiting.add(id);
      for (const reqId of TECHS[id]?.requires ?? []) visit(reqId);
      visiting.delete(id);
      done.add(id);
    }
    expect(() => { for (const t of all) visit(t.id); }).not.toThrow();
  });

  it('las 5 unidades tier 2 genéricas del GDD quedan cubiertas exactamente una vez por unlockUnits', () => {
    const expected = ['infanteria_escudo', 'ballesteros', 'caballeria_choque', 'piqueros', 'catapulta'];
    const unlocked = all.flatMap(t => t.effects.unlockUnits ?? []);
    for (const unitId of expected) {
      expect(unlocked.filter(u => u === unitId), `${unitId} debería desbloquearse por exactamente una tecnología`).toHaveLength(1);
    }
  });

  it('los costes respetan las bandas del GDD (era 1 ~30-50, era 2 ~70-110, era 3 ~130-180 — AGENTE W)', () => {
    for (const t of all) {
      if (t.era === 1) {
        expect(t.cost).toBeGreaterThanOrEqual(30);
        expect(t.cost).toBeLessThanOrEqual(50);
      } else if (t.era === 2) {
        expect(t.cost).toBeGreaterThanOrEqual(70);
        expect(t.cost).toBeLessThanOrEqual(110);
      } else {
        expect(t.cost).toBeGreaterThanOrEqual(130);
        expect(t.cost).toBeLessThanOrEqual(180);
      }
    }
  });
});
