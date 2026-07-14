/**
 * API del motor táctico (GDD §8). El render de batalla (Phaser) SOLO llama
 * estas funciones; la lógica vive aquí (core puro, testeable).
 * AGENTE F: reemplaza los stubs manteniendo EXACTAMENTE las firmas.
 */
import type { BattleReport, FactionId, GameState, ProvinceId } from '../types';
import type { Rng } from '../state/rng';
import type { Formation, HexCoord, TacticalState } from './types';

/** vecinos axiales (pointy-top) — util compartida */
export function hexNeighbors(c: HexCoord): HexCoord[] {
  const d = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  return d.map(([dq, dr]) => ({ q: c.q + dq, r: c.r + dr }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * Crea la batalla táctica desde la capa estratégica: mismo criterio de bandos
 * que resolveBattleAt (ejércitos del atacante vs hostiles + guarnición),
 * mapa generado según terreno/estación de la provincia, despliegue inicial
 * automático en zonas (atacante sur, defensor norte). NO muta GameState.
 */
export function createTacticalBattle(
  state: GameState, rng: Rng, attackerFactionId: FactionId, provinceId: ProvinceId,
): TacticalState {
  void state; void rng; void attackerFactionId; void provinceId;
  throw new Error('pendiente: agente F (motor táctico)');
}

/** Fase de despliegue: recoloca una unidad propia dentro de su zona. */
export function deployUnit(ts: TacticalState, unitId: string, to: HexCoord): boolean {
  void ts; void unitId; void to;
  return false;
}

/** Cierra el despliegue y arranca la ronda 1 (ordena turnQueue por iniciativa). */
export function finishDeployment(ts: TacticalState): void {
  void ts;
  throw new Error('pendiente: agente F');
}

/** Hexes alcanzables por la unidad activa (coste por terreno, ZoC). */
export function legalMoveHexes(ts: TacticalState, unitId: string): HexCoord[] {
  void ts; void unitId;
  return [];
}

/** Ids de unidades enemigas atacables por la unidad (melee adyacente o a alcance). */
export function legalTargets(ts: TacticalState, unitId: string): string[] {
  void ts; void unitId;
  return [];
}

export function moveUnit(ts: TacticalState, unitId: string, to: HexCoord): boolean {
  void ts; void unitId; void to;
  return false;
}

/** Ataque (melee o proyectil). Aplica daño, moral, flanqueo, altura. Devuelve líneas de log nuevas. */
export function attackUnit(ts: TacticalState, attackerUnitId: string, targetUnitId: string): string[] {
  void ts; void attackerUnitId; void targetUnitId;
  return [];
}

/** Cambiar formación consume la acción de la activación. */
export function setFormation(ts: TacticalState, unitId: string, f: Formation): boolean {
  void ts; void unitId; void f;
  return false;
}

/** Habilidad del general del bando de la unidad activa (1 cargo): aura de moral. */
export function useGeneralAbility(ts: TacticalState): string[] {
  void ts;
  return [];
}

/** Termina la activación de la unidad activa; avanza cola/ronda; chequea ruptura. */
export function endActivation(ts: TacticalState): void {
  void ts;
  throw new Error('pendiente: agente F');
}

/** true si la unidad activa pertenece al bando del jugador. */
export function isPlayerTurn(ts: TacticalState): boolean {
  void ts;
  return false;
}

/** Ejecuta la activación completa de la unidad activa cuando es de la IA. */
export function runAIActivation(ts: TacticalState): void {
  void ts;
  throw new Error('pendiente: agente F');
}

/**
 * Vuelca el resultado a la capa estratégica (MUTA GameState): bajas a los
 * ejércitos de origen, guarnición, retirada/eliminación de ejércitos,
 * generales, warScore/exhaustion, crónica y state.lastBattle — mismas reglas
 * y números que resolveBattleAt (autoresolve). Devuelve el BattleReport.
 */
export function applyTacticalResult(state: GameState, rng: Rng, ts: TacticalState): BattleReport {
  void state; void rng; void ts;
  throw new Error('pendiente: agente F');
}
