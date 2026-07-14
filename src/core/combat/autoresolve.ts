/**
 * Auto-resolución de batalla (GDD §8.4): fuerza + terreno + estación + general
 * + moral + contadores. Es el motor que usa también la IA.
 * AGENTE D: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { Army, BattleReport, FactionId, GameState, ProvinceId } from '../types';
import type { Rng } from '../state/rng';

/** Fuerza efectiva de un ejército (para IA y UI). */
export function armyStrength(state: GameState, army: Army): number {
  void state; void army;
  return 0;
}

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
  void state; void rng; void attackerFactionId; void provinceId;
  throw new Error('pendiente: agente D (combate)');
}
