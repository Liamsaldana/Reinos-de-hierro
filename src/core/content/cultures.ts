/**
 * Culturas y religiones v1 (GDD §2.2–2.3).
 * AGENTE B: reemplaza el contenido. MANTÉN las firmas exportadas.
 */
import type { CultureId, ReligionId } from '../types';

export interface CultureDef {
  id: CultureId;
  name: string;
  blurb: string;       // rasgo identitario, 1 línea
  /** multiplicadores suaves (1 = neutro) */
  taxMod: number;
  attackMod: number;
  cavalryMod: number;
}

export interface ReligionDef {
  id: ReligionId;
  name: string;
  blurb: string;
}

export const CULTURES: Record<CultureId, CultureDef> = {} as Record<CultureId, CultureDef>;
export const RELIGIONS: Record<ReligionId, ReligionDef> = {} as Record<ReligionId, ReligionDef>;
