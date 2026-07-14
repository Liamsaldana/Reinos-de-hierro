/**
 * RNG determinista (mulberry32). El estado vive en GameState.rngState para
 * que guardar/cargar reproduzca exactamente la misma partida.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** estado serializable */
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** entero en [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true con probabilidad p */
  chance(p: number): boolean { return this.next() < p; }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** RNG efímero para cosas visuales que NO afectan el estado de juego. */
export function visualRng(seed: number): Rng { return new Rng(seed ^ 0xbadc0de); }
