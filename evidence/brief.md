# Frame — brief · Sprint "darle piernas" (Fase 0 completa + núcleo Fase 1)

## Entregable comprometido (criterio de éxito del GDD §16 Fase 0)
> "Puedes hacer clic en provincias y pasar turnos." — **más** el corazón de Fase 1:
> reclutar, mover ejércitos, batalla auto-resuelta, conquista de capitales, IA que pelea,
> guardar/cargar.

## Qué SÍ (verificable en esta corrida)
1. `npm run build` y `npm run typecheck` en verde.
2. `npm test` (vitest): determinismo de mapgen, ida-vuelta de serialización,
   invariantes de combate (conservación de hombres, reproducibilidad por semilla).
3. Mapa 3D de Valdemar (~40 provincias, geografía del GDD §2.1) con selección,
   paneo/zoom/rotación, tinte por dueño, resaltado hover.
4. Bucle de turno por estaciones (4/año) con ingresos, levas, mantenimiento, IA.
5. Batalla: auto-resolución con terreno/estación/general/moral + parte narrado en español.
6. Guardar/cargar (localStorage + exportar/importar JSON).
7. Evidencia en disco: capturas del runtime real (Chromium headless), logs de build/test.

## Qué NO (se declara, no se disimula)
- Phaser/batalla táctica en cuadrícula, asedios con provisiones, matrimonios,
  árbol tecnológico, eventos con decisiones: siguiente sprint (roadmap GDD §16).

## Presupuesto
Una sesión (~70 min de reloj), orquestación con subagentes en paralelo, ~90% de ventana.
