/**
 * Banco de edificios v1 (Fase 2, GDD §9.1): ~10 edificios que modifican
 * economía, reclutamiento, defensa e investigación de una provincia.
 * AGENTE P: módulo nuevo, propiedad exclusiva.
 *
 * Data-driven (GDD §14.4): balance y sabor viven aquí, no en construction.ts
 * (que solo aplica reglas de cola/oro/turnos) ni en economy.ts (que solo
 * suma `effects`). El sistema de tecnología (otro agente) lee `researchFlat`
 * indirectamente vía `economy.ts:researchIncome()`, nunca importa este
 * archivo — así no se acopla a la forma interna del banco.
 *
 * La mejora de fortificación ('muralla_up') NO vive aquí: es un pseudo-
 * edificio de coste creciente por nivel que gestiona construction.ts
 * directamente sobre `settlement.fortLevel` (no ocupa ranura ni entra en
 * `province.buildings`).
 */
import type { BuildingId } from '../types';

export interface BuildingCost {
  gold: number;
  /** turnos de obra hasta completarse. */
  turns: number;
}

export interface BuildingRequires {
  /** la provincia debe tener el recurso estratégico hierro. */
  iron?: boolean;
  /** la provincia debe tener el recurso estratégico caballos. */
  horses?: boolean;
  /** la provincia debe ser de terreno costero. */
  coast?: boolean;
  /** solo construible en la capital del reino (settlement.level === 4). */
  capital?: boolean;
  /** nivel mínimo de asentamiento (1 aldea .. 4 capital). */
  minSettlementLevel?: 1 | 2 | 3 | 4;
}

export interface BuildingEffects {
  /** oro/turno, se suma en economy.ts:taxIncome. */
  taxFlat?: number;
  /** alimento/turno, se suma en economy.ts:foodProduction. */
  foodFlat?: number;
  /** levas/turno, se suma en economy.ts:manpowerGain (tras el amortiguador 0.5). */
  manpowerFlat?: number;
  /** puntos de investigación/turno, ver economy.ts:researchIncome. */
  researchFlat?: number;
  /** legitimidad/turno (tope +3/turno agregado y +80 acumulado por edificios, ver economy.ts:legitimacyTick). */
  legitimacyFlat?: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** sabor, 1-2 líneas, en español. */
  blurb: string;
  cost: BuildingCost;
  requires?: BuildingRequires;
  effects: BuildingEffects;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  granja: {
    id: 'granja',
    name: 'Granja',
    blurb: 'Rotura y riega más tierra de cultivo: sostiene más bocas y más lanzas.',
    cost: { gold: 40, turns: 2 },
    effects: { foodFlat: 2 },
  },
  mina: {
    id: 'mina',
    name: 'Mina',
    blurb: 'Explota las vetas de hierro de la provincia; sin mena a la vista, no hay nada que picar.',
    cost: { gold: 70, turns: 3 },
    requires: { iron: true },
    effects: { taxFlat: 2 },
  },
  mercado: {
    id: 'mercado',
    name: 'Mercado',
    blurb: 'Plaza de trueque y feria semanal: el oro corre de mano en mano y deja su diezmo.',
    cost: { gold: 55, turns: 2 },
    effects: { taxFlat: 3 },
  },
  puerto: {
    id: 'puerto',
    name: 'Puerto',
    blurb: 'Muelles y grúas para naves de cabotaje: solo se levanta donde el mar besa la muralla.',
    cost: { gold: 75, turns: 3 },
    requires: { coast: true },
    effects: { taxFlat: 3 },
  },
  cuartel: {
    id: 'cuartel',
    name: 'Cuartel',
    blurb: 'Barracones y campo de instrucción: la leva local se entrena antes de que la llamen a filas.',
    cost: { gold: 65, turns: 2 },
    effects: { manpowerFlat: 40 },
  },
  establo: {
    id: 'establo',
    name: 'Establo',
    blurb: 'Cría y doma caballos de guerra donde ya pacen manadas; en v1 solo aporta mozos de cuadra a la '
      + 'leva (el recorte de coste a la caballería queda anotado para cuando el árbol de tecnología lo habilite).',
    cost: { gold: 60, turns: 2 },
    requires: { horses: true },
    effects: { manpowerFlat: 30 },
  },
  fundicion: {
    id: 'fundicion',
    name: 'Fundición',
    blurb: 'Forjas de hierro fundido que espesan el tesoro; el sueño de fundir acero espera a una '
      + 'tecnología que este v1 todavía no tiene.',
    cost: { gold: 85, turns: 3 },
    requires: { iron: true },
    effects: { taxFlat: 2 },
  },
  biblioteca: {
    id: 'biblioteca',
    name: 'Biblioteca',
    blurb: 'Escribas y copistas acumulan saber: alimenta la investigación del reino.',
    cost: { gold: 70, turns: 3 },
    effects: { researchFlat: 2 },
  },
  templo: {
    id: 'templo',
    name: 'Templo',
    blurb: 'Casa de culto que abre las puertas a los predicadores: abarata a la mitad convertir la fe de '
      + 'la provincia y arraiga la legitimidad del trono (tope +80 solo por edificios).',
    cost: { gold: 65, turns: 2 },
    effects: { legitimacyFlat: 1 },
  },
  corte: {
    id: 'corte',
    name: 'Corte',
    blurb: 'Salón de audiencias y cancillería junto al trono: solo tiene sentido en la capital del reino.',
    cost: { gold: 90, turns: 3 },
    requires: { capital: true },
    effects: { legitimacyFlat: 2 },
  },
};

export function getBuilding(id: BuildingId): BuildingDef {
  const def = BUILDINGS[id];
  if (!def) throw new Error(`BuildingDef desconocido: ${id}`);
  return def;
}
