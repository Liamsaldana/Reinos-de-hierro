import { describe, it, expect } from 'vitest';
import { newGame, PLAYABLE_FACTIONS } from '../src/core/content/newGame';
import { unitTypesFor } from '../src/core/content/units';
import type { Province } from '../src/core/types';

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

describe('mapgen / newGame (Valdemar)', () => {
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

  it('cada facción jugable tiene exactamente 1 capital (nivel 4) y ≥6 provincias contiguas', () => {
    for (const def of PLAYABLE_FACTIONS) {
      const owned = state.provinces.filter(p => p.ownerId === def.id);
      expect(owned.length).toBeGreaterThanOrEqual(6);

      const capitals = owned.filter(p => p.settlement.level === 4);
      expect(capitals.length).toBe(1);
      expect(capitals[0].settlement.fortLevel).toBe(2);

      expect(isContiguous(owned.map(p => p.id), byId)).toBe(true);
    }
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

  it('los 3 ejércitos iniciales existen en la capital de su facción con 5 unidades', () => {
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

  it('unitTypesFor culturales: aurelios incluye su única y no la de otra cultura', () => {
    const aurelios = unitTypesFor('aurelios').map(u => u.id);
    expect(aurelios).toContain('legionarios_aurelios');
    expect(aurelios).not.toContain('asaltantes_norlander');
  });
});
