import { describe, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { moveArmy } from '../src/core/systems/actions';
import { assaultSiege } from '../src/core/systems/siege';
import { getUnitType } from '../src/core/content/units';
import { Rng } from '../src/core/state/rng';
import type { Army, FactionId, GameState, Province, ProvinceId, UnitInstance, War } from '../src/core/types';

const SEED = 7;
const PLAYER: FactionId = 'casa_varga';
const ENEMY: FactionId = 'clan_haraldsen';

function fixture(garrison: number, fortLevel: 0 | 1 | 2 | 3, attackerUnits: UnitInstance[]) {
  const state = newGame(SEED);
  const army = Object.values(state.armies).find(a => a.factionId === PLAYER) as Army;
  const homeProvince = state.provinces.find(p => p.id === army.provinceId)!;
  const targetProvinceId = homeProvince.neighbors[0];
  const targetProvince = state.provinces.find(p => p.id === targetProvinceId)!;

  targetProvince.ownerId = ENEMY;
  targetProvince.terrain = 'plains';
  targetProvince.settlement = { ...targetProvince.settlement, fortLevel };
  targetProvince.garrison = garrison;

  const war: War = {
    id: 'war_synth', attackerId: PLAYER, defenderId: ENEMY, cb: 'reclamo',
    warScore: 0, exhaustionAttacker: 0, exhaustionDefender: 0, startedTurn: state.turn,
  };
  state.wars.push(war);

  army.units = attackerUnits;

  return { state, armyId: army.id, targetProvinceId, targetProvince };
}

function addCatapults(state: GameState, armyId: string, count: number): void {
  const army = state.armies[armyId];
  const type = getUnitType('catapulta');
  for (let i = 0; i < count; i++) {
    army.units.push({ typeId: 'catapulta', men: type.menMax, morale: type.moraleMax, xp: 0 });
  }
}

function winRate(garrison: number, fortLevel: 0|1|2|3, attackerUnits: UnitInstance[], withEngines: boolean, seeds: number): number {
  let wins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { state, armyId, targetProvinceId } = fixture(garrison, fortLevel, attackerUnits.map(u => ({...u})));
    const rngStart = new Rng(state.rngState);
    moveArmy(state, rngStart, armyId, targetProvinceId);
    if (withEngines) addCatapults(state, armyId, 2);
    const siegeId = state.sieges![0].id;
    const result = assaultSiege(state, new Rng(seed * 1000 + 3), siegeId);
    if (result.battle?.winner === 'attacker') wins++;
  }
  return wins;
}

describe('calibration', () => {
  it('sweep', () => {
    const milicia = (n: number) => ({ typeId: 'milicia', men: n, morale: 8, xp: 0 } as UnitInstance);
    const lanceros = (n: number) => ({ typeId: 'lanceros', men: n, morale: 9, xp: 0 } as UnitInstance);

    const candidates: { label: string; units: UnitInstance[] }[] = [
      { label: '1x milicia32', units: [milicia(32)] },
      { label: '1x milicia34', units: [milicia(34)] },
      { label: '1x milicia36', units: [milicia(36)] },
      { label: '1x milicia38', units: [milicia(38)] },
      { label: '1x milicia40', units: [milicia(40)] },
      { label: '1x milicia42', units: [milicia(42)] },
      { label: '1x milicia44', units: [milicia(44)] },
      { label: '1x milicia46', units: [milicia(46)] },
      { label: '1x milicia48', units: [milicia(48)] },
    ];

    for (const c of candidates) {
      const without = winRate(550, 3, c.units, false, 20);
      const withE = winRate(550, 3, c.units, true, 20);
      console.log(`${c.label}: without=${without}/20 with=${withE}/20`);
    }
  });
});
