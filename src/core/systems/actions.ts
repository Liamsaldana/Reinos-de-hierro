/**
 * Acciones del jugador y de la IA (comandos sobre el estado).
 * AGENTE A: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type {
  ArmyId, BattleReport, CasusBelli, FactionId, GameState, ProvinceId, UnitTypeId,
} from '../types';
import type { Rng } from '../state/rng';

export interface ActionResult {
  ok: boolean;
  /** mensaje en español para la UI ("No hay oro suficiente") */
  message: string;
  battle?: BattleReport | null;
}

/**
 * Recluta una unidad en una provincia propia: cobra coste, valida recursos
 * estratégicos del reino (hierro/caballos), y la añade al ejército propio
 * estacionado ahí (o crea uno nuevo).
 */
export function recruitUnit(
  state: GameState, rng: Rng,
  factionId: FactionId, provinceId: ProvinceId, typeId: UnitTypeId,
): ActionResult {
  void state; void rng; void factionId; void provinceId; void typeId;
  return { ok: false, message: 'pendiente: agente A' };
}

/**
 * Mueve un ejército a provincia adyacente (gasta movimiento). Si entra en
 * provincia hostil defendida → batalla (via combat). Si entra en provincia
 * hostil sin defensa → ocupación (cambia dueño, crónica). Respeta guerras:
 * mover a provincia de facción con la que NO hay guerra la declara ilegal
 * (se rechaza; declarar guerra es acción aparte).
 */
export function moveArmy(
  state: GameState, rng: Rng, armyId: ArmyId, toProvinceId: ProvinceId,
): ActionResult {
  void state; void rng; void armyId; void toProvinceId;
  return { ok: false, message: 'pendiente: agente A' };
}

/** Provincias a las que el ejército puede moverse este turno (para UI/IA). */
export function legalMoves(state: GameState, armyId: ArmyId): ProvinceId[] {
  void state; void armyId;
  return [];
}

export function declareWar(
  state: GameState, attackerId: FactionId, defenderId: FactionId, cb: CasusBelli,
): ActionResult {
  void state; void attackerId; void defenderId; void cb;
  return { ok: false, message: 'pendiente: agente A' };
}

/** Paz: 'white' = statu quo; 'concede' = el perdedor cede oro según warScore. */
export function negotiatePeace(
  state: GameState, warId: string, kind: 'white' | 'concede',
): ActionResult {
  void state; void warId; void kind;
  return { ok: false, message: 'pendiente: agente A' };
}
