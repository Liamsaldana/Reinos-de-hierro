/**
 * Bancos de nombres (provincias, asentamientos, personajes) para la génesis
 * de partida (GDD §2.1 worldbuilding). Módulo INTERNO del Agente T — no forma
 * parte del contrato público del core; solo lo consume newGame.ts/mapgen.ts.
 *
 * Todo nombre sale de listas curadas + combinatoria determinista vía Rng.
 * Nada de Math.random.
 *
 * Fase 3 (GDD §2.2): suma los bancos de personaje de sarradio y highland.
 * NO suma pools de provincia nuevos: mapgen.ts mantiene las 6 zonas
 * geográficas de siempre (norte/costa/sur/estepa/centro/fauces) sin crear
 * una "región sarradia" o "región highland" separada — sus casas reclaman
 * bloques dentro de esas mismas zonas (ver FACTION_SETUPS en newGame.ts), así
 * que los pools NORTH/COAST/SOUTH/STEPPE/CENTER de abajo ya cubren toda la
 * geografía y no hace falta contenido nuevo aquí.
 */
import type { CultureId, Terrain } from '../types';
import type { Rng } from '../state/rng';

// ---------- nombres de provincia por región (GDD §2.1) ----------
// Norte: Cerca y Yermos Blancos — frío, fortines, piedra gris.
export const NORTH_PROVINCE_NAMES: readonly string[] = [
  'Paso del Cuervo', 'Guardia de la Cerca', 'Roca Alba', 'Alto de los Yermos',
  'Fuerte Gris', 'Vigía del Norte', 'Cresta Helada', 'Paso de Hierro',
  'Atalaya Blanca',
];

// Costa oeste: mar, sal, faros.
export const COAST_PROVINCE_NAMES: readonly string[] = [
  'Puerto de Sal', 'Bahía del Estandarte', 'Puerto Gris', 'Cala del Pescador',
  'Faro de Poniente', 'Ensenada Blanca', 'Puerto Ballena',
];

// Sur árido: dunas, sol, cuencas secas (sin contar Las Fauces, que es fija).
export const SOUTH_PROVINCE_NAMES: readonly string[] = [
  'Arenas Rojas', 'Dunas de Poniente', 'Cuenca Seca', 'Espina del Sur',
  'Arena Negra', 'Yermo Rojo', 'Pozo Amargo', 'Cráter del Sol',
];

/** nombre fijo de la única provincia de montaña volcánica del sur (GDD §2.5). */
export const FAUCES_NAME = 'Las Fauces';

// Estepa este: viento, caballos, horizonte.
export const STEPPE_PROVINCE_NAMES: readonly string[] = [
  'Llanos del Viento', 'Vado de Temuk', 'Campos del Kan', 'Estepa Dorada',
  'Llano del Halcón', 'Vado de la Hierba Alta', 'Campamento del Sol',
  'Paso del Chamán', 'Llanura Ámbar', 'Vado Hondo', 'Estepa Roja',
];

// Centro: llanuras fértiles, bosques, colinas, algún pantano aislado.
export const CENTER_PROVINCE_NAMES: readonly string[] = [
  'Campos Dorados', 'Vega del Río Frío', 'Bosque Alto', 'Colinas Verdes',
  'Vado Ancho', 'Prado del Ciervo', 'Encinar Viejo', 'Marisma Gris',
  'Vega Alta', 'Campo del Alba', 'Robledal', 'Cruce de los Caminos',
  'Soto del Molino', 'Vega Serena',
];

/**
 * Baraja una copia del banco y toma `count` nombres únicos. Lanza si el
 * banco es demasiado pequeño (bug de contenido, mejor fallar ruidoso).
 */
export function takeNames(rng: Rng, pool: readonly string[], count: number): string[] {
  if (count > pool.length) {
    throw new Error(`banco de nombres insuficiente: se pidieron ${count}, hay ${pool.length}`);
  }
  const shuffled = rng.shuffle([...pool]);
  return shuffled.slice(0, count);
}

// ---------- nombres de asentamiento (derivados del nombre de provincia) ----------
// Siempre distinto del nombre "pelado" de la provincia: se antepone un
// prefijo de sabor regional acorde al terreno.
const SETTLEMENT_PREFIXES: Record<Terrain, readonly string[]> = {
  coast: ['Puerto de', 'Bahía de', 'Muelle de'],
  mountain: ['Roca', 'Bastión de', 'Fuerte de'],
  hills: ['Roca', 'Atalaya de', 'Fuerte de'],
  forest: ['Soto de', 'Aldea de', 'Villa de'],
  plains: ['Villa de', 'Aldea de', 'Granja de'],
  swamp: ['Palafito de', 'Aldea de', 'Villa de'],
  steppe: ['Campamento de', 'Vado de', 'Yurta de'],
  desert: ['Oasis de', 'Poblado de', 'Refugio de'],
};

/** prefijos reservados para las capitales de facción (más solemnes). */
const CAPITAL_PREFIXES: readonly string[] = ['Ciudadela de', 'Trono de', 'Corte de'];

export function settlementName(
  rng: Rng, provinceName: string, terrain: Terrain, isCapital: boolean,
): string {
  const pool = isCapital ? CAPITAL_PREFIXES : SETTLEMENT_PREFIXES[terrain];
  const prefix = rng.pick(pool);
  return `${prefix} ${provinceName}`;
}

// ---------- nombres de personaje por cultura (GDD §2.2) ----------
// Aurelios: latinizados. El apellido es la casa dinástica (p.ej. "Varga").
export const AURELIOS_FIRST_NAMES: readonly string[] = [
  'Marcio', 'Aurelio', 'Claudio', 'Valerio', 'Octavio', 'Décimo', 'Tácito',
  'Rufo', 'Cornelio', 'Quinto', 'Livia', 'Octavia', 'Cornelia', 'Valeria',
  'Aurelia', 'Claudia',
];

// Norlander: nórdico/germano. Apellido = clan (p.ej. "Haraldsen").
export const NORLANDER_FIRST_NAMES: readonly string[] = [
  'Sigrun', 'Bjorn', 'Ragna', 'Erik', 'Astrid', 'Ulf', 'Freya', 'Gunnar',
  'Ingrid', 'Sven', 'Halvar', 'Thyra', 'Leif', 'Solveig',
];

// Estepara: mononimia esteparia, sin apellido (Temük, Boru...).
export const ESTEPARA_NAMES: readonly string[] = [
  'Temük', 'Boru', 'Kaya', 'Altan', 'Sarnai', 'Bataar', 'Oyun', 'Nergui',
  'Chulun', 'Tengis', 'Yesu', 'Qara',
];

// Sarradio (Fase 3): levantino/mediterráneo. El "apellido" es un patronímico
// fijo de la casa con partícula "ibn" (p.ej. "ibn Rakim" para Casa Al-Nasir),
// igual de simplificado que Varga/Haraldsen: no se declina por género del
// personaje (mismo criterio que el resto del banco — "Livia Varga" tampoco
// declina 'Varga'). Da nombres como "Zahir ibn Rakim".
export const SARRADIO_FIRST_NAMES: readonly string[] = [
  'Zahir', 'Rashid', 'Tarik', 'Nadim', 'Karim', 'Malik', 'Idris', 'Faisal',
  'Layla', 'Yasmin', 'Soraya', 'Amira', 'Nadia', 'Zaynab', 'Farida', 'Rania',
];

// Highland (Fase 3): celta/gaélico. El "apellido" es un patronímico de clan
// fijo con partícula "mac" (p.ej. "mac Dougal" para Clan Mac Tíre), misma
// simplificación que el resto del banco. Da nombres como "Ewan mac Dougal".
export const HIGHLAND_FIRST_NAMES: readonly string[] = [
  'Ewan', 'Duncan', 'Alasdair', 'Bran', 'Fergus', 'Angus', 'Callum', 'Lachlan',
  'Moira', 'Ailsa', 'Iona', 'Sine', 'Isla', 'Morag', 'Brenna', 'Una',
];

export function firstNamePoolFor(cultureId: CultureId): readonly string[] {
  if (cultureId === 'aurelios') return AURELIOS_FIRST_NAMES;
  if (cultureId === 'norlander') return NORLANDER_FIRST_NAMES;
  if (cultureId === 'sarradio') return SARRADIO_FIRST_NAMES;
  if (cultureId === 'highland') return HIGHLAND_FIRST_NAMES;
  return ESTEPARA_NAMES;
}

/** construye el nombre completo de un personaje según convención cultural. */
export function characterName(rng: Rng, cultureId: CultureId, surname: string | null): string {
  const pool = firstNamePoolFor(cultureId);
  const first = rng.pick(pool);
  return surname ? `${first} ${surname}` : first;
}

// ---------- rasgos (GDD §6.1) ----------
export const TRAIT_BANK: readonly string[] = [
  'valiente', 'cruel', 'astuto', 'enfermizo', 'genio', 'piadoso',
];

/** 1–2 rasgos únicos del banco, determinista. */
export function pickTraits(rng: Rng): string[] {
  const n = rng.int(1, 2);
  const shuffled = rng.shuffle([...TRAIT_BANK]);
  return shuffled.slice(0, n);
}
