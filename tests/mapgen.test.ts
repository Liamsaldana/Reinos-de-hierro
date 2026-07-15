import { describe, it, expect } from 'vitest';
import { newGame, PLAYABLE_FACTIONS } from '../src/core/content/newGame';
import { unitTypesFor } from '../src/core/content/units';
import type { CultureId, LuxuryId, Province } from '../src/core/types';

function isContiguous(ids: number[], byId: Map<number, Province>): boolean {
  if (ids.length === 0) return false;
  const set = new Set(ids);
  const seen = new Set<number>([ids[0]]);
  const stack = [ids[0]];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of byId.get(cur)!.neighbors) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === ids.length;
}

describe('mapgen / newGame (Valdemar) — Fase 3: las 5 culturas (GDD §2.2, §2.4)', () => {
  const state = newGame(7);
  const byId = new Map(state.provinces.map(p => [p.id, p]));

  it('genera exactamente 40 provincias', () => {
    expect(state.provinces.length).toBe(40);
  });

  it('nombres de provincia y de asentamiento son todos únicos', () => {
    const provinceNames = state.provinces.map(p => p.name);
    expect(new Set(provinceNames).size).toBe(provinceNames.length);

    const settlementNames = state.provinces.map(p => p.settlement.name);
    expect(new Set(settlementNames).size).toBe(settlementNames.length);
  });

  it('la adyacencia es simétrica y todo id vecino existe', () => {
    for (const p of state.provinces) {
      for (const nId of p.neighbors) {
        const neighbor = byId.get(nId);
        expect(neighbor).toBeDefined();
        expect(neighbor!.neighbors).toContain(p.id);
      }
    }
  });

  it('toda provincia sin dueño tiene guarnición > 0', () => {
    const unowned = state.provinces.filter(p => p.ownerId === null);
    expect(unowned.length).toBeGreaterThan(0);
    for (const p of unowned) {
      expect(p.garrison).toBeGreaterThan(0);
    }
  });

  it('hay exactamente 5 facciones jugables, una por cultura del GDD §2.2', () => {
    expect(PLAYABLE_FACTIONS.length).toBe(5);
    const cultures = new Set(PLAYABLE_FACTIONS.map(f => f.cultureId));
    const expected: CultureId[] = ['aurelios', 'norlander', 'estepara', 'sarradio', 'highland'];
    expect(cultures.size).toBe(5);
    for (const c of expected) expect(cultures.has(c)).toBe(true);
  });

  it('cada una de las 5 facciones jugables tiene exactamente 1 capital (nivel 4, fortLevel 2) y ≥5 provincias contiguas', () => {
    for (const def of PLAYABLE_FACTIONS) {
      const owned = state.provinces.filter(p => p.ownerId === def.id);
      expect(owned.length, `${def.id}: ${owned.length} provincias (se pedían >=5)`).toBeGreaterThanOrEqual(5);

      const capitals = owned.filter(p => p.settlement.level === 4);
      expect(capitals.length, `${def.id}: ${capitals.length} capitales (se pedía 1)`).toBe(1);
      expect(capitals[0].settlement.fortLevel).toBe(2);

      expect(isContiguous(owned.map(p => p.id), byId), `${def.id}: no contiguo`).toBe(true);
    }
  });

  it('las 5 facciones no se solapan y dejan exactamente 5 provincias sin señor (40 - 5×7)', () => {
    const claimed = new Set<number>();
    for (const def of PLAYABLE_FACTIONS) {
      for (const p of state.provinces) {
        if (p.ownerId !== def.id) continue;
        expect(claimed.has(p.id), `provincia ${p.id} reclamada por más de una facción`).toBe(false);
        claimed.add(p.id);
      }
    }
    const unowned = state.provinces.filter(p => p.ownerId === null);
    expect(unowned.length).toBe(5);
  });

  it('newGame(seed) es 100% determinista: mismo seed -> JSON idéntico', () => {
    const a = newGame(7);
    const b = newGame(7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('newGame(seed) con semillas distintas produce partidas distintas', () => {
    const a = newGame(7);
    const b = newGame(8);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('los polígonos tienen >=5 vértices y caen dentro del margen del mundo', () => {
    for (const p of state.provinces) {
      expect(p.polygon.length).toBeGreaterThanOrEqual(5);
      for (const [x, z] of p.polygon) {
        expect(x).toBeGreaterThanOrEqual(-82);
        expect(x).toBeLessThanOrEqual(82);
        expect(z).toBeGreaterThanOrEqual(-52);
        expect(z).toBeLessThanOrEqual(52);
      }
    }
  });

  it('los 5 ejércitos iniciales existen en la capital de su facción con 5 unidades', () => {
    for (const def of PLAYABLE_FACTIONS) {
      const faction = state.factions[def.id];
      expect(faction).toBeDefined();

      const capital = state.provinces.find(p => p.ownerId === def.id && p.settlement.level === 4);
      expect(capital).toBeDefined();

      const army = Object.values(state.armies).find(a => a.factionId === def.id);
      expect(army).toBeDefined();
      expect(army!.provinceId).toBe(capital!.id);
      expect(army!.units.length).toBe(5);
      expect(army!.generalId).not.toBeNull();
    }
  });

  it('unitTypesFor culturales: cada una de las 5 culturas incluye su(s) única(s) y no las de otra cultura', () => {
    const aurelios = unitTypesFor('aurelios').map(u => u.id);
    expect(aurelios).toContain('legionarios_aurelios');
    expect(aurelios).not.toContain('asaltantes_norlander');

    const sarradio = unitTypesFor('sarradio').map(u => u.id);
    expect(sarradio).toContain('lanceros_ligeros_sarradios');
    expect(sarradio).toContain('camelleros_sarradios');
    expect(sarradio).not.toContain('montaneses_highland');
    expect(sarradio).not.toContain('honderos_highland');

    const highland = unitTypesFor('highland').map(u => u.id);
    expect(highland).toContain('montaneses_highland');
    expect(highland).toContain('honderos_highland');
    expect(highland).not.toContain('camelleros_sarradios');
  });

  // ---------- Fase 3: lujos y vidrio ígneo (GDD §5.1, §2.5) ----------

  it('lujos: hay exactamente 8 provincias con luxury, 2 de cada tipo (sal/vino/seda/especias)', () => {
    const withLuxury = state.provinces.filter(p => p.luxury != null);
    expect(withLuxury.length).toBe(8);

    const counts: Record<LuxuryId, number> = { sal: 0, vino: 0, seda: 0, especias: 0 };
    for (const p of withLuxury) counts[p.luxury as LuxuryId] += 1;
    expect(counts.sal).toBe(2);
    expect(counts.vino).toBe(2);
    expect(counts.seda).toBe(2);
    expect(counts.especias).toBe(2);
  });

  it('lujos: sal en costa, vino en llanura, seda en estepa, especias en desierto', () => {
    for (const p of state.provinces) {
      if (p.luxury === 'sal') expect(p.terrain).toBe('coast');
      if (p.luxury === 'vino') expect(p.terrain).toBe('plains');
      if (p.luxury === 'seda') expect(p.terrain).toBe('steppe');
      if (p.luxury === 'especias') expect(p.terrain).toBe('desert');
    }
  });

  it('vidrio ígneo: SOLO Las Fauces lo tiene, y sigue sin señor al empezar la partida', () => {
    const withVidrio = state.provinces.filter(p => p.vidrioIgneo === true);
    expect(withVidrio.length).toBe(1);
    expect(withVidrio[0].name).toBe('Las Fauces');
    expect(withVidrio[0].ownerId).toBeNull();
  });

  // ---------- Fase 3: capa mítica y hegemonía (GDD §2.5, §13.1) ----------

  it('hegemonyStreakPlayer arranca en 0', () => {
    expect(state.hegemonyStreakPlayer).toBe(0);
  });

  // NOTA (AGENTE T): el encargo de esta ola pedía verificar aquí que
  // `state.mythic` sale "inicializado" desde `newGame`. NO lo hicimos así a
  // propósito — ver el comentario en `content/newGame.ts` junto al `return`
  // final: `src/core/mythic/index.ts` (AGENTE S, ya integrado) fija el
  // contrato de que `state.mythic` nace SIN DEFINIR y se crea perezosamente
  // vía `ensureMythic(state)`. `tests/mythic.test.ts` (fuera de nuestra
  // propiedad, ya verde) comprueba explícitamente
  // `expect(s.mythic).toBeUndefined()` justo después de `newGame(...)`;
  // afirmar lo contrario aquí sería o bien falso, o bien un test roto a
  // propósito. Dejamos constancia con un test que verifica el contrato REAL:

  it('mythic: NO se inicializa en newGame (contrato real de core/mythic: nace perezoso vía ensureMythic)', () => {
    expect(state.mythic).toBeUndefined();
  });

  // ---------- determinismo de lujos/vidrio a través de semillas ----------

  it('lujos y vidrio ígneo son deterministas y estables en conteo para cualquier semilla', () => {
    for (const seed of [1, 11, 23, 47, 100]) {
      const s = newGame(seed);
      const withLuxury = s.provinces.filter(p => p.luxury != null);
      expect(withLuxury.length, `seed ${seed}`).toBe(8);
      const withVidrio = s.provinces.filter(p => p.vidrioIgneo === true);
      expect(withVidrio.length, `seed ${seed}`).toBe(1);
      expect(withVidrio[0].name, `seed ${seed}`).toBe('Las Fauces');
    }
  });
});
