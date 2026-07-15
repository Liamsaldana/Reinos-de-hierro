/**
 * Auto-resolución de batalla (GDD §8.4): fuerza + terreno + estación + general
 * + moral + contadores. Es el motor que usa también la IA.
 * AGENTE D: reemplaza el contenido. MANTÉN las firmas exportadas.
 *
 * Supuestos documentados (para el integrador):
 * - La guarnición pelea con las stats del UnitType 'milicia' (units.ts). Si
 *   ese tipo aún no existe (contenido en paralelo), se usa un fallback local
 *   razonable — pero el balance real depende de que el agente B defina
 *   'milicia' con ese id exacto.
 * - El "menMax" de la guarnición para la fórmula de potencia es su propio
 *   tamaño inicial (así arranca a ratio 1.0 y se degrada con las bajas),
 *   no el menMax del UnitType 'milicia'.
 * - El bando defensor "es dueño de la provincia" (para fortificación) se
 *   fija al INICIO de la batalla (no se re-evalúa si el dueño pierde todas
 *   sus tropas a mitad de combate pero un aliado sigue defendiendo).
 * - El general de cada bando es, entre los ejércitos de ese bando, el de
 *   mayor `martial` vivo con generalId asignado; se fija al inicio.
 * - "hostil" para incluir tropas defensoras = facción en guerra con el
 *   atacante (según state.wars). La guarnición defiende si la provincia no
 *   tiene dueño o su dueño está en guerra con el atacante.
 * - warScore/exhaustion se aplican sobre la primera War que empareja
 *   atacante↔dueño-defensor (en cualquier orden attacker/defender de la War).
 */
import type {
  Army, ArmyId, BattleReport, BattleSideReport, Character, FactionId,
  GameState, Province, ProvinceId, Terrain, UnitCategory, UnitInstance, UnitType,
} from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import { getUnitType } from '../content/units';
import {
  applyCounters, average, categoryFractions, culturalAttackMod,
  distributeCasualties, generalMultiplier, rollWeather, squadPower,
  sumCategories, terrainMods, weatherEffect, ZERO_CATEGORIES,
  type Weather,
} from './modifiers';

const FALLBACK_MILITIA: UnitType = {
  id: 'milicia', name: 'Milicia local', category: 'infantry', tier: 1, culture: null,
  attack: 4, defense: 5, armor: 1, rangedPower: 0, initiative: 1, speed: 3,
  moraleMax: 10, menMax: 100, cost: { gold: 0, manpower: 0 }, upkeep: 0,
};

function getMilitiaType(): UnitType {
  try { return getUnitType('milicia'); } catch { return FALLBACK_MILITIA; }
}

/** Fuerza efectiva de un ejército (para IA y UI). */
export function armyStrength(state: GameState, army: Army): number {
  const faction = state.factions[army.factionId];
  const cultureMod = culturalAttackMod(faction);
  let total = 0;
  for (const u of army.units) {
    if (u.men <= 0) continue;
    let t: UnitType;
    try { t = getUnitType(u.typeId); } catch { continue; }
    const base = (t.attack + t.defense) / 2 + t.rangedPower * 0.4 + t.armor * 0.5;
    const moraleRatio = t.moraleMax > 0 ? Math.max(0, Math.min(1, u.morale / t.moraleMax)) : 0;
    const scaled = base * (u.men / t.menMax) * (1 + u.xp * 0.1) * (0.5 + 0.5 * moraleRatio);
    total += scaled * cultureMod;
  }
  return Math.max(0, total);
}

interface Squad {
  factionId: FactionId | null;
  armyId: ArmyId | null; // null = guarnición
  unit: UnitInstance;    // referencia viva (mutada in-place durante las rondas)
  type: UnitType;
  category: UnitCategory;
}

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some((w) => (w.attackerId === a && w.defenderId === b)
    || (w.attackerId === b && w.defenderId === a));
}

function moraleRatioOf(squads: Squad[]): number {
  const alive = squads.filter((s) => s.unit.men > 0);
  if (!alive.length) return 0;
  const moraleSum = alive.reduce((s, q) => s + q.unit.morale, 0);
  const maxSum = alive.reduce((s, q) => s + q.type.moraleMax, 0);
  return maxSum > 0 ? moraleSum / maxSum : 0;
}

function pickGeneral(state: GameState, squads: Squad[]): { armyId: ArmyId; character: Character } | null {
  let best: { armyId: ArmyId; character: Character } | null = null;
  const seen = new Set<ArmyId>();
  for (const sq of squads) {
    if (!sq.armyId || seen.has(sq.armyId)) continue;
    seen.add(sq.armyId);
    const army = state.armies[sq.armyId];
    if (!army || !army.generalId) continue;
    const ch = state.characters[army.generalId];
    if (!ch || !ch.alive) continue;
    if (!best || ch.attributes.martial > best.character.attributes.martial) {
      best = { armyId: sq.armyId, character: ch };
    }
  }
  return best;
}

const TERRAIN_PHRASE: Record<Terrain, string> = {
  plains: 'en los llanos abiertos',
  hills: 'entre las colinas',
  mountain: 'en las alturas de la montaña',
  forest: 'entre los árboles del bosque',
  swamp: 'en el fango del pantano',
  coast: 'junto a la costa',
  steppe: 'en la estepa abierta',
  desert: 'en las arenas del desierto',
};

const WEATHER_PHRASE: Record<Weather, string> = {
  lluvia: 'Bajo una lluvia fría',
  nieve: 'Bajo la nieve',
  niebla: 'Envuelta en niebla',
  despejado: 'Bajo cielos despejados',
};

const CATEGORY_NAME: Record<UnitCategory, string> = {
  infantry: 'infantería', cavalry: 'caballería', ranged: 'tropa a distancia',
  spear: 'lanceros', siege: 'máquinas de asedio',
};

const CATEGORY_FLAVOR: Record<UnitCategory, string> = {
  infantry: 'sostuvo la línea con escudo y espada',
  cavalry: 'rompió el flanco con una carga decisiva',
  ranged: 'desgastó al enemigo con lluvias de proyectiles',
  spear: 'ancló la formación contra toda carga',
  siege: 'abrió brechas que decidieron el choque',
};

/**
 * Resuelve la batalla en `provinceId` entre el bando atacante (facción dada)
 * y los defensores presentes (ejércitos hostiles + guarnición si la provincia
 * es hostil). MUTA el estado: bajas, moral, ejércitos destruidos/retirados,
 * warScore, crónica y state.lastBattle. Devuelve el parte.
 */
export function resolveBattleAt(
  state: GameState,
  rng: Rng,
  attackerFactionId: FactionId,
  provinceId: ProvinceId,
): BattleReport {
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) throw new Error(`Provincia desconocida: ${provinceId}`);
  // alias estable: TS no propaga el narrowing de `province` dentro de closures
  // anidadas (p.ej. rollGeneralFates), así que las funciones internas usan esto.
  const provinceName = province.name;

  // ---------- bandos ----------
  const attackers: Squad[] = [];
  for (const army of Object.values(state.armies)) {
    if (army.provinceId === provinceId && army.factionId === attackerFactionId) {
      for (const u of army.units) {
        if (u.men <= 0) continue;
        let t: UnitType;
        try { t = getUnitType(u.typeId); } catch { continue; }
        attackers.push({ factionId: army.factionId, armyId: army.id, unit: u, type: t, category: t.category });
      }
    }
  }
  if (attackers.length === 0) throw new Error('No hay atacantes');

  const defenders: Squad[] = [];
  const defenderFactionCandidates: FactionId[] = [];
  for (const army of Object.values(state.armies)) {
    if (army.provinceId === provinceId && army.factionId !== attackerFactionId
      && isAtWar(state, attackerFactionId, army.factionId)) {
      for (const u of army.units) {
        if (u.men <= 0) continue;
        let t: UnitType;
        try { t = getUnitType(u.typeId); } catch { continue; }
        defenders.push({ factionId: army.factionId, armyId: army.id, unit: u, type: t, category: t.category });
      }
      if (!defenderFactionCandidates.includes(army.factionId)) defenderFactionCandidates.push(army.factionId);
    }
  }

  const provinceHostile = province.ownerId === null
    || (province.ownerId !== null && isAtWar(state, attackerFactionId, province.ownerId));
  let garrisonSquad: Squad | null = null;
  if (provinceHostile && province.garrison > 0) {
    const militia = getMilitiaType();
    const clonedType: UnitType = { ...militia, menMax: Math.max(1, province.garrison) };
    const synthetic: UnitInstance = { typeId: militia.id, men: province.garrison, morale: militia.moraleMax, xp: 0 };
    garrisonSquad = {
      factionId: province.ownerId, armyId: null, unit: synthetic, type: clonedType, category: clonedType.category,
    };
    defenders.push(garrisonSquad);
    if (province.ownerId && !defenderFactionCandidates.includes(province.ownerId)) {
      defenderFactionCandidates.push(province.ownerId);
    }
  }

  if (defenders.length === 0) throw new Error('No hay defensores');

  const defenderFactionId: FactionId | null = province.ownerId ?? defenderFactionCandidates[0] ?? null;

  // ---------- clima / terreno ----------
  const season = seasonOf(state.turn);
  const weather = rollWeather(season, rng.next());
  const weatherFx = weatherEffect(weather);
  const terrainFx = terrainMods(province.terrain, weather);
  const fortLevel = province.settlement.fortLevel;
  const defenderOwnsProvince = province.ownerId !== null
    && defenders.some((s) => s.factionId === province.ownerId);

  // ---------- generales ----------
  const attackerGeneral = pickGeneral(state, attackers);
  const defenderGeneral = pickGeneral(state, defenders);

  const attackerMenBefore = attackers.reduce((s, q) => s + q.unit.men, 0);
  const defenderMenBefore = defenders.reduce((s, q) => s + q.unit.men, 0);

  let attackerLosses = 0;
  let defenderLosses = 0;

  function breakdown(squads: Squad[]) {
    const strength: Record<UnitCategory, number> = { ...ZERO_CATEGORIES };
    const menByCat: Record<UnitCategory, number> = { ...ZERO_CATEGORIES };
    let totalMen = 0;
    for (const sq of squads) {
      if (sq.unit.men <= 0) continue;
      const faction = sq.factionId ? state.factions[sq.factionId] : undefined;
      const cultureMod = culturalAttackMod(faction);
      const p = squadPower({
        attack: sq.type.attack, defense: sq.type.defense, armor: sq.type.armor,
        rangedPower: sq.type.rangedPower, men: sq.unit.men, menMax: sq.type.menMax,
        xp: sq.unit.xp, morale: sq.unit.morale, moraleMax: sq.type.moraleMax,
        category: sq.category, weather: weatherFx, terrain: terrainFx, cultureMod,
      });
      strength[sq.category] += p;
      menByCat[sq.category] += sq.unit.men;
      totalMen += sq.unit.men;
    }
    return { strength, menByCat, totalMen };
  }

  function computeStrengths(aliveAttackers: Squad[], aliveDefenders: Squad[]): { sA: number; sB: number } {
    const bA = breakdown(aliveAttackers);
    const bB = breakdown(aliveDefenders);
    const fracA = categoryFractions(bA.menByCat, bA.totalMen);
    const fracB = categoryFractions(bB.menByCat, bB.totalMen);
    const { a, b } = applyCounters(bA.strength, fracA, bB.strength, fracB);
    let sA = sumCategories(a);
    let sB = sumCategories(b);
    sA *= terrainFx.attackerTotalMod;
    sB *= terrainFx.defenderTotalMod;
    if (defenderOwnsProvince) sB *= (1 + fortLevel * 0.12);
    if (attackerGeneral) sA *= generalMultiplier(attackerGeneral.character.attributes.martial, attackerGeneral.character.traits);
    if (defenderGeneral) sB *= generalMultiplier(defenderGeneral.character.attributes.martial, defenderGeneral.character.traits);
    return { sA: Math.max(0, sA), sB: Math.max(0, sB) };
  }

  // ---------- rondas ----------
  let winner: 'attacker' | 'defender' | null = null;
  let attackerBroke = false;
  let defenderBroke = false;
  let roundsFought = 0;
  let lastStrengths = { sA: 0, sB: 0 };

  for (let round = 1; round <= 4; round++) {
    roundsFought = round;
    const aliveAttackers = attackers.filter((s) => s.unit.men > 0);
    const aliveDefenders = defenders.filter((s) => s.unit.men > 0);
    if (aliveAttackers.length === 0) { winner = 'defender'; break; }
    if (aliveDefenders.length === 0) { winner = 'attacker'; break; }

    const { sA, sB } = computeStrengths(aliveAttackers, aliveDefenders);
    lastStrengths = { sA, sB };

    const rollA = 0.85 + rng.next() * 0.30;
    const rollB = 0.85 + rng.next() * 0.30;
    const rawA = sA * rollA * 0.09;
    const rawB = sB * rollB * 0.09;
    const fracDamageToB = Math.min(0.18, rawA / 100);
    const fracDamageToA = Math.min(0.18, rawB / 100);

    const menA = aliveAttackers.reduce((s, q) => s + q.unit.men, 0);
    const menB = aliveDefenders.reduce((s, q) => s + q.unit.men, 0);
    const casToB = Math.floor(fracDamageToB * menB);
    const casToA = Math.floor(fracDamageToA * menA);

    const distB = distributeCasualties(aliveDefenders.map((s) => ({ men: s.unit.men })), casToB);
    const distA = distributeCasualties(aliveAttackers.map((s) => ({ men: s.unit.men })), casToA);

    aliveDefenders.forEach((s, idx) => {
      const c = Math.min(distB[idx], s.unit.men);
      s.unit.men -= c;
      defenderLosses += c;
      if (c > 0) s.unit.morale = Math.max(0, s.unit.morale - (fracDamageToB * 12 + 1.5));
    });
    aliveAttackers.forEach((s, idx) => {
      const c = Math.min(distA[idx], s.unit.men);
      s.unit.men -= c;
      attackerLosses += c;
      if (c > 0) s.unit.morale = Math.max(0, s.unit.morale - (fracDamageToA * 12 + 1.5));
    });

    const aRatio = moraleRatioOf(attackers);
    const dRatio = moraleRatioOf(defenders);
    const aBroke = aRatio < 0.30;
    const dBroke = dRatio < 0.30;
    if (aBroke || dBroke) {
      if (aBroke && dBroke) {
        if (aRatio < dRatio) { winner = 'defender'; attackerBroke = true; }
        else if (dRatio < aRatio) { winner = 'attacker'; defenderBroke = true; }
        else { winner = 'defender'; attackerBroke = true; }
      } else if (aBroke) { winner = 'defender'; attackerBroke = true; } else { winner = 'attacker'; defenderBroke = true; }
      break;
    }
  }

  if (!winner) {
    const aliveAttackers = attackers.filter((s) => s.unit.men > 0);
    const aliveDefenders = defenders.filter((s) => s.unit.men > 0);
    if (aliveAttackers.length === 0) winner = 'defender';
    else if (aliveDefenders.length === 0) winner = 'attacker';
    else {
      const { sA, sB } = computeStrengths(aliveAttackers, aliveDefenders);
      lastStrengths = { sA, sB };
      winner = sA > sB ? 'attacker' : 'defender';
    }
  }

  // ---------- persecución ----------
  const loserSquads = winner === 'attacker' ? defenders : attackers;
  const winnerSquads = winner === 'attacker' ? attackers : defenders;
  let pursuitApplied = 0;
  const loserAlive = loserSquads.filter((s) => s.unit.men > 0);
  if (loserAlive.length > 0) {
    const loserSpeed = average(loserAlive.map((s) => s.type.speed));
    const winnerAlive = winnerSquads.filter((s) => s.unit.men > 0);
    const winnerSpeed = winnerAlive.length ? average(winnerAlive.map((s) => s.type.speed)) : 0;
    const pursuitPct = loserSpeed > winnerSpeed ? 0.02 : 0.05;
    const loserMen = loserAlive.reduce((s, q) => s + q.unit.men, 0);
    const pursuitCas = Math.floor(pursuitPct * loserMen);
    const dist = distributeCasualties(loserAlive.map((s) => ({ men: s.unit.men })), pursuitCas);
    loserAlive.forEach((s, idx) => {
      const c = Math.min(dist[idx], s.unit.men);
      s.unit.men -= c;
      pursuitApplied += c;
      if (winner === 'attacker') defenderLosses += c; else attackerLosses += c;
    });
  }

  // ---------- consecuencias ----------
  const involvedArmyIds = new Set<ArmyId>();
  for (const sq of [...attackers, ...defenders]) if (sq.armyId) involvedArmyIds.add(sq.armyId);

  for (const armyId of involvedArmyIds) {
    const army = state.armies[armyId];
    if (army) army.units = army.units.filter((u) => u.men > 0);
  }

  if (winner === 'attacker') {
    province.garrison = 0;
  } else if (garrisonSquad) {
    province.garrison = Math.max(0, Math.floor(garrisonSquad.unit.men));
  }

  for (const armyId of involvedArmyIds) {
    const army = state.armies[armyId];
    if (army && army.units.length === 0) delete state.armies[armyId];
  }

  const winningSquads = winner === 'attacker' ? attackers : defenders;
  for (const sq of winningSquads) {
    if (sq.armyId && sq.unit.men > 0) sq.unit.xp = Math.min(3, sq.unit.xp + 1);
  }

  const narrativeExtras: string[] = [];

  function rollGeneralFates(squads: Squad[], sideWon: boolean) {
    const seen = new Set<ArmyId>();
    for (const sq of squads) {
      if (!sq.armyId || seen.has(sq.armyId)) continue;
      seen.add(sq.armyId);
      const army = state.armies[sq.armyId];
      if (!army || !army.generalId) continue;
      const ch = state.characters[army.generalId];
      if (!ch || !ch.alive) continue;
      const deathChance = sideWon ? 0.02 : 0.06;
      if (rng.chance(deathChance)) {
        ch.alive = false;
        army.generalId = null;
        state.chronicle.push({
          turn: state.turn, kind: 'dinastia',
          text: `${ch.name}, general de ${state.factions[ch.factionId]?.name ?? ch.factionId}, cayó en la batalla de ${provinceName}.`,
        });
        narrativeExtras.push(`${ch.name} no sobrevivió a la jornada: cayó entre los suyos en ${provinceName}.`);
      } else if (!sideWon && rng.chance(0.06)) {
        narrativeExtras.push(`${ch.name} resultó herido en el fragor del combate, pero vivirá para contarlo.`);
      }
    }
  }
  rollGeneralFates(winner === 'attacker' ? attackers : defenders, true);
  rollGeneralFates(winner === 'attacker' ? defenders : attackers, false);

  const losingArmyIds = Array.from(new Set(
    (winner === 'attacker' ? defenders : attackers).filter((s) => s.armyId).map((s) => s.armyId as ArmyId),
  ));
  let anyDestroyedInRetreat = false;
  for (const armyId of losingArmyIds) {
    const army = state.armies[armyId];
    if (!army) continue; // ya eliminado (aniquilado)
    const dest = province.neighbors.find((nId) => {
      const np = state.provinces.find((pp) => pp.id === nId);
      return np && np.ownerId === army.factionId;
    });
    if (dest !== undefined) {
      army.provinceId = dest;
    } else {
      delete state.armies[armyId];
      anyDestroyedInRetreat = true;
      state.chronicle.push({
        turn: state.turn, kind: 'batalla',
        text: `El ejército derrotado de ${state.factions[army.factionId]?.name ?? army.factionId} fue aniquilado en ${province.name}, sin refugio donde retirarse.`,
      });
    }
  }

  // ---------- warScore ----------
  const war = state.wars.find((w) => defenderFactionId !== null
    && ((w.attackerId === attackerFactionId && w.defenderId === defenderFactionId)
      || (w.attackerId === defenderFactionId && w.defenderId === attackerFactionId)));
  let warScoreDelta = 0;
  if (war && defenderFactionId) {
    const loserIsAttacker = winner === 'defender';
    const loserLosses = loserIsAttacker ? attackerLosses : defenderLosses;
    const winnerLosses = loserIsAttacker ? defenderLosses : attackerLosses;
    const loserMenInitial = loserIsAttacker ? attackerMenBefore : defenderMenBefore;
    const rawDelta = 8 + Math.floor(12 * (loserLosses - winnerLosses) / Math.max(1, loserMenInitial * 0.5));
    const delta = Math.max(4, Math.min(25, rawDelta));
    const winnerFactionIdReal = winner === 'attacker' ? attackerFactionId : defenderFactionId;
    const sign = winnerFactionIdReal === war.attackerId ? 1 : -1;
    war.warScore = Math.max(-100, Math.min(100, war.warScore + sign * delta));
    warScoreDelta = sign * delta;
    if (winnerFactionIdReal === war.attackerId) {
      war.exhaustionDefender = Math.min(100, war.exhaustionDefender + 5);
      war.exhaustionAttacker = Math.min(100, war.exhaustionAttacker + 2);
    } else {
      war.exhaustionAttacker = Math.min(100, war.exhaustionAttacker + 5);
      war.exhaustionDefender = Math.min(100, war.exhaustionDefender + 2);
    }
  }

  // ---------- reporte / narrativa ----------
  const attackerFactionObj = state.factions[attackerFactionId];
  const defenderFactionObj = defenderFactionId ? state.factions[defenderFactionId] : null;
  const attackerName = attackerFactionObj?.name ?? attackerFactionId;
  const defenderName = defenderFactionObj?.name
    ?? (garrisonSquad && defenders.length === 1 ? `la guarnición de ${province.name}` : 'los defensores');
  const winnerName = winner === 'attacker' ? attackerName : defenderName;
  const loserName = winner === 'attacker' ? defenderName : attackerName;

  const decisiveSide = winner === 'attacker' ? attackers : defenders;
  const decisiveBreak = breakdown(decisiveSide.length ? decisiveSide : winningSquads);
  let decisiveCategory: UnitCategory = 'infantry';
  let bestVal = -1;
  (Object.keys(decisiveBreak.strength) as UnitCategory[]).forEach((c) => {
    if (decisiveBreak.strength[c] > bestVal) { bestVal = decisiveBreak.strength[c]; decisiveCategory = c; }
  });
  const decisiveSquad = decisiveSide.find((s) => s.category === decisiveCategory) ?? decisiveSide[0];
  const decisiveUnitName = decisiveSquad ? decisiveSquad.type.name : CATEGORY_NAME[decisiveCategory];

  const narrative: string[] = [];
  narrative.push(
    `${WEATHER_PHRASE[weather]} ${TERRAIN_PHRASE[province.terrain]} de ${province.name}, ${attackerName} desafió a ${defenderName}.`,
  );
  if (attackerGeneral) {
    const traitsTxt = attackerGeneral.character.traits.length ? attackerGeneral.character.traits.join(', ') : 'sin rasgos destacados';
    narrative.push(`${attackerGeneral.character.name} (${traitsTxt}) comandó el asalto atacante.`);
  } else {
    narrative.push('Sin un general al mando, los atacantes avanzaron confiando solo en el número.');
  }
  if (defenderGeneral) {
    const traitsTxt = defenderGeneral.character.traits.length ? defenderGeneral.character.traits.join(', ') : 'sin rasgos destacados';
    narrative.push(`${defenderGeneral.character.name} (${traitsTxt}) organizó la defensa con mano firme.`);
  } else {
    narrative.push('La defensa careció de un general que ordenara la línea.');
  }
  narrative.push(`${decisiveUnitName} de ${winnerName} ${CATEGORY_FLAVOR[decisiveCategory]}.`);
  narrative.push(
    `Tras ${roundsFought} ronda${roundsFought === 1 ? '' : 's'} de choque, ${attackerName} sumó ${attackerLosses} bajas y ${defenderName} sumó ${defenderLosses} bajas.`,
  );
  if (pursuitApplied > 0) {
    narrative.push(`Al romperse, ${loserName} sufrió persecución y perdió ${pursuitApplied} hombres más en la huida.`);
  } else {
    narrative.push(`${loserName} logró retirarse sin que la persecución cobrara más vidas.`);
  }
  narrative.push(...narrativeExtras);
  if (anyDestroyedInRetreat) {
    narrative.push(`Sin tierra propia adyacente donde refugiarse, parte de las huestes de ${loserName} fueron aniquiladas.`);
  }
  narrative.push(`${winnerName} se alzó con la victoria en ${province.name}, ${TERRAIN_PHRASE[province.terrain]}.`);

  const attackerSide: BattleSideReport = {
    factionId: attackerFactionId, menBefore: attackerMenBefore, losses: attackerLosses, moraleBroke: attackerBroke,
  };
  const defenderSide: BattleSideReport = {
    factionId: defenderFactionId, menBefore: defenderMenBefore, losses: defenderLosses, moraleBroke: defenderBroke,
  };

  const report: BattleReport = {
    provinceId, provinceName: province.name, turn: state.turn, season, terrain: province.terrain,
    weather, attacker: attackerSide, defender: defenderSide, winner, narrative, warScoreDelta,
  };

  void lastStrengths; // reservado para depuración futura, no forma parte del contrato

  state.lastBattle = report;
  state.chronicle.push({
    turn: state.turn, kind: 'batalla',
    text: `En el ${SEASON_NAMES[season]} del año ${yearOf(state.turn)}, ${winnerName} venció a ${loserName} en ${province.name}.`,
  });

  return report;
}
