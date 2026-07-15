/**
 * Comercio y lujos (Fase 3, GDD §10 "poder blando" / §5.1): tratados
 * comerciales, el ingreso que generan (con bonus por lujos complementarios
 * que incentiva rutas reales, no solo firmar papel), la legitimidad que da
 * controlar varios lujos distintos, y el tributo que un vasallo paga a su
 * señor. AGENTE U: módulo nuevo, propiedad exclusiva.
 *
 * Contrato con el resto del núcleo (mismo patrón que `diplomacy.ts`):
 * - Reutiliza `ActionResult` de `./actions` (mismo contrato que el resto de
 *   propuestas diplomáticas).
 * - Duplica helpers internos (`isAtWar`, `getRelation`, `chronicleDateText`)
 *   a propósito — mismo motivo documentado en `diplomacy.ts`: cada módulo es
 *   dueño de sus propios helpers para no crear una dependencia cruzada entre
 *   agentes en paralelo.
 * - `tradeIncome`, `luxuryLegitimacy` y `tributeFlows` son PURAS (no mutan
 *   estado): el integrador las suma en `turn.ts`. Ver "CABLEADO" abajo.
 * - `province.luxury` (GDD §5.1) todavía no lo puebla ningún generador de
 *   contenido (`content/mapgen.ts` nunca lo asigna hoy — verificado; es
 *   `LuxuryId | null | undefined`, opcional desde `types.ts`). Por eso, en
 *   una partida real de hoy, `tradeIncome`/`luxuryLegitimacy` solo aportan
 *   el +2 por tratado (nunca el bonus por lujo distinto ni la legitimidad
 *   por lujos) hasta que algún agente futuro reparta lujos por el mapa —
 *   fuera de mi propiedad esta fase (`content/*` está vetado). La lógica ya
 *   está completa y probada con provincias construidas a mano en
 *   `tests/trade.test.ts`, lista para cuando eso llegue.
 *
 * ---------------------------------------------------------------------------
 * CABLEADO PARA EL INTEGRADOR (no lo hago yo — no toco `turn.ts`):
 *
 * 1) `tradeIncome(state, factionId)` — sumar al ingreso de oro en el paso 3
 *    de `endTurn` (economía), junto a `taxIncome(...)`, ANTES de calcular
 *    `net = Math.floor(income - upkeep)`. Ejemplo (dentro del bucle de
 *    `livingFactionIds`, reemplazando la línea de `income`):
 *      const income = taxIncome(state, factionId, currentSeason) + tradeIncome(state, factionId);
 *
 * 2) `luxuryLegitimacy(state, factionId)` — sumar al delta de legitimidad
 *    del mismo paso 3, junto a `legitimacyTick(...)`, respetando el mismo
 *    `clamp(..., 0, 100)` final que ya aplica `turn.ts`. Ejemplo:
 *      faction.legitimacy = clamp(
 *        faction.legitimacy + legitimacyTick(state, factionId) + luxuryLegitimacy(state, factionId),
 *        0, 100,
 *      );
 *
 * 3) `tributeFlows(state)` — llamar UNA vez (no por facción) en el paso 3,
 *    después de que cada facción ya tenga aplicado su `net` de oro del
 *    turno (así el 15% refleja el ingreso fresco del vasallo, recomendado
 *    — aunque llamarla antes también es válido, siempre que sea consistente
 *    y no se aplique dos veces). Por cada flujo, restar `gold` del vasallo y
 *    sumarlo al señor, con el mismo patrón defensivo que ya usa
 *    `negotiatePeace` (`Math.min(payer.gold, ...)` — aquí no hace falta
 *    porque `tributeFlows` ya calcula sobre `taxIncome`, no sobre la reserva
 *    acumulada, pero conviene no dejar el oro del vasallo en negativo si se
 *    cablea distinto). Ejemplo:
 *      for (const flow of tributeFlows(state)) {
 *        const vassal = state.factions[flow.from];
 *        const lord = state.factions[flow.to];
 *        const paid = Math.min(vassal.gold, flow.gold);
 *        vassal.gold -= paid;
 *        lord.gold += paid;
 *      }
 *    Es PURA y no narra crónica por turno (sería demasiado ruido cada
 *    estación); si se quiere un aviso de UI, el integrador puede construirlo
 *    con el array devuelto.
 * ---------------------------------------------------------------------------
 */
import type {
  DiploRelation, FactionId, GameState, LuxuryId,
} from '../types';
import { relKey, seasonOf, yearOf, SEASON_NAMES } from '../types';
import type { Rng } from '../state/rng';
import type { ActionResult } from './actions';
import { clamp, provincesOf, taxIncome } from './economy';

// ---------- helpers internos (duplicados a propósito, ver docstring) ----------

function isAtWar(state: GameState, a: FactionId, b: FactionId): boolean {
  return state.wars.some(
    (w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a),
  );
}

function getRelation(state: GameState, a: FactionId, b: FactionId): DiploRelation {
  const key = relKey(a, b);
  let rel = state.relations[key];
  if (!rel) {
    rel = { opinion: 0, treaties: [] };
    state.relations[key] = rel;
  }
  return rel;
}

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

/** true si alguna provincia de `aId` linda con una provincia de `bId`. */
function sharesBorder(state: GameState, aId: FactionId, bId: FactionId): boolean {
  for (const p of state.provinces) {
    if (p.ownerId !== aId) continue;
    for (const nId of p.neighbors) {
      const np = state.provinces.find((x) => x.id === nId);
      if (np && np.ownerId === bId) return true;
    }
  }
  return false;
}

/** Lujos distintos que controla la facción (provincias propias con `luxury` fijado). */
function luxuriesOf(state: GameState, factionId: FactionId): Set<LuxuryId> {
  const set = new Set<LuxuryId>();
  for (const p of provincesOf(state, factionId)) {
    if (p.luxury) set.add(p.luxury);
  }
  return set;
}

// ---------- tratado comercial ----------

/**
 * Precondición dura para proponer un tratado comercial (sin guerra, opinión
 * >= -10, sin tratado ya vigente) — consulta PURA, mismo patrón que
 * `marriageRequirement`/`allianceRequirement` en `diplomacy.ts`.
 */
export function tradeRequirement(state: GameState, aId: FactionId, bId: FactionId): string | null {
  const a = state.factions[aId];
  const b = state.factions[bId];
  if (!a || !b) return 'Facción desconocida.';
  if (aId === bId) return 'Una facción no puede comerciar consigo misma.';
  if (isAtWar(state, aId, bId)) return 'No se puede proponer un tratado comercial mientras estáis en guerra.';
  const rel = state.relations[relKey(aId, bId)];
  if ((rel?.opinion ?? 0) < -10) return 'La opinión es demasiado baja para proponer un tratado comercial (mínimo -10).';
  if (rel?.treaties.includes('trade')) return 'Ya existe un tratado comercial entre ambas casas.';
  return null;
}

/**
 * Propone un tratado comercial. La casa objetivo acepta si la opinión ya es
 * >= 0, o si comparte frontera con el proponente (la ruta ya existe de
 * facto: solo falta sellarla) — sin tirada propia, mismo espíritu que
 * `formAlliance` (los umbrales ya arbitran). Aceptado: treaty 'trade',
 * opinión +10, crónica 'economia'.
 */
export function proposeTradeTreaty(
  state: GameState, rng: Rng, aId: FactionId, bId: FactionId,
): ActionResult {
  void rng;
  const reason = tradeRequirement(state, aId, bId);
  if (reason) return { ok: false, message: reason };

  const a = state.factions[aId];
  const b = state.factions[bId];
  const rel = getRelation(state, aId, bId);

  const accepted = rel.opinion >= 0 || sharesBorder(state, aId, bId);
  if (!accepted) {
    return {
      ok: false,
      message: `La Casa ${b.dynastyName} declina el tratado comercial propuesto por la Casa ${a.dynastyName}.`,
    };
  }

  rel.treaties.push('trade');
  rel.opinion = clamp(rel.opinion + 10, -100, 100);
  state.chronicle.push({
    turn: state.turn,
    kind: 'economia',
    text: `En ${chronicleDateText(state)}, la Casa ${a.dynastyName} y la Casa ${b.dynastyName} sellaron un tratado comercial.`,
  });

  return {
    ok: true,
    message: `La Casa ${b.dynastyName} acepta el tratado comercial con la Casa ${a.dynastyName}.`,
  };
}

// ---------- ingresos e incentivos (PURAS, para el integrador) ----------

/**
 * Ingreso de oro por comercio de la facción este turno: +2 de oro por cada
 * tratado comercial vigente, +1 adicional por cada lujo DISTINTO que ese
 * socio controle y la facción NO — incentiva rutas con socios complementarios
 * en vez de tratados vacíos. PURA.
 */
export function tradeIncome(state: GameState, factionId: FactionId): number {
  if (!state.factions[factionId]) return 0;
  const mine = luxuriesOf(state, factionId);
  let total = 0;
  for (const otherId of Object.keys(state.factions)) {
    if (otherId === factionId) continue;
    const other = state.factions[otherId];
    if (!other || !other.alive) continue;
    const rel = state.relations[relKey(factionId, otherId)];
    if (!rel?.treaties.includes('trade')) continue;
    total += 2;
    for (const lux of luxuriesOf(state, otherId)) {
      if (!mine.has(lux)) total += 1;
    }
  }
  return total;
}

/**
 * Legitimidad que dan los lujos controlados: +1 con 2 lujos distintos o más,
 * +2 con 3 o más (tope: no sigue creciendo con el cuarto). PURA — el
 * integrador la suma en el tick de legitimidad de `turn.ts`.
 */
export function luxuryLegitimacy(state: GameState, factionId: FactionId): number {
  const count = luxuriesOf(state, factionId).size;
  if (count >= 3) return 2;
  if (count >= 2) return 1;
  return 0;
}

// ---------- tributo de vasallaje (PURA, para el integrador) ----------

export interface TributeFlow {
  from: FactionId;
  to: FactionId;
  gold: number;
}

const VASSAL_TRIBUTE_RATE = 0.15;

/**
 * Flujos de tributo del turno: cada facción viva vasalla (`vassalOfId`
 * fijado, ver `diplomacy.ts:proposeVassalage`) de un señor vivo paga el 15%
 * de su `taxIncome` de esta estación. PURA — no muta oro, el integrador
 * aplica la lista en `turn.ts` (ver CABLEADO arriba).
 */
export function tributeFlows(state: GameState): TributeFlow[] {
  const season = seasonOf(state.turn);
  const flows: TributeFlow[] = [];
  for (const vassalId of Object.keys(state.factions)) {
    const vassal = state.factions[vassalId];
    if (!vassal || !vassal.alive || !vassal.vassalOfId) continue;
    const lord = state.factions[vassal.vassalOfId];
    if (!lord || !lord.alive) continue;
    const gold = Math.floor(taxIncome(state, vassalId, season) * VASSAL_TRIBUTE_RATE);
    if (gold > 0) flows.push({ from: vassalId, to: vassal.vassalOfId, gold });
  }
  return flows;
}
