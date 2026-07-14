/**
 * Motor de turno por estaciones (GDD §3.2): eventos → gestión → diplomacia →
 * militar → fin de turno (IA, ingresos, atrición, crecimiento, consecuencias).
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { BattleReport, GameState } from '../types';
import type { Rng } from '../state/rng';

export interface TurnSummary {
  /** avisos para la UI, en español ("Otoño: la cosecha llena los graneros") */
  messages: string[];
  /** batallas resueltas durante los turnos de la IA */
  battles: BattleReport[];
  gameOver: boolean;
}

/**
 * Cierra el turno del jugador y ejecuta el mundo:
 * ingresos/mantenimiento, comida y atrición, regeneración de levas,
 * turnos de las IA (reclutan/mueven/atacan), edad y muerte de personajes
 * (sucesión), agotamiento bélico, chequeo de victoria/derrota, turn++.
 */
export function endTurn(state: GameState, rng: Rng): TurnSummary {
  void state; void rng;
  return { messages: ['pendiente: agente A'], battles: [], gameOver: false };
}
