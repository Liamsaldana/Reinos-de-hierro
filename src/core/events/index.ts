/**
 * API pública del sistema de eventos (GDD §12). El integrador de turno y la
 * UI solo deberían importar de aquí — `defs.ts`/`engine.ts`/`types.ts` son
 * detalle interno.
 */
export type { PendingEvent } from './types';
export { rollTurnEvents, applyEventChoice } from './engine';
