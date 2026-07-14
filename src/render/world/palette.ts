/**
 * Paleta y constantes de la dirección de arte del mapa: "cartografía antigua
 * sobre mesa de guerra" (pergamino / sangre / hierro, apagado, sin neón).
 * Autoridad de color LOCAL del renderer del mundo; no toca el contrato del core.
 */
import * as THREE from 'three';
import type { Terrain } from '../../core/types';

/** color cartográfico apagado por tipo de terreno (HEX sRGB). */
export const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: '#8f8a5f',
  forest: '#5c684a',
  hills: '#8a7c58',
  mountain: '#98928a',
  steppe: '#a39262',
  desert: '#b19e6b',
  swamp: '#67705c',
  coast: '#7d8b78',
};

/** tonos de ambientación / UI del mundo. */
export const ART = {
  /** fondo y niebla */
  background: '#14110F',
  /** mar profundo */
  sea: '#232a2d',
  /** cumbres nevadas (mezcla por altura) */
  snow: '#e8e2d2',
  /** luz ambiente cálida */
  ambient: '#d8cdbb',
  /** sol cálido del noroeste */
  sun: '#ffe8c4',
  /** relleno de provincia sin señor */
  neutralOwner: '#55504a',
  /** borde de selección */
  selected: '#EDEBDE',
  /** rojo sangre de destino de movimiento */
  moveRed: '#9c1a1a',
  /** hierro oscuro (bordes de escudo / placas) */
  ironDark: '#1B1716',
  /** tinta pergamino (texto claro) */
  parchment: '#EDE7D6',
} as const;

/** THREE.Color a partir de un HEX. */
export function color(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** aclara un HEX hacia el blanco por `amt` (0..1) y devuelve un THREE.Color. */
export function lighten(hex: string, amt: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt);
}
