/**
 * Motor de eventos (GDD §12 / §3.2 "Fase de eventos"): propone hasta `max`
 * eventos por turno cuyas condiciones se cumplen, ponderados por `weight`,
 * y resuelve la elección del jugador escribiendo la crónica correspondiente.
 *
 * AGENTE H (eventos): módulo propio. Sin Math.random/Date.now — toda la
 * aleatoriedad sale del `Rng` recibido por parámetro.
 */
import type { GameState } from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import type { GameEventDef, PendingEvent } from './types';
import { EVENT_DEFS } from './defs';

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

/** elige un def al azar entre `defs`, ponderado por `weight` (todos > 0 se asume). */
function pickWeighted(rng: Rng, defs: GameEventDef[]): GameEventDef {
  const total = defs.reduce((sum, d) => sum + Math.max(0, d.weight), 0);
  if (total <= 0) return defs[0];
  let roll = rng.next() * total;
  for (const d of defs) {
    roll -= Math.max(0, d.weight);
    if (roll <= 0) return d;
  }
  return defs[defs.length - 1];
}

function findDef(defId: string): GameEventDef {
  const def = EVENT_DEFS.find(d => d.id === defId);
  if (!def) throw new Error(`Evento desconocido: ${defId}`);
  return def;
}

/**
 * Propone hasta `max` eventos (default 2) para este turno: filtra por
 * `condition`, sortea sin repetir defId con la misma semilla → mismo
 * resultado siempre.
 */
export function rollTurnEvents(state: GameState, rng: Rng, max = 2): PendingEvent[] {
  let candidates = EVENT_DEFS.filter(d => d.condition(state));
  const chosen: GameEventDef[] = [];

  while (chosen.length < max && candidates.length > 0) {
    const pick = pickWeighted(rng, candidates);
    chosen.push(pick);
    candidates = candidates.filter(d => d.id !== pick.id);
  }

  return chosen.map((def) => {
    const built = def.build(state, rng);
    return {
      defId: def.id,
      title: built.title,
      text: built.text,
      choices: built.choices.map(c => c.label),
      payload: built.payload,
    };
  });
}

/**
 * Resuelve la choice elegida por el jugador para un `PendingEvent` ya
 * propuesto: reconstruye el evento a partir de `ev.payload` (sin tirar
 * dados nuevos para objetivos), aplica el `effect` de la choice elegida,
 * escribe una entrada de crónica con el `kind` del def y devuelve las
 * líneas de consecuencia.
 */
export function applyEventChoice(
  state: GameState, rng: Rng, ev: PendingEvent, choiceIndex: number,
): string[] {
  const def = findDef(ev.defId);
  const built = def.build(state, rng, ev.payload);
  const choice = built.choices[choiceIndex];
  if (!choice) {
    throw new Error(`Opción inválida (${choiceIndex}) para el evento "${ev.defId}"`);
  }

  const lines = choice.effect(state, rng, built.payload);

  const summary = lines[0] ?? built.title;
  const lowerFirst = summary.length > 0 ? summary.charAt(0).toLowerCase() + summary.slice(1) : summary;
  state.chronicle.push({
    turn: state.turn,
    kind: def.kind,
    text: `En ${chronicleDateText(state)}, ${lowerFirst}`,
  });

  return lines;
}
