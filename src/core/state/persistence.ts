/**
 * Guardar/cargar (GDD §14.1): JSON → localStorage + exportar/importar archivo.
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { GameState } from '../types';

export interface SaveMeta {
  slot: string;
  savedAt: string; // ISO
  label: string;   // "Casa Varga — Otoño, año 3"
}

export function saveGame(state: GameState, slot?: string): SaveMeta {
  void state; void slot;
  throw new Error('pendiente: agente A');
}

export function loadGame(slot: string): GameState | null {
  void slot;
  return null;
}

export function listSaves(): SaveMeta[] { return []; }

export function deleteSave(slot: string): void { void slot; }

/** Serializa validando versión; lanza con mensaje claro si no es un save válido. */
export function exportSave(state: GameState): string {
  void state;
  throw new Error('pendiente: agente A');
}

export function importSave(json: string): GameState {
  void json;
  throw new Error('pendiente: agente A');
}
