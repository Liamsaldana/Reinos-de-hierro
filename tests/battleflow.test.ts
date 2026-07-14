/**
 * Integración estratégico↔táctico (integrador): ocupación tras victoria táctica.
 * launchTacticalBattle necesita DOM/Phaser y se verifica en runtime; aquí se
 * cubre la lógica pura de finishTacticalOnMap.
 */
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { finishTacticalOnMap } from '../src/game/battleFlow';
import type { BattleReport, GameState } from '../src/core/types';

function report(state: GameState, provinceId: number, winner: 'attacker' | 'defender'): BattleReport {
  const p = state.provinces.find(pr => pr.id === provinceId)!;
  return {
    provinceId,
    provinceName: p.name,
    turn: state.turn,
    season: 0,
    terrain: p.terrain,
    weather: 'despejado',
    attacker: { factionId: state.playerFactionId, menBefore: 500, losses: 60, moraleBroke: false },
    defender: { factionId: p.ownerId, menBefore: 400, losses: 300, moraleBroke: true },
    winner,
    narrative: ['(test)'],
    warScoreDelta: 10,
  };
}

function scenario(): { state: GameState; enemyProvinceId: number } {
  const state = newGame(7, 'casa_varga');
  const enemy = state.provinces.find(p => p.ownerId === 'clan_haraldsen')!;
  // guerra activa y provincia barrida de defensas (la batalla ya se libró)
  state.wars.push({
    id: 'war_test', attackerId: 'casa_varga', defenderId: 'clan_haraldsen',
    cb: 'reclamo', warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: 0,
  });
  enemy.garrison = 0;
  for (const [id, a] of Object.entries(state.armies)) {
    if (a.provinceId === enemy.id && a.factionId !== 'casa_varga') delete state.armies[id];
  }
  return { state, enemyProvinceId: enemy.id };
}

describe('finishTacticalOnMap', () => {
  it('ocupa la provincia hostil sin defensa cuando gana el atacante', () => {
    const { state, enemyProvinceId } = scenario();
    const before = state.chronicle.length;
    finishTacticalOnMap(state, 'casa_varga', report(state, enemyProvinceId, 'attacker'));
    const p = state.provinces.find(pr => pr.id === enemyProvinceId)!;
    expect(p.ownerId).toBe('casa_varga');
    expect(state.chronicle.length).toBeGreaterThan(before);
    expect(state.wars[0].warScore).toBeGreaterThan(0);
  });

  it('NO ocupa si la provincia sigue defendida (guarnición viva)', () => {
    const { state, enemyProvinceId } = scenario();
    const p = state.provinces.find(pr => pr.id === enemyProvinceId)!;
    p.garrison = 200;
    finishTacticalOnMap(state, 'casa_varga', report(state, enemyProvinceId, 'attacker'));
    expect(p.ownerId).toBe('clan_haraldsen');
  });

  it('NO ocupa cuando gana el defensor', () => {
    const { state, enemyProvinceId } = scenario();
    finishTacticalOnMap(state, 'casa_varga', report(state, enemyProvinceId, 'defender'));
    const p = state.provinces.find(pr => pr.id === enemyProvinceId)!;
    expect(p.ownerId).toBe('clan_haraldsen');
  });
});
