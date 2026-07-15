/**
 * Banco de tecnologías v1 (GDD §11): árbol de investigación en 3 ramas
 * (Militar / Economía / Estado) a lo largo de 2 eras (Temprana → Alta Edad
 * Media), con una investigación activa a la vez por facción (Faction.research,
 * ver types.ts). Alcance v1: ~20-25 tecnologías — este banco fija 20, dentro
 * del rango. Cuarta rama, pólvora (JAMÁS) y tercera era quedan para Fase 3.
 *
 * `requires` encadena SIEMPRE dentro de la misma rama; cada tecnología de
 * era 2 exige explícitamente las 3 tecnologías de era 1 de su rama (así se
 * expresa la regla "era 2 exige ≥3 de era 1 de su rama" sin lógica aparte:
 * basta con que `setActiveResearch` valide `requires` contra `done`).
 *
 * AGENTE Q: banco propio. El integrador cablea unlockUnits en recruitUnit
 * (vía research.ts:isUnitUnlocked) y el resto de efectos en economy.ts
 * (vía research.ts:getTechModifiers).
 *
 * ---------------------------------------------------------------------------
 * AGENTE W (Fase 3, GDD §11.1 "el árbol progresa por eras... avanzar de era
 * desbloquea las siguientes ramas", sin pólvora jamás — GDD §17.2 RESUELTA):
 * añade la ERA 3 (~8 tecnologías, ver banner "ERA 3" más abajo), aditiva —
 * ninguna tecnología v1 se toca. `TechEra` se amplía aquí mismo (vive en este
 * archivo, no en types.ts) a `1 | 2 | 3`; `research.ts` no necesita ningún
 * cambio, porque nunca mira el campo `era` — todo el gating sale de
 * `requires` (ver el comentario de arriba), así que la regla "era 3 exige
 * era 2 completa de su rama" se expresa igual: cada tecnología de era 3
 * requiere, EXPLÍCITAMENTE, TODAS las tecnologías de era 2 ya existentes en
 * su rama (2 en militar, 3 en economía, 3 en estado — no hay una rama con 4
 * tecnologías de era 2, así que "todas" es el techo real, más estricto que
 * cualquier cifra fija posible). Costes 130-180 (banda propia de era 3, por
 * encima de la de era 2 ~70-110). `talla_de_vidrio_igneo` no tiene efecto
 * mecánico propio a propósito: la capa mítica (Fase 3, GDD §2.5) la consulta
 * por su id EXACTO cuando aterrice.
 * ---------------------------------------------------------------------------
 */
import type { TechId, UnitTypeId } from '../types';

export type TechBranch = 'militar' | 'economia' | 'estado';
export type TechEra = 1 | 2 | 3;

export interface TechEffects {
  /** unidades de tier 2 que esta tecnología desbloquea para reclutar */
  unlockUnits?: UnitTypeId[];
  /** multiplicador de impuestos (producto entre tecnologías completadas) */
  taxMod?: number;
  /** multiplicador de producción de alimento */
  foodMod?: number;
  /** multiplicador de ganancia de levas (mano de obra) */
  manpowerMod?: number;
  /** subida plana al nivel máximo de fortificación construible (+1 → permite ciudadela nivel 3) */
  fortCapUp?: number;
  /** moral máxima plana añadida a las unidades */
  moraleFlat?: number;
  /** puntos de movimiento planos añadidos a los ejércitos */
  movementUp?: number;
  /** multiplicador del coste de las obras en curso (< 1 = más barato) */
  buildCostMod?: number;
  /** legitimidad plana concedida (uso futuro: dinastía) */
  legitimacyFlat?: number;
  /** opinión plana con otras cortes — declarativo, lo usará diplomacia más adelante */
  opinionFlat?: number;
  /** multiplicador de los puntos de investigación por turno (erudición) */
  researchMod?: number;
}

export interface TechDef {
  id: TechId;
  name: string;
  /** una línea con sabor, en español */
  blurb: string;
  branch: TechBranch;
  era: TechEra;
  /** puntos de investigación necesarios para completarla */
  cost: number;
  /** tecnologías previas requeridas (siempre de la misma rama) */
  requires: TechId[];
  effects: TechEffects;
}

export const TECHS: Record<TechId, TechDef> = {
  // ======================================================================
  // MILITAR — metalurgia, armamento, tácticas, asedio (nunca pólvora)
  // ======================================================================
  escudos_coordinados: {
    id: 'escudos_coordinados',
    name: 'Escudos Coordinados',
    blurb: 'Los pelotones aprenden a cerrar el escudo con el del vecino: una muralla de madera y hierro que no se abre.',
    branch: 'militar', era: 1, cost: 30, requires: [],
    effects: { unlockUnits: ['infanteria_escudo'] },
  },
  ballesta: {
    id: 'ballesta',
    name: 'La Ballesta',
    blurb: 'El gatillo sustituye al brazo: un campesino adiestrado unas semanas basta para atravesar una cota de malla.',
    branch: 'militar', era: 1, cost: 35, requires: [],
    effects: { unlockUnits: ['ballesteros'] },
  },
  estribo: {
    id: 'estribo',
    name: 'El Estribo',
    blurb: 'El jinete que se afianza en el estribo carga con todo el peso del caballo detrás de la lanza.',
    branch: 'militar', era: 1, cost: 35, requires: [],
    effects: { unlockUnits: ['caballeria_choque'] },
  },
  tacticas_de_campana: {
    id: 'tacticas_de_campana',
    name: 'Tácticas de Campaña',
    blurb: 'Los capitanes aprenden a leer el terreno y ordenar la marcha antes de que suene el primer cuerno de batalla.',
    branch: 'militar', era: 1, cost: 30, requires: [],
    effects: { moraleFlat: 1 },
  },
  picas_largas: {
    id: 'picas_largas',
    name: 'Picas Largas',
    blurb: 'Astas de más de cuatro varas, plantadas en tierra: ni el mejor jinete se atreve a cargar contra ese erizo.',
    branch: 'militar', era: 1, cost: 40, requires: ['escudos_coordinados'],
    effects: { unlockUnits: ['piqueros'] },
  },
  ingenios_de_asedio: {
    id: 'ingenios_de_asedio',
    name: 'Ingenios de Asedio',
    blurb: 'Carpinteros y herreros de la hueste aprenden a levantar catapultas en campaña, no solo a asaltar murallas a mano.',
    branch: 'militar', era: 1, cost: 45, requires: ['ballesta', 'tacticas_de_campana'],
    effects: { unlockUnits: ['catapulta'] },
  },
  forja_veterana: {
    id: 'forja_veterana',
    name: 'Forja Veterana',
    blurb: 'El acero se dobla y se templa una y otra vez hasta que corta sin mellarse: así se arma a la guardia veterana.',
    branch: 'militar', era: 2, cost: 90, requires: ['escudos_coordinados', 'ballesta', 'picas_largas'],
    effects: { moraleFlat: 1 },
  },
  doctrina_de_marcha: {
    id: 'doctrina_de_marcha',
    name: 'Doctrina de Marcha',
    blurb: 'Intendencia, relevos de monta y rutas estudiadas: la hueste cubre en un día lo que antes le costaba dos.',
    branch: 'militar', era: 2, cost: 85, requires: ['estribo', 'tacticas_de_campana', 'ingenios_de_asedio'],
    effects: { movementUp: 1 },
  },

  // ======================================================================
  // ECONOMÍA — agricultura, acuñación, comercio, ingeniería
  // ======================================================================
  arado_pesado: {
    id: 'arado_pesado',
    name: 'Arado Pesado',
    blurb: 'La reja de hierro rompe la tierra pesada que el arado de madera apenas arañaba: más surco, más grano.',
    branch: 'economia', era: 1, cost: 30, requires: [],
    effects: { foodMod: 1.1 },
  },
  canteria: {
    id: 'canteria',
    name: 'Cantería',
    blurb: 'Los canteros tallan sillares a escuadra: los muros ya no se conforman con tierra apisonada y madera.',
    branch: 'economia', era: 1, cost: 40, requires: [],
    effects: { fortCapUp: 1 },
  },
  acunacion: {
    id: 'acunacion',
    name: 'Acuñación',
    blurb: 'Cecas condales acuñan moneda de peso fijo: el mercado confía en el cuño y el oro circula más rápido.',
    branch: 'economia', era: 1, cost: 35, requires: ['arado_pesado'],
    effects: { taxMod: 1.1 },
  },
  rutas_de_grano: {
    id: 'rutas_de_grano',
    name: 'Rutas de Grano',
    blurb: 'Caminos y graneros de posta enlazan el campo con la ciudad: la cosecha ya no se pudre esperando carreta.',
    branch: 'economia', era: 2, cost: 80, requires: ['arado_pesado', 'canteria', 'acunacion'],
    effects: { foodMod: 1.1 },
  },
  ferias_francas: {
    id: 'ferias_francas',
    name: 'Ferias Francas',
    blurb: 'Mercaderes de medio continente acuden a ferias libres de peaje: el condado cobra menos por cabeza y más por volumen.',
    branch: 'economia', era: 2, cost: 85, requires: ['arado_pesado', 'canteria', 'acunacion'],
    effects: { taxMod: 1.15 },
  },
  ingenieria_civil: {
    id: 'ingenieria_civil',
    name: 'Ingeniería Civil',
    blurb: 'Grúas, poleas y planos medidos: lo que antes exigía un año de obra ahora se levanta en semanas.',
    branch: 'economia', era: 2, cost: 90, requires: ['arado_pesado', 'canteria', 'acunacion'],
    effects: { buildCostMod: 0.8 },
  },

  // ======================================================================
  // ESTADO — administración, leyes, burocracia
  // ======================================================================
  administracion_condal: {
    id: 'administracion_condal',
    name: 'Administración Condal',
    blurb: 'Escribas y recaudadores condales llevan cuenta de cada aldea: las levas ya no se pierden en la letra pequeña.',
    branch: 'estado', era: 1, cost: 30, requires: [],
    effects: { manpowerMod: 1.1 },
  },
  erudicion: {
    id: 'erudicion',
    name: 'Erudición',
    blurb: 'Copistas, tutores y las primeras escuelas condales: cada tecnología nueva se estudia un poco más deprisa.',
    branch: 'estado', era: 1, cost: 40, requires: [],
    effects: { researchMod: 1.25 },
  },
  leyes_escritas: {
    id: 'leyes_escritas',
    name: 'Leyes Escritas',
    blurb: 'El fuero se escribe y se sella: un trono que gobierna por ley escrita, no solo por la espada, pesa más ante los suyos.',
    branch: 'estado', era: 1, cost: 35, requires: ['administracion_condal'],
    effects: { legitimacyFlat: 1 },
  },
  burocracia: {
    id: 'burocracia',
    name: 'Burocracia',
    blurb: 'Cancillerías permanentes, registros duplicados, sellos numerados: el reino cobra hasta el último cuarto de impuesto.',
    branch: 'estado', era: 2, cost: 80, requires: ['administracion_condal', 'erudicion', 'leyes_escritas'],
    effects: { taxMod: 1.1 },
  },
  levas_reales: {
    id: 'levas_reales',
    name: 'Levas Reales',
    blurb: 'El servicio militar deja de depender del capricho de cada señor local: la corona llama y las aldeas responden.',
    branch: 'estado', era: 2, cost: 90, requires: ['administracion_condal', 'erudicion', 'leyes_escritas'],
    effects: { manpowerMod: 1.15 },
  },
  cancilleria: {
    id: 'cancilleria',
    name: 'Cancillería',
    blurb: 'Enviados permanentes en las cortes vecinas cultivan la buena voluntad de reyes y kanes por igual.',
    branch: 'estado', era: 2, cost: 75, requires: ['administracion_condal', 'erudicion', 'leyes_escritas'],
    effects: { opinionFlat: 5 },
  },

  // ======================================================================
  // ERA 3 — Alta Edad Media tardía (Fase 3, GDD §11.1, §11 "sin pólvora
  // jamás"): cada tecnología exige TODAS las de era 2 ya definidas en su
  // propia rama (ver cabecera del archivo). AGENTE W.
  // ======================================================================
  acero_de_forja_fria: {
    id: 'acero_de_forja_fria',
    name: 'Acero de Forja Fría',
    blurb: 'Se templa el filo en agua de manantial hasta que canta como una campana: dicen los veteranos que iguala al mismísimo acero de las viejas leyendas — y puede que, esta vez, no exageren tanto.',
    branch: 'militar', era: 3, cost: 140, requires: ['forja_veterana', 'doctrina_de_marcha'],
    effects: { moraleFlat: 1 },
  },
  ballesta_pesada: {
    id: 'ballesta_pesada',
    name: 'Ballesta Pesada',
    blurb: 'Armazón reforzado y gancho de acero para tensar el doble de fuerza: no arma a tropa nueva, pero cada ballestero veterano dispara con la confianza de otro siglo.',
    branch: 'militar', era: 3, cost: 135, requires: ['forja_veterana', 'doctrina_de_marcha'],
    effects: { moraleFlat: 1 },
  },
  logistica_de_campana: {
    id: 'logistica_de_campana',
    name: 'Logística de Campaña',
    blurb: 'Depósitos de avanzada, relevos de carro y rutas de intendencia estudiadas palmo a palmo: la hueste marcha sin esperar a sus propios carros de grano.',
    branch: 'militar', era: 3, cost: 150, requires: ['forja_veterana', 'doctrina_de_marcha'],
    effects: { movementUp: 1 },
  },
  talla_de_vidrio_igneo: {
    id: 'talla_de_vidrio_igneo',
    name: 'Talla de Vidrio Ígneo',
    blurb: 'Maestros venidos de las Fauces enseñan a tallar la obsidiana negra en puntas de lanza y flecha: un saber que hasta ahora solo interesaba a supersticiosos y coleccionistas.',
    branch: 'militar', era: 3, cost: 130, requires: ['forja_veterana', 'doctrina_de_marcha'],
    // SIN efecto mecánico propio a propósito: la capa mítica (Fase 3, GDD
    // §2.5) la consulta por id EXACTO 'talla_de_vidrio_igneo' cuando aterrice
    // (isTechDone(state, factionId, 'talla_de_vidrio_igneo')) — este banco
    // solo certifica que la tecnología existe y es alcanzable.
    effects: {},
  },
  banca_de_letras: {
    id: 'banca_de_letras',
    name: 'Banca de Letras',
    blurb: 'Casas de cambio en cada gran feria emiten letras que valen tanto como el oro que prometen: el crédito mueve ejércitos tan bien como la plata contante.',
    branch: 'economia', era: 3, cost: 160, requires: ['rutas_de_grano', 'ferias_francas', 'ingenieria_civil'],
    effects: { taxMod: 1.15 },
  },
  caminos_reales: {
    id: 'caminos_reales',
    name: 'Caminos Reales',
    blurb: 'Calzadas empedradas y postas cada jornada de camino unen mercado con mercado: cobrar peaje nunca fue tan fácil como cuando el camino mismo es tuyo.',
    branch: 'economia', era: 3, cost: 145, requires: ['rutas_de_grano', 'ferias_francas', 'ingenieria_civil'],
    effects: { taxMod: 1.05 },
  },
  cancilleria_mayor: {
    id: 'cancilleria_mayor',
    name: 'Cancillería Mayor',
    blurb: 'Una cancillería permanente, con archivo propio y copistas de sobra, convierte cada tratado estudiado en la corte en una lección para el siguiente erudito.',
    branch: 'estado', era: 3, cost: 170, requires: ['burocracia', 'levas_reales', 'cancilleria'],
    effects: { researchMod: 1.2 },
  },
  ley_de_hierro: {
    id: 'ley_de_hierro',
    name: 'Ley de Hierro',
    blurb: 'La leva deja de ser favor o costumbre: es ley escrita, con cupo fijo por aldea y castigo para quien la esquive. El reino nunca careció tanto de excusas.',
    branch: 'estado', era: 3, cost: 155, requires: ['burocracia', 'levas_reales', 'cancilleria'],
    effects: { manpowerMod: 1.1 },
  },
} as Record<TechId, TechDef>;
