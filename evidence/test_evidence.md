# test_evidence — verificación real del sprint (ola 1 integrada)

Fecha: 2026-07-14 · Integrador: orquestador (Fable 5) · Todo lo de abajo fue ejecutado, no asumido.

## Compilación y tests
- `tsc --noEmit` (estricto, árbol completo): **limpio, 0 errores**.
- `vite build` (producción): **OK** — bundle 603.58 kB (gzip 159.61 kB) + CSS 23.59 kB.
- `vitest run`: **25/25 en verde** en 4 suites:
  - `tests/mapgen.test.ts` (10) — 40 provincias, nombres únicos, adyacencia simétrica,
    contigüidad de facciones, determinismo `newGame(7)` (+ barrido extra de 500 semillas
    por el agente B, 0 fallos).
  - `tests/combat.test.ts` (7) — determinismo del parte, conservación de hombres,
    3:1 gana ≥18/20 semillas, guarnición sola, narrativa ≥6 líneas.
  - `tests/turn.test.ts` (4) — 20 turnos estables, determinismo end-to-end del estado.
  - `tests/persistence.test.ts` (4) — ida-vuelta export/import, rechazo de basura.

## Runtime real (Chromium headless, build de producción servida con vite preview)
Script: `scripts/shoot.mjs` → `evidence/screenshots/`:
- `01_menu.png` — menú: título Cinzel, 3 casas con blurb, semilla, "Forjar el reino", cargar partida.
- `02_mapa_valdemar.png` — mapa 3D vivo: 40 provincias tintadas por dueño (Varga/Haraldsen/Temük),
  escudos heráldicos procedurales, banderas de ejército con hombres, minimapa político clicable,
  barra de recursos y "Terminar turno".
- `03_seleccion_provincia.png` — selección por raycast con panel contextual.
- `04_tras_dos_turnos.png` — tras 2 fines de turno: Otoño año 1, cosecha aplicada (+57 alimento),
  levas regeneradas, la IA movió ejércitos (Haraldsen 700 h., Temük dividió 600/200), toasts
  con ingresos/levas y crónica narrando el arranque de las casas.
- Errores de consola en la corrida: 1 × favicon 404 (corregido después con favicon SVG inline;
  cero errores de la aplicación).

## Defectos encontrados mirando la evidencia (y su corrección)
1. Barra superior mostraba "Casa Casa Varga" (prefijo duplicado) → corregido en `topBar.ts`.
2. Los toasts tapaban el minimapa (ambos en esquina inferior derecha) → `.toast-stack` desplazado.
3. favicon 404 → favicon SVG data-URI (corona de hierro, paleta crimson-noir).

## Frontera honesta
La ola 2 (motor táctico hexagonal, escena Phaser, eventos con decisiones, harness de simulación,
iconos) está en construcción y NO forma parte de esta evidencia. Ver claims C-001/C-002 del ledger.
