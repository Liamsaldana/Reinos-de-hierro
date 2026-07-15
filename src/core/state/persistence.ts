/**
 * Guardar/cargar (GDD §14.1): JSON → localStorage + exportar/importar archivo.
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { GameState } from '../types';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';

const KEY_PREFIX = 'rdh_save_';
const DEFAULT_SLOT = 'partida_1';

export interface SaveMeta {
  slot: string;
  savedAt: string; // ISO
  label: string;   // "Casa Varga — Otoño, año 3"
}

interface SaveFile {
  meta: SaveMeta;
  state: GameState;
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function keyFor(slot: string): string {
  return `${KEY_PREFIX}${slot}`;
}

function labelFor(state: GameState): string {
  const faction = state.factions[state.playerFactionId];
  const dynastyName = faction ? faction.dynastyName : 'Casa desconocida';
  return `${dynastyName} — ${SEASON_NAMES[seasonOf(state.turn)]}, año ${yearOf(state.turn)}`;
}

export function saveGame(state: GameState, slot: string = DEFAULT_SLOT): SaveMeta {
  const meta: SaveMeta = {
    slot,
    savedAt: new Date().toISOString(),
    label: labelFor(state),
  };
  if (hasLocalStorage()) {
    const file: SaveFile = { meta, state };
    localStorage.setItem(keyFor(slot), JSON.stringify(file));
  }
  return meta;
}

export function loadGame(slot: string): GameState | null {
  if (!hasLocalStorage()) return null;
  const raw = localStorage.getItem(keyFor(slot));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    return parsed.state ?? null;
  } catch {
    return null;
  }
}

export function listSaves(): SaveMeta[] {
  if (!hasLocalStorage()) return [];
  const out: SaveMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<SaveFile>;
      if (parsed.meta) out.push(parsed.meta);
    } catch {
      // entrada corrupta: se ignora
    }
  }
  return out;
}

export function deleteSave(slot: string): void {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(keyFor(slot));
}

/** Serializa validando versión; lanza con mensaje claro si no es un save válido. */
export function exportSave(state: GameState): string {
  return JSON.stringify(state);
}

function isValidGameState(v: unknown): v is GameState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (s.version !== 1) return false;
  if (!Array.isArray(s.provinces) || s.provinces.length === 0) return false;
  if (!s.factions || typeof s.factions !== 'object') return false;
  if (typeof s.playerFactionId !== 'string') return false;
  return true;
}

export function importSave(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('El archivo no es una partida válida de Reinos de Hierro');
  }
  if (!isValidGameState(parsed)) {
    throw new Error('El archivo no es una partida válida de Reinos de Hierro');
  }
  return parsed;
}
