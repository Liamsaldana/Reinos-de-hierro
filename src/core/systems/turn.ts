/**
 * Motor de turno por estaciones (GDD §3.2): eventos → gestión → diplomacia →
 * militar → fin de turno (IA, ingresos, atrición, crecimiento, consecuencias).
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { Attributes, BattleReport, Character, CharacterId, FactionId, GameState } from '../types';
import { seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import { runFactionAI } from '../ai/factionAI';
import { getUnitType } from '../content/units';
import {
  armiesOf, clamp, foodConsumption, foodProduction, manpowerCap, manpowerGain, provincesOf,
  taxIncome, upkeepCost,
} from './economy';

export interface TurnSummary {
  /** avisos para la UI, en español ("Otoño: la cosecha llena los graneros") */
  messages: string[];
  /** batallas resueltas durante los turnos de la IA */
  battles: BattleReport[];
  gameOver: boolean;
}

function livingFactionIds(state: GameState): FactionId[] {
  return Object.keys(state.factions).filter(id => state.factions[id].alive);
}

function uniqueCharacterId(state: GameState, factionId: FactionId): CharacterId {
  let n = 1;
  let id = `char_${factionId}_${n}`;
  while (state.characters[id]) {
    n += 1;
    id = `char_${factionId}_${n}`;
  }
  return id;
}

function clearGeneralRefs(state: GameState, characterId: CharacterId): void {
  for (const army of Object.values(state.armies)) {
    if (army.generalId === characterId) army.generalId = null;
  }
}

/**
 * Cierra el turno del jugador y ejecuta el mundo:
 * ingresos/mantenimiento, comida y atrición, regeneración de levas,
 * turnos de las IA (reclutan/mueven/atacan), edad y muerte de personajes
 * (sucesión), agotamiento bélico, chequeo de victoria/derrota, turn++.
 */
export function endTurn(state: GameState, rng: Rng): TurnSummary {
  const playerId = state.playerFactionId;
  const chronicleStart = state.chronicle.length;
  const playerMessages: string[] = [];
  const battles: BattleReport[] = [];
  const currentSeason = seasonOf(state.turn); // estación de ESTE turno, antes de turn++

  // 1. Snapshot ya tomado arriba (chronicleStart).

  // 2. IA: cada facción viva no jugadora ejecuta su turno.
  const battleBeforeAI = state.lastBattle;
  for (const factionId of livingFactionIds(state)) {
    if (state.factions[factionId].ai === 'player') continue;
    runFactionAI(state, rng, factionId);
  }
  if (state.lastBattle && state.lastBattle !== battleBeforeAI) {
    const rep = state.lastBattle;
    if (rep.attacker.factionId === playerId || rep.defender.factionId === playerId) {
      battles.push(rep);
    }
  }

  // 3. Economía: ingresos - mantenimiento.
  for (const factionId of livingFactionIds(state)) {
    const faction = state.factions[factionId];
    const income = taxIncome(state, factionId, currentSeason);
    const upkeep = upkeepCost(state, factionId);
    const net = Math.floor(income - upkeep);
    faction.gold += net;
    let payFailed = false;
    if (faction.gold < 0) {
      faction.gold = 0;
      payFailed = true;
      for (const army of armiesOf(state, factionId)) {
        for (const u of army.units) {
          u.morale = Math.max(0, Math.floor(u.morale * 0.9));
        }
      }
    }
    if (factionId === playerId) {
      playerMessages.push(`Ingresos netos: ${net >= 0 ? '+' : ''}${net} de oro.`);
      if (payFailed) playerMessages.push('Las pagas no llegan: la tropa pierde moral.');
    }
  }

  // 4. Comida: producción - consumo, atrición si hay déficit.
  for (const factionId of livingFactionIds(state)) {
    const faction = state.factions[factionId];
    const prod = foodProduction(state, factionId, currentSeason);
    const cons = foodConsumption(state, factionId);
    faction.foodStock += prod - cons;
    if (faction.foodStock < 0) {
      faction.foodStock = 0;
      for (const army of armiesOf(state, factionId)) {
        for (const u of army.units) {
          let loss = Math.floor(u.men * 0.06);
          if (u.men > 10 && loss < 1) loss = 1;
          u.men = Math.max(0, u.men - loss);
        }
      }
      if (factionId === playerId) playerMessages.push('El hambre muerde a las huestes.');
    }
  }

  // 5. Levas, moral, movimiento; limpiar unidades/ejércitos vacíos.
  for (const factionId of livingFactionIds(state)) {
    const faction = state.factions[factionId];
    const gain = manpowerGain(state, factionId);
    const cap = manpowerCap(state, factionId);
    faction.manpower = Math.min(cap, faction.manpower + gain);
    if (factionId === playerId) {
      playerMessages.push(`Levas: +${gain} (reserva ${faction.manpower}).`);
    }

    for (const army of armiesOf(state, factionId)) {
      for (const u of army.units) {
        if (u.men <= 0) continue;
        const type = getUnitType(u.typeId);
        u.morale = Math.min(type.moraleMax, u.morale + 2);
      }
      army.units = army.units.filter(u => u.men > 0);
      army.movement = army.movementMax;
    }
  }
  for (const [armyId, army] of Object.entries(state.armies)) {
    if (army.units.length === 0) delete state.armies[armyId];
  }

  // 6. Invierno (ANTES de turn++): envejecimiento, muerte natural, sucesión.
  if (currentSeason === 3) {
    for (const charId of Object.keys(state.characters)) {
      const c = state.characters[charId];
      if (!c.alive) continue;
      c.age += 1;
      const mortal = c.role === 'ruler' || c.role === 'heir' || c.role === 'general';
      if (mortal && c.age > 52) {
        const deathChance = (c.age - 52) * 0.005;
        if (rng.chance(deathChance)) {
          c.alive = false;
          clearGeneralRefs(state, c.id);
          const faction = state.factions[c.factionId];

          if (c.role === 'heir' && faction.heirId === c.id) {
            faction.heirId = null;
          }

          if (c.role === 'ruler') {
            state.chronicle.push({
              turn: state.turn,
              kind: 'dinastia',
              text: `En el invierno del año ${yearOf(state.turn)}, murió ${c.name}, gobernante de la Casa ${faction.dynastyName}.`,
            });

            if (faction.heirId && state.characters[faction.heirId]?.alive) {
              const heir = state.characters[faction.heirId];
              heir.role = 'ruler';
              faction.rulerId = heir.id;
              faction.heirId = null;
              faction.legitimacy = clamp(faction.legitimacy - 10, 0, 100);
              state.chronicle.push({
                turn: state.turn,
                kind: 'dinastia',
                text: `${heir.name} asciende al trono de la Casa ${faction.dynastyName}.`,
              });
            } else if (faction.id === playerId) {
              state.outcome = 'defeat_extinction';
            } else {
              const attrs: Attributes = {
                martial: rng.int(3, 7),
                stewardship: rng.int(3, 7),
                diplomacy: rng.int(3, 7),
                intrigue: rng.int(3, 7),
              };
              const newRuler: Character = {
                id: uniqueCharacterId(state, faction.id),
                name: `Un primo lejano de la Casa ${faction.dynastyName}`,
                factionId: faction.id,
                role: 'ruler',
                age: 30,
                attributes: attrs,
                traits: [],
                alive: true,
              };
              state.characters[newRuler.id] = newRuler;
              faction.rulerId = newRuler.id;
              state.chronicle.push({
                turn: state.turn,
                kind: 'dinastia',
                text: `${newRuler.name} asume el trono ante la falta de heredero directo.`,
              });
            }
          }
        }
      }
    }
  }

  // 7. Guerras: agotamiento, y eliminación de facciones sin provincias.
  for (const war of state.wars) {
    war.exhaustionAttacker = Math.min(100, war.exhaustionAttacker + 2);
    war.exhaustionDefender = Math.min(100, war.exhaustionDefender + 2);
  }
  for (const factionId of livingFactionIds(state)) {
    const faction = state.factions[factionId];
    const hasProvinces = provincesOf(state, factionId).length > 0;
    if (!hasProvinces) {
      faction.alive = false;
      state.wars = state.wars.filter(
        w => w.attackerId !== factionId && w.defenderId !== factionId,
      );
      for (const [armyId, army] of Object.entries(state.armies)) {
        if (army.factionId === factionId) delete state.armies[armyId];
      }
      state.chronicle.push({
        turn: state.turn,
        kind: 'guerra',
        text: `La Casa ${faction.dynastyName} ha sido borrada del mapa.`,
      });
    }
  }

  // 8. Victoria/derrota del jugador (si aún no hay un desenlace fijado).
  if (state.outcome === 'ongoing') {
    const playerProvinces = provincesOf(state, playerId);
    if (playerProvinces.length === 0) {
      state.outcome = 'defeat_conquered';
    } else {
      const total = state.provinces.length;
      const capitals = state.provinces.filter(p => p.settlement.level === 4);
      const playerCapitals = capitals.filter(p => p.ownerId === playerId);
      const conqueredMost = total > 0 && playerProvinces.length / total >= 0.75;
      const conqueredAllCapitals = capitals.length > 0 && playerCapitals.length === capitals.length;
      if (conqueredMost || conqueredAllCapitals) {
        state.outcome = 'victory_conquest';
      }
    }
  }

  // 9. Fin de turno.
  state.turn += 1;
  state.rngState = rng.state;

  // 10. Mensajes y resultado.
  const newChronicleMessages = state.chronicle.slice(chronicleStart).map(e => e.text);
  const messages = [...newChronicleMessages, ...playerMessages];

  return { messages, battles, gameOver: state.outcome !== 'ongoing' };
}
