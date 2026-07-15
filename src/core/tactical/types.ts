/**
 * Batalla táctica hexagonal (GDD §8) — contrato de tipos.
 * Core puro: SIN Phaser, SIN DOM. El render (src/render/battle) lee este
 * estado y llama a la API de api.ts. ESTE ARCHIVO ES CONTRATO: no ampliarlo
 * sin pasar por el integrador.
 */
import type { FactionId, ProvinceId, Season, Terrain, UnitTypeId } from '../types';

/** coordenada axial (q, r) — rejilla hexagonal pointy-top */
export interface HexCoord { q: number; r: number }

export type TacticalTerrain = 'llano' | 'bosque' | 'colina' | 'pantano' | 'rio' | 'roca';

export interface TacticalCell {
  coord: HexCoord;
  terrain: TacticalTerrain;
  /** 0 llano, 1 alto (bono a distancia/defensa), 2 cumbre */
  elevation: 0 | 1 | 2;
  /** intransitable (roca, río profundo) */
  blocked: boolean;
}

export type Formation = 'linea' | 'muro_escudos' | 'cuna' | 'dispersa';
export type TacticalSide = 'attacker' | 'defender';

export interface TacticalUnit {
  id: string;
  side: TacticalSide;
  typeId: UnitTypeId;
  name: string;
  /** id del Army de la capa estratégica del que proviene (para aplicar bajas al volver); null = guarnición */
  sourceArmyId: string | null;
  men: number;
  menMax: number;
  morale: number;
  moraleMax: number;
  attack: number;
  defense: number;
  armor: number;
  rangedPower: number;
  /** alcance en hexes; 0 = solo cuerpo a cuerpo */
  range: number;
  initiative: number;
  /** hexes de movimiento por activación */
  speed: number;
  formation: Formation;
  coord: HexCoord;
  hasMoved: boolean;
  hasActed: boolean;
  /** rota: huye del campo (fuera de combate) */
  routed: boolean;
  xp: number;
}

export interface GeneralMod {
  name: string;
  martial: number;
  traits: string[];
  /** usos restantes de habilidad por batalla */
  abilityCharges: number;
}

export type TacticalPhase = 'deployment' | 'battle' | 'finished';

export interface TacticalState {
  provinceId: ProvinceId;
  provinceName: string;
  strategicTerrain: Terrain;
  season: Season;
  weather: string; // 'lluvia' | 'nieve' | 'niebla' | 'despejado'
  cols: number;   // ancho de rejilla (~16)
  rows: number;   // alto (~12)
  cells: TacticalCell[];
  units: TacticalUnit[];
  phase: TacticalPhase;
  round: number;
  /** ids de unidad en orden de iniciativa de la ronda actual */
  turnQueue: string[];
  activeUnitId: string | null;
  attackerFactionId: FactionId;
  defenderFactionId: FactionId | null; // null = guarnición sin señor
  /** lado que controla el jugador humano; null = espectador (no ocurre en v1) */
  playerSide: TacticalSide | null;
  attackerGeneral: GeneralMod | null;
  defenderGeneral: GeneralMod | null;
  /** log narrado en español (se muestra en vivo y alimenta el parte final) */
  log: string[];
  winner: TacticalSide | null;
  /** estado rng embebido para determinismo dentro de la batalla */
  rngState: number;
}
