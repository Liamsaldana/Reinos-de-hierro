/**
 * Banco de unidades v1 (GDD §7): 5 categorías × 2 niveles + 1 única por cultura.
 * AGENTE B: reemplaza el contenido de este archivo. MANTÉN las firmas exportadas.
 */
import type { CultureId, UnitType, UnitTypeId } from '../types';

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {};

export function getUnitType(id: UnitTypeId): UnitType {
  const t = UNIT_TYPES[id];
  if (!t) throw new Error(`UnitType desconocido: ${id}`);
  return t;
}

/** Unidades reclutables por una cultura (genéricas + propias). */
export function unitTypesFor(cultureId: CultureId): UnitType[] {
  return Object.values(UNIT_TYPES).filter(u => u.culture === null || u.culture === cultureId);
}
