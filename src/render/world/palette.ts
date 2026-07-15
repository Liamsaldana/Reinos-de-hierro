/**
 * Paleta y constantes de la dirección de arte del mapa: "cartografía antigua
 * sobre mesa de guerra" (pergamino / sangre / hierro, apagado, sin neón) sobre
 * un mar profundo azul-pizarra, silueta de continente al estilo mapa político.
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
  /** fondo y niebla (noche sobre la mesa de guerra) */
  background: '#0b1418',
  /** mar profundo (agua honda) */
  seaDeep: '#15252d',
  /** mar somero (cerca de costa) */
  seaShallow: '#2c414a',
  /** filo de espuma / luz de orilla */
  foam: '#c3cfc2',
  /** playa cálida justo tras la orilla */
  shore: '#938c62',
  /** cumbres nevadas (mezcla por altura) */
  snow: '#e8e2d2',
  /** abeto norteño oscuro */
  firNorth: '#2f4038',
  /** copa de bosque templado */
  firTemperate: '#41533a',
  /** tronco */
  bark: '#3a2f24',
  /** roca desnuda */
  rock: '#6d6a63',
  /** junco de pantano */
  reed: '#7c7f4a',
  /** luz ambiente cálida */
  ambient: '#cdd3d0',
  /** sol cálido del noroeste */
  sun: '#ffe8c4',
  /** relleno de provincia sin señor */
  neutralOwner: '#55504a',
  /** borde de selección */
  selected: '#EDEBDE',
  /** rojo sangre de destino de movimiento / guerra */
  moveRed: '#9c1a1a',
  /** rojo sangre más vivo para pulso de guerra */
  warRed: '#c0362a',
  /** hierro oscuro (bordes de escudo / placas) */
  ironDark: '#1B1716',
  /** piedra de muralla */
  stone: '#8d867a',
  /** piedra en sombra */
  stoneDark: '#5e584e',
  /** madera de tejado de aldea */
  timber: '#6b4a33',
  /** atalaya sin señor */
  greyTower: '#6b665d',
  /** tinta pergamino (texto claro) */
  parchment: '#EDE7D6',
} as const;

/** THREE.Color a partir de un HEX. */
export function color(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** aclara un HEX (o Color) hacia el blanco por `amt` (0..1) y devuelve un THREE.Color. */
export function lighten(hex: string, amt: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt);
}

/** oscurece un HEX (o Color) hacia el negro por `amt` (0..1) y devuelve un THREE.Color. */
export function darken(hex: string, amt: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color('#000000'), amt);
}
