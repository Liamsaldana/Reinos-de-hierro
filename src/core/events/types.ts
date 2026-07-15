/**
 * Contrato interno del sistema de eventos (GDD §12: eventos dinásticos y de
 * mundo, ~15 base en v1). La API pública que consume el resto del juego
 * vive en `index.ts` (`PendingEvent`, `rollTurnEvents`, `applyEventChoice`);
 * este archivo define cómo se declara y resuelve cada `GameEventDef`.
 *
 * AGENTE H (eventos): módulo propio. No añadir dependencias de render aquí.
 */
import type { ChronicleKind, GameState } from '../types';
import type { Rng } from '../state/rng';

/**
 * Datos serializables (solo string|number) mínimos para re-resolver una
 * choice sin ambigüedad: ids de provincia/personaje/facción elegidos al
 * azar, montos calculados, etc. Se congelan en `PendingEvent.payload` y
 * viajan de vuelta a `build()` cuando se resuelve la elección.
 */
export type EventPayload = Record<string, string | number>;

/** Lo que la UI/el integrador reciben tras `rollTurnEvents` (API pública). */
export interface PendingEvent {
  defId: string;
  title: string;
  text: string;
  choices: string[];
  /** payload congelado por `build()`; se reenvía tal cual a `applyEventChoice`. */
  payload?: EventPayload;
}

export interface EventChoiceDef {
  /** texto de la opción, ya formateado para la UI ("Pagar médicos (-30 oro)"). */
  label: string;
  /** aplica la consecuencia sobre el estado y devuelve líneas narradas (español). */
  effect(state: GameState, rng: Rng, payload: EventPayload): string[];
}

export interface BuiltEvent {
  title: string;
  text: string;
  choices: EventChoiceDef[];
  /** ids/valores elegidos al azar (o reutilizados) para esta instancia del evento. */
  payload: EventPayload;
}

export interface GameEventDef {
  id: string;
  kind: ChronicleKind;
  weight: number;
  /** filtra si el evento puede proponerse con el estado actual. */
  condition(state: GameState): boolean;
  /**
   * Construye el título/texto/choices de una instancia del evento.
   * - Sin `payload` (primera propuesta, vía `rollTurnEvents`): puede tirar
   *   dados para elegir objetivos (provincia, personaje, facción rival...) y
   *   los devuelve congelados en `BuiltEvent.payload`.
   * - Con `payload` (re-resolución, vía `applyEventChoice`): NO debe tirar
   *   dados nuevos para elegir objetivos — reconstruye el mismo
   *   título/texto/choices reutilizando esos valores, para que la choice
   *   elegida por el jugador se aplique sin ambigüedad.
   */
  build(state: GameState, rng: Rng, payload?: EventPayload): BuiltEvent;
}
