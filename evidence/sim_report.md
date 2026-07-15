# Reporte de simulación — Reinos de Hierro

Generado automáticamente por `tests/simulation.test.ts` (AGENTE I / AGENTE N, harness de simulación) — 2026-07-15.

## Diagnóstico (AGENTE N — "la IA debe morder")

Antes del arreglo, 30 turnos x 3 semillas daban ~1 guerra declarada y **0 batallas / 0 conquistas**: el mundo se congelaba tras la declaración de guerra inicial. Causa raíz, verificada instrumentando una corrida: `src/core/ai/factionAI.ts` comparaba magnitudes incompatibles al decidir si atacar.

- `province.garrison` es una **cuenta de hombres** (~200-500 en provincias propias, ~300-800 en tierras sin señor — `content/mapgen.ts` / `content/newGame.ts`).
- `armyStrength()` (`combat/autoresolve.ts`) es una **puntuación de poder** por ejército, típicamente ~30-100 para lo que esta IA reúne en 30 turnos.
- El código viejo hacía `defenseEstimate = targetProvince.garrison + Σ armyStrength(enemigos)` y comparaba eso contra `myStrength` (una `armyStrength`): al dominar la suma el término en cientos, el umbral de ataque no se superaba NUNCA, ni siquiera contra una guarnición "débil" en el turno 0. La expansión pacífica (`p.garrison < myStrength`) tenía el mismo defecto.
- La ironía: en combate real (`resolveBattleAt`), la guarnición NO pelea proporcional a su cantidad de hombres — `autoresolve.ts` clona la unidad 'milicia' con `menMax = province.garrison`, así que su ratio hombres/menMax es SIEMPRE 1 y su potencia por ronda es la de UNA unidad de milicia a plena dotación (~4.5, modulada por terreno/fortificación), **sin importar el tamaño de la guarnición**. Cualquier ejército inicial (armyStrength ~30-38) aplasta esa guarnición — la IA vieja simplemente nunca lo intentaba porque comparaba cientos contra decenas.

Arreglo: `garrisonDefensePower()` reconstruye la potencia de guarnición EN LAS MISMAS UNIDADES que `armyStrength()`, a partir de datos públicos de `content/units.ts` (nunca se importó `combat/modifiers.ts`: ese módulo se declara expresamente interno al combate). Con la escala corregida, la IA además: distingue umbral de ataque por arquetipo (ambitious 1.15x / tribal 0.95x / consolidated 1.35x) contando SOLO la defensa presente en la provincia objetivo, se retira si su fuerza cae bajo 0.6x la amenaza en provincias vecinas (no se suicida), y evita el caso borde donde `actions.ts:hasDefense` marcaría "defendida" una provincia sin guarnición y sin nadie en guerra con nosotros presente (`safeToMoveInto`), que habría hecho lanzar `resolveBattleAt` ("No hay defensores").

## Simulación corta (30 turnos, sin acciones del jugador)

| Semilla | Guerras declaradas | Batallas | Provincias que cambiaron de dueño | Conquistas (a un rival) | Facciones vivas @turno15 | Facciones vivas @final | Oro medio | Duración (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 11 | 4 | 22 | 24 | 13 | 3 | 3 | 427 | 135 |
| 23 | 4 | 28 | 29 | 15 | 3 | 3 | 677 | 53 |
| 47 | 4 | 26 | 33 | 19 | 3 | 3 | 393 | 64 |

Actividad de IA acumulada en las 3 semillas: 12 guerra(s) declarada(s), 76 batalla(s), 86 cambio(s) de dueño de provincia (de ellos, 47 conquistados a un rival vivo, no tierra sin señor).

Criterio de éxito (AGENTE N): batallas totales >=4 (OK), cambios de dueño totales >=6 (OK), >=1 conquista en CADA semilla (OK), y >=2 de 3 semillas con las 3 facciones vivas al turno 15, sin exterminio relámpago (OK).
