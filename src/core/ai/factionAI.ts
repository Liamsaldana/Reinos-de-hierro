/**
 * IA de facción por arquetipo (GDD §2.4, §17.1-2): reglas simples y honestas.
 * consolidated = defensivo/estable · ambitious = expansor · tribal = incursor.
 * AGENTE D: reemplaza el contenido. MANTÉN la firma exportada.
 */
import type { FactionId, GameState } from '../types';
import type { Rng } from '../state/rng';

/** Ejecuta el turno de una facción IA. Devuelve líneas de log (español). */
export function runFactionAI(state: GameState, rng: Rng, factionId: FactionId): string[] {
  void state; void rng; void factionId;
  return [];
}
