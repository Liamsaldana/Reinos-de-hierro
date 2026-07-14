/**
 * Génesis de partida: Valdemar ~40 provincias (GDD §2.1, §4.1), 3 facciones
 * jugables + tierras sin señor, personajes, ejércitos iniciales.
 * AGENTE B: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { CultureId, FactionId, GameState } from '../types';

export interface PlayableFactionDef {
  id: FactionId;
  name: string;
  dynastyName: string;
  cultureId: CultureId;
  blurb: string; // 1 línea para el menú de selección
}

export const PLAYABLE_FACTIONS: PlayableFactionDef[] = [];

export function newGame(seed: number, playerFactionId?: FactionId): GameState {
  void seed; void playerFactionId;
  throw new Error('pendiente: agente B (contenido/mapgen)');
}
