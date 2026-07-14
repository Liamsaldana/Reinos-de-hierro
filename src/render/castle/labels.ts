/**
 * Diccionarios de presentación en español propios de la sede de poder
 * (rasgos, atributos, roles). Puramente cosméticos: el core no sabe de idiomas.
 */
import type { CharacterRole } from '../../core/types';

export const ROLE_ES: Record<CharacterRole, string> = {
  ruler: 'Gobernante',
  heir: 'Heredero',
  general: 'General',
};

export const ATTR_ES: { key: 'martial' | 'stewardship' | 'diplomacy' | 'intrigue'; label: string }[] = [
  { key: 'martial', label: 'Marcial' },
  { key: 'stewardship', label: 'Administración' },
  { key: 'diplomacy', label: 'Diplomacia' },
  { key: 'intrigue', label: 'Intriga' },
];

/** Rasgos del banco (names.ts TRAIT_BANK) con su forma capitalizada y matiz. */
const TRAIT_ES: Record<string, string> = {
  valiente: 'Valiente',
  cruel: 'Cruel',
  astuto: 'Astuto',
  enfermizo: 'Enfermizo',
  genio: 'Genio',
  piadoso: 'Piadoso',
};

export function traitLabel(id: string): string {
  return TRAIT_ES[id] ?? capitalize(id);
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "38 años" con singular correcto. */
export function ageLabel(age: number): string {
  return age === 1 ? '1 año' : `${age} años`;
}
