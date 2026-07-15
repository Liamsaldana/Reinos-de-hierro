/**
 * Shim ambiental mínimo para los built-ins de Node que usa el harness de
 * simulación (AGENTE I) al escribir `evidence/sim_report.md`. El repo no
 * tiene `@types/node` instalado (y no toco `package.json`), así que declaro
 * SOLO las firmas que uso — nada de "any" global ni ambient npm-wide.
 */
declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module 'node:path' {
  export function dirname(p: string): string;
  export function resolve(...segments: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
