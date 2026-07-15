/**
 * Helpers del harness de simulación (AGENTE I) — solo instrumentación de
 * LECTURA sobre GameState para medir "vida del mundo" a lo largo de una
 * corrida sin jugador. No contiene lógica de juego propia: cada turno se
 * avanza con el `endTurn` real (agente A), igual que hace el store en
 * producción (Rng fresco desde `state.rngState`, nunca Math.random/Date.now).
 */
import type { FactionId, GameState, ProvinceId } from '../../src/core/types';
import { Rng } from '../../src/core/state/rng';
import { endTurn } from '../../src/core/systems/turn';

export interface SimMetrics {
  warsDeclared: number;
  battles: number;
  ownerChanges: number;
}

export function emptyMetrics(): SimMetrics {
  return { warsDeclared: 0, battles: 0, ownerChanges: 0 };
}

/** Foto de qué facción (o null) posee cada provincia, para diffear entre turnos. */
export function snapshotOwners(state: GameState): Map<ProvinceId, FactionId | null> {
  return new Map(state.provinces.map(p => [p.id, p.ownerId]));
}

/**
 * Avanza UN turno completo (sin acciones de jugador) y acumula en `metrics`
 * la actividad de IA observada: guerras declaradas y batallas vistas en la
 * crónica nueva de este turno, y provincias cuyo dueño cambió respecto de
 * `prevOwners`. Devuelve el snapshot de dueños POST-turno, para encadenar la
 * siguiente llamada en un bucle.
 */
export function advanceTurn(
  state: GameState,
  metrics: SimMetrics,
  prevOwners: Map<ProvinceId, FactionId | null>,
): Map<ProvinceId, FactionId | null> {
  const chronicleBefore = state.chronicle.length;
  const rng = new Rng(state.rngState);
  endTurn(state, rng);

  for (let i = chronicleBefore; i < state.chronicle.length; i++) {
    const entry = state.chronicle[i];
    if (entry.kind === 'guerra' && entry.text.includes('declaró la guerra')) metrics.warsDeclared += 1;
    if (entry.kind === 'batalla') metrics.battles += 1;
  }

  const nowOwners = snapshotOwners(state);
  for (const [id, owner] of nowOwners) {
    if (prevOwners.get(id) !== owner) metrics.ownerChanges += 1;
  }

  return nowOwners;
}

/** true si el error es el stub esperado ('pendiente') mientras B/A/D aterrizan. */
export function isPendingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /pendiente/i.test(msg);
}
