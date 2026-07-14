/**
 * Store propio (GDD §14.1: "Zustand o un store propio" → propio, cero deps).
 * Una sola fuente de verdad serializable. Los sistemas mutan el estado DENTRO
 * de store.mutate(); los renderers se suscriben y reaccionan a StoreEvent.
 */
import type { GameState, StoreEvent, Selection } from '../types';
import { Rng } from './rng';

type Listener = (state: GameState, ev: StoreEvent) => void;

export class GameStore {
  private _state: GameState | null = null;
  private listeners = new Set<Listener>();
  /** selección transitoria (no serializable, compartida entre mundo y UI) */
  selection: Selection = null;

  get state(): GameState {
    if (!this._state) throw new Error('No hay partida cargada');
    return this._state;
  }

  get hasGame(): boolean { return this._state !== null; }

  /** RNG ligado al estado actual: consumirlo actualiza state.rngState. */
  rng(): Rng {
    const r = new Rng(this.state.rngState);
    const self = this;
    return new Proxy(r, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v === 'function') {
          return (...args: unknown[]) => {
            const out = (v as (...a: unknown[]) => unknown).apply(target, args);
            self.state.rngState = target.state;
            return out;
          };
        }
        return v;
      },
    });
  }

  replaceState(next: GameState): void {
    this._state = next;
    this.selection = null;
    this.emit({ type: 'state-replaced' });
  }

  /** Ejecuta una mutación y notifica. Devuelve lo que devuelva fn. */
  mutate<T>(fn: (s: GameState) => T, ev: StoreEvent = { type: 'map-changed' }): T {
    const out = fn(this.state);
    this.emit(ev);
    return out;
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
    this.emit({ type: 'selection', selection: sel });
  }

  emit(ev: StoreEvent): void {
    if (!this._state) return;
    for (const l of [...this.listeners]) l(this._state, ev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** instancia global de la app (un solo juego a la vez) */
export const store = new GameStore();
