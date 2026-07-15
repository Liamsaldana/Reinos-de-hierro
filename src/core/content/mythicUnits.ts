/**
 * Unidades de la capa mítica (Fase 3, GDD §2.5): los Pálidos de los Yermos
 * Blancos y sus monturas de escarcha. Son contenido de FIN DE PARTIDA que solo
 * aparece cuando comienza la Larga Escarcha (ver `../mythic`).
 *
 * ¿Por qué se registran AQUÍ, con `Object.assign(UNIT_TYPES, {...})`, en vez de
 * dentro de `content/units.ts`?
 *   1. `content/units.ts` es propiedad de otro agente (el banco v1 de 13
 *      unidades jugables) y este módulo no debe tocarlo.
 *   2. El motor de combate (`combat/autoresolve.ts`) y el reclutamiento
 *      (`systems/actions.ts`) resuelven CUALQUIER unidad por `getUnitType(id)`,
 *      que lee del registro compartido `UNIT_TYPES`. Basta con inyectar las dos
 *      unidades en ese mismo registro (efecto de importación) para que las
 *      batallas contra los Pálidos funcionen sin cambiar el contrato del core.
 *   3. Es el MISMO patrón que ya usan `tests/combat.test.ts` y
 *      `tests/tactical.test.ts` para añadir sus unidades de prueba.
 *
 * `mythic/index.ts` importa este módulo por su efecto secundario (registra las
 * unidades al cargarse). Nadie más necesita importarlo.
 *
 * DISEÑO (GDD §2.5): "casi inmunes al acero común" se expresa como ARMADURA
 * brutal (8) + moral máxima que no admite miedo (20 → "no conocen el temor").
 * Su verdadero contrapeso NO son estas stats sino `palidosResistanceFactor`
 * (mythic/index.ts): un ejército sin vidrio ígneo ni acero estelar pega a los
 * Pálidos a 0.45× — el acero común resbala. El coste es ABSURDO a propósito:
 * son una hueste que despierta, no una tropa que nadie recluta.
 */
import type { UnitType } from '../types';
import { UNIT_TYPES } from './units';

/** Coste imposible de pagar (gold del reino ~150, levas ~2200): nadie los recluta. */
const ABSURD_COST = { gold: 999999, manpower: 999999, iron: 999 } as const;

const MYTHIC_UNITS: Record<string, UnitType> = {
  // Infantería de hielo: lenta, implacable, casi inmune al acero común
  // (armadura 8, la más alta del juego junto a los legionarios) y sin miedo
  // (moral 20). Ataque 14: golpea como caballería pesada, a pie.
  palido: {
    id: 'palido', name: 'Pálido de los Yermos', category: 'infantry', tier: 2, culture: null,
    attack: 14, defense: 12, armor: 8, rangedPower: 0, initiative: 6, speed: 6,
    moraleMax: 20, menMax: 100,
    cost: { ...ABSURD_COST }, upkeep: 0,
  },
  // La montura reanimada de los Yermos: caballería rápida (velocidad 16) que
  // abre el flanco de los vivos antes de que puedan formar. Ataque 16, pero
  // menos armadura (6) y pelotón menor (50): es la punta, no el ancla.
  engendro_de_escarcha: {
    id: 'engendro_de_escarcha', name: 'Engendro de Escarcha', category: 'cavalry', tier: 2, culture: null,
    attack: 16, defense: 7, armor: 6, rangedPower: 0, initiative: 12, speed: 16,
    moraleMax: 20, menMax: 50,
    cost: { ...ABSURD_COST }, upkeep: 0,
  },
};

Object.assign(UNIT_TYPES, MYTHIC_UNITS);

/** ids registrados por este módulo (para tests y para `mythic/index.ts`). */
export const MYTHIC_UNIT_IDS = ['palido', 'engendro_de_escarcha'] as const;
