/**
 * Condiciones de victoria de Fase 3 (GDD §13.1: "Restauración imperial...",
 * "Hegemonía: ser la facción más poderosa... durante N años"), ADITIVAS a la
 * conquista/derrota que ya vive en `turn.ts` (AGENTE A, fuera de mi alcance
 * — no se toca). AGENTE W: módulo nuevo. Núcleo puro: sin Math.random/
 * Date.now, sin DOM, sin mutar nada salvo lo que su propia cabecera declara.
 *
 * ---------------------------------------------------------------------------
 * CABLEADO PARA EL INTEGRADOR (turn.ts es propiedad de otro agente — AGENTE
 * A — y está fuera de mi alcance; NO lo toco):
 *
 * 1) `updateVictoryProgress(state)` se llama UNA VEZ por turno dentro de
 *    `endTurn`, en cualquier punto ANTES del paso 8 ("Victoria/derrota del
 *    jugador") — el sitio sugerido es justo después de
 *    `imperial.ts:tickImperial` (ver su propia cabecera de cableado), para
 *    que la racha de hegemonía y la aparición del Remanente se evalúen en el
 *    orden narrativo correcto dentro del mismo turno. Actualiza
 *    `state.hegemonyStreakPlayer` (ya existe en GameState, types.ts, opcional
 *    — este módulo NO lo crea, solo lo mantiene) según si el jugador es la
 *    mayor potencia ESTE turno. No decide ningún `outcome` por sí sola.
 *
 * 2) `checkExtraVictories(state)` se llama DENTRO del paso 8 de turn.ts,
 *    JUSTO DESPUÉS de `updateVictoryProgress` y ANTES del bloque de
 *    conquista/derrota que YA EXISTE ahí (`if (state.outcome === 'ongoing')
 *    { const playerProvinces = ...; ... }`). Prioridad exacta:
 *
 *      if (state.outcome === 'ongoing') {
 *        updateVictoryProgress(state);
 *        const extra = checkExtraVictories(state);
 *        if (extra) {
 *          state.outcome = extra;
 *        } else {
 *          // ... el bloque de conquista/derrota que YA EXISTE, sin tocar ...
 *        }
 *      }
 *
 *    Por qué este orden: `checkExtraVictories` cubre la restauración
 *    (reunir TODAS las capitales de nivel 4 con reclamo aureliano) y la
 *    hegemonía (racha sostenida); el bloque existente de turn.ts cubre la
 *    conquista genérica (75% del mapa, O TAMBIÉN "todas las capitales" — ver
 *    su propio `conqueredAllCapitals`). Como "controlar todas las capitales"
 *    dispara AMBOS caminos en la práctica, evaluar `checkExtraVictories`
 *    PRIMERO hace que ese desenlace se lea como "Restauración Imperial" (la
 *    verdad narrativa completa: quien reúne cada capital de Valdemar con
 *    derecho aureliano está restaurando el Imperio, no solo conquistando)
 *    en vez de la "Conquista" genérica — exactamente lo que pide el encargo
 *    ("deja conquest para el 75%"; el 75% territorial SIN controlar todas
 *    las capitales, o sin reclamo aureliano, sigue devolviendo
 *    'victory_conquest' normalmente, sin pasar por aquí).
 * ---------------------------------------------------------------------------
 */
import type { FactionId, GameState, Province, ProvinceId } from '../types';
import { armyStrength } from '../combat/autoresolve';
import { provincesOf } from './economy';
import { idAt } from '../content/mapgen';

/** 16 estaciones = 4 años (GDD §13.1: "durante N años" — N=4 aquí). */
const HEGEMONY_STREAK_TURNS_FOR_VICTORY = 16;

/**
 * Provincia semilla de Casa Varga en `content/newGame.ts`
 * (`FACTION_SETUPS[0]`: seedRow 2 / seedCol 2 — ese array no se exporta, así
 * que se referencia por POSICIÓN de rejilla vía `content/mapgen.ts:idAt`,
 * que sí es pública y puramente posicional: `idAt(row,col) = row*GRID_COLS+col`
 * nunca consume el Rng ni depende de la semilla de la partida, así que da el
 * MISMO id de provincia en TODAS las partidas). El nivel de un asentamiento
 * nunca baja en v1 (no hay arrasar/degradar, ver `systems/construction.ts`:
 * solo sube `fortLevel`, jamás `level`), así que esa provincia sigue siendo
 * nivel 4 para siempre pase lo que pase — un ancla estable para "capital
 * original", incluso si Casa Varga se extingue o cede su corona.
 */
const CASA_VARGA_SEED_ROW = 2;
const CASA_VARGA_SEED_COL = 2;

/** ver `CASA_VARGA_SEED_ROW`/`CASA_VARGA_SEED_COL`. Exportada para tests. */
export function casaVargaAncestralCapitalId(): ProvinceId {
  return idAt(CASA_VARGA_SEED_ROW, CASA_VARGA_SEED_COL);
}

/**
 * Puntuación de "poder total" (GDD §13.1: "militar+económica+diplomática",
 * simplificada aquí a militar+económica+territorial, que es lo que el
 * núcleo puede medir sin un sistema de prestigio diplomático propio):
 * 2 por provincia + 1 por cada 50 de oro + la suma de `armyStrength()` de
 * sus ejércitos. El GDD no fija números exactos para esta fórmula: se deja
 * documentada aquí mismo, auditable, en vez de mágica.
 */
export function powerScore(state: GameState, factionId: FactionId): number {
  const faction = state.factions[factionId];
  if (!faction || !faction.alive) return 0;
  const provinces = provincesOf(state, factionId).length;
  const armies = Object.values(state.armies).filter(a => a.factionId === factionId);
  const militaryPower = armies.reduce((sum, a) => sum + armyStrength(state, a), 0);
  return provinces * 2 + faction.gold / 50 + militaryPower;
}

/** true si `factionId` es la mayor potencia viva del mundo (empate en la cima → false: exige ser el único primero). */
export function isLeadingPower(state: GameState, factionId: FactionId): boolean {
  const me = state.factions[factionId];
  if (!me || !me.alive) return false;
  const myScore = powerScore(state, factionId);
  for (const otherId of Object.keys(state.factions)) {
    if (otherId === factionId) continue;
    const other = state.factions[otherId];
    if (!other || !other.alive) continue;
    if (powerScore(state, otherId) >= myScore) return false;
  }
  return true;
}

/**
 * Actualiza la racha de hegemonía del jugador (`GameState.hegemonyStreakPlayer`,
 * types.ts, ya existe, opcional): +1 si el jugador es la mayor potencia este
 * turno, vuelve a 0 si no. Llamar UNA VEZ por turno (ver cableado arriba).
 */
export function updateVictoryProgress(state: GameState): void {
  const leading = isLeadingPower(state, state.playerFactionId);
  state.hegemonyStreakPlayer = leading ? (state.hegemonyStreakPlayer ?? 0) + 1 : 0;
}

/**
 * true si `factionId` puede reclamar la restauración por herencia o
 * posesión: cultura aurelios (Casa Varga, GDD §2.4 — o quien la haya
 * heredado por matrimonio vía `diplomacy.ts:transferRealm`, que traslada
 * provincias pero no reescribe `cultureId`, así que el heredero conserva SU
 * propia cultura, no la de Varga: si no es aurelios, deberá reclamar por la
 * segunda vía) O controla la provincia que fue la capital original de Casa
 * Varga (ver `casaVargaAncestralCapitalId`) — la sede física del Imperio,
 * para quien reclama el trono sin sangre aurelia.
 */
export function hasAurelianClaim(state: GameState, factionId: FactionId): boolean {
  const faction = state.factions[factionId];
  if (!faction) return false;
  if (faction.cultureId === 'aurelios') return true;
  const capitalId = casaVargaAncestralCapitalId();
  const capital = state.provinces.find(p => p.id === capitalId);
  return !!capital && capital.ownerId === factionId;
}

/** Todas las provincias de nivel 4 ("capital de reino", `Settlement.level`) del mundo, la posea quien la posea. */
function allCapitals(state: GameState): Province[] {
  return state.provinces.filter(p => p.settlement.level === 4);
}

/**
 * Evalúa las condiciones de victoria propias de Fase 3, en el orden de
 * prioridad narrativa que le corresponde darles al integrador (ver cabecera
 * del archivo). Devuelve el `outcome` a fijar, o `null` si ninguna se
 * cumple todavía. NO muta `state` — ni siquiera `hegemonyStreakPlayer`, que
 * es responsabilidad exclusiva de `updateVictoryProgress` (llamarla a ella
 * primero es responsabilidad del integrador, no de esta función).
 */
export function checkExtraVictories(state: GameState): GameState['outcome'] | null {
  const playerId = state.playerFactionId;
  const player = state.factions[playerId];
  if (!player || !player.alive) return null;

  const capitals = allCapitals(state);
  const controlsAllCapitals = capitals.length > 0 && capitals.every(p => p.ownerId === playerId);

  if (controlsAllCapitals && hasAurelianClaim(state, playerId)) {
    return 'victory_restauracion';
  }

  if ((state.hegemonyStreakPlayer ?? 0) >= HEGEMONY_STREAK_TURNS_FOR_VICTORY) {
    return 'victory_hegemonia';
  }

  return null;
}
