/**
 * Investigación (Fase 2, GDD §11): una tecnología activa a la vez por
 * facción; los puntos acumulados salen de la economía (`researchIncome`,
 * agente P, en `./economy`) modulados por el `researchMod` de las
 * tecnologías completadas (p.ej. Erudición, ×1.25). Núcleo puro: sin
 * Math.random/Date.now, sin DOM, todo serializable a través de
 * `Faction.research` (types.ts).
 *
 * `Faction.research` es OPCIONAL (partidas/tests de antes de esta fase no lo
 * serializaban): los MUTADORES (`setActiveResearch`, `tickResearch`) lo
 * rellenan con `??=` la primera vez que lo tocan, tal y como pide la
 * consigna. Las CONSULTAS puras (`isTechDone`, `isUnitUnlocked`,
 * `getTechModifiers`) nunca mutan el estado — usan `researchOf()`, que cae a
 * un `ResearchState` vacío local sin escribirlo de vuelta, para no romper la
 * regla de que los lectores no mutan (ni siquiera para "rellenar un default").
 */
import type { FactionId, GameState, ResearchState, TechId, UnitTypeId } from '../types';
import type { ActionResult } from './actions';
import { researchIncome } from './economy';
import { TECHS } from '../content/techs';

const EMPTY_RESEARCH: ResearchState = { active: null, points: 0, done: [] };

/** Lectura defensiva y NO mutante de Faction.research (ver cabecera). */
function researchOf(state: GameState, factionId: FactionId): ResearchState {
  return state.factions[factionId]?.research ?? EMPTY_RESEARCH;
}

/** Tabla inversa unidad → tecnología que la desbloquea, construida una vez desde TECHS. */
const UNIT_UNLOCK_TECH: Partial<Record<UnitTypeId, TechId>> = {};
for (const tech of Object.values(TECHS)) {
  for (const unitId of tech.effects.unlockUnits ?? []) {
    UNIT_UNLOCK_TECH[unitId] = tech.id;
  }
}

/**
 * Puntos de investigación que la facción genera este turno: ingresos de la
 * economía (`researchIncome`) por el `researchMod` agregado de sus
 * tecnologías completadas. Exportada además de para `tickResearch` porque la
 * UI (techPanel) la necesita para el rótulo "Puntos por turno: N".
 */
export function pointsPerTurn(state: GameState, factionId: FactionId): number {
  return researchIncome(state, factionId) * getTechModifiers(state, factionId).researchMod;
}

/**
 * Fija la tecnología activa de la facción. Valida, en este orden: tecnología
 * conocida, no investigada ya, y todos sus `requires` completados. Esto basta
 * para exigir era y "≥3 tecnologías de era 1 de su rama" en las de era 2: esa
 * regla está codificada como `requires` explícitos en content/techs.ts, no
 * como un chequeo de era aparte.
 *
 * Cambiar la activa a media investigación reinicia los puntos acumulados: en
 * v1 `ResearchState` solo guarda un contador, no uno por tecnología.
 */
export function setActiveResearch(state: GameState, factionId: FactionId, techId: TechId): ActionResult {
  const faction = state.factions[factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };

  const tech = TECHS[techId];
  if (!tech) return { ok: false, message: `Tecnología desconocida: ${techId}` };

  faction.research ??= { active: null, points: 0, done: [] };
  const research = faction.research;

  if (research.done.includes(techId)) {
    return { ok: false, message: `${tech.name} ya está investigada.` };
  }

  const missing = tech.requires.filter(id => !research.done.includes(id));
  if (missing.length > 0) {
    const names = missing.map(id => TECHS[id]?.name ?? id).join(', ');
    return { ok: false, message: `Falta investigar antes: ${names}.` };
  }

  if (research.active === techId) {
    return { ok: true, message: `${tech.name} ya es la investigación activa.` };
  }

  research.active = techId;
  research.points = 0;
  return { ok: true, message: `Investigación iniciada: ${tech.name}.` };
}

/**
 * Avanza la investigación de cada facción viva un turno. Devuelve los
 * mensajes en español de las tecnologías completadas (de cualquier
 * facción); si la completa el jugador, además añade una entrada de crónica
 * 'mundo'. El integrador la llama desde `endTurn` (turn.ts).
 */
export function tickResearch(state: GameState): string[] {
  const messages: string[] = [];
  for (const factionId of Object.keys(state.factions)) {
    const faction = state.factions[factionId];
    if (!faction.alive) continue;

    faction.research ??= { active: null, points: 0, done: [] };
    const research = faction.research;
    if (!research.active) continue;

    const tech = TECHS[research.active];
    if (!tech) {
      // Tecnología fantasma (contenido cambiado entre partidas guardadas):
      // se abandona limpiamente en vez de acumular puntos que nunca completan.
      research.active = null;
      research.points = 0;
      continue;
    }

    research.points += pointsPerTurn(state, factionId);
    if (research.points >= tech.cost) {
      research.done.push(tech.id);
      research.active = null;
      research.points = 0;
      const msg = `${faction.dynastyName} completa la investigación de ${tech.name}.`;
      messages.push(msg);
      if (factionId === state.playerFactionId) {
        state.chronicle.push({ turn: state.turn, kind: 'mundo', text: msg });
      }
    }
  }
  return messages;
}

/** true si la facción ya completó esa tecnología. */
export function isTechDone(state: GameState, factionId: FactionId, techId: TechId): boolean {
  return researchOf(state, factionId).done.includes(techId);
}

/**
 * true si la unidad se puede reclutar: ninguna tecnología la desbloquea
 * (tier 1 y únicas culturales, libres desde el inicio) o la tecnología que
 * la desbloquea ya está completada. El integrador la cablea en
 * `recruitUnit` (actions.ts).
 */
export function isUnitUnlocked(state: GameState, factionId: FactionId, typeId: UnitTypeId): boolean {
  const techId = UNIT_UNLOCK_TECH[typeId];
  if (!techId) return true;
  return isTechDone(state, factionId, techId);
}

export interface TechModifiers {
  taxMod: number;
  foodMod: number;
  manpowerMod: number;
  moraleFlat: number;
  fortCap: number;
  buildCostMod: number;
  researchMod: number;
}

/**
 * Agrega los efectos de todas las tecnologías completadas de la facción:
 * producto para los multiplicadores, suma para los planos; defaults
 * neutros si no ha completado nada. El integrador la conecta a economy.ts
 * (taxIncome/foodProduction/manpowerGain) y a construcción/combate para
 * fortCap/buildCostMod/moraleFlat.
 */
export function getTechModifiers(state: GameState, factionId: FactionId): TechModifiers {
  const mods: TechModifiers = {
    taxMod: 1, foodMod: 1, manpowerMod: 1, moraleFlat: 0, fortCap: 0, buildCostMod: 1, researchMod: 1,
  };
  for (const techId of researchOf(state, factionId).done) {
    const fx = TECHS[techId]?.effects;
    if (!fx) continue;
    if (fx.taxMod !== undefined) mods.taxMod *= fx.taxMod;
    if (fx.foodMod !== undefined) mods.foodMod *= fx.foodMod;
    if (fx.manpowerMod !== undefined) mods.manpowerMod *= fx.manpowerMod;
    if (fx.moraleFlat !== undefined) mods.moraleFlat += fx.moraleFlat;
    if (fx.fortCapUp !== undefined) mods.fortCap += fx.fortCapUp;
    if (fx.buildCostMod !== undefined) mods.buildCostMod *= fx.buildCostMod;
    if (fx.researchMod !== undefined) mods.researchMod *= fx.researchMod;
  }
  return mods;
}
