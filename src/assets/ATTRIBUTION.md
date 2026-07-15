# Atribución de iconos

Este directorio (`src/assets/icons/`) mezcla dos orígenes. Todos los `.svg` son
`currentColor` (heredan el color del texto) y se sirven inline vía
`src/render/icons.ts`.

## 1. Iconos del kit curado de Vanguard Atelier (gravity-ui/icons, MIT)

Vanguard Atelier vendoriza en `design/icons/` un kit de 37 iconos esenciales
tomados de [`gravity-ui/icons`](https://github.com/gravity-ui/icons)
(`design/icons/icons.json`: `"provenance": {"repo": "gravity-ui/icons", "spdx": "MIT"}`).
Reinos de Hierro es un proyecto de **solo lectura** sobre ese kit: copiamos
5 archivos tal cual (mismo `viewBox="0 0 16 16"`, mismo `fill="currentColor"`,
ni un byte de path tocado) y los renombramos al vocabulario semántico del
juego. Ningún archivo de Vanguard Atelier fue modificado para producir esto.

| Archivo en este repo | Icono origen en el kit | Uso en el juego |
|---|---|---|
| `ajustes.svg`   | `settings.svg` (gear)                        | Botón de ajustes |
| `cargar.svg`    | `download.svg` (arrow-down-to-line)          | Cargar partida |
| `exportar.svg`  | `external.svg` (arrow-up-right-from-square)  | Exportar guardado |
| `moral.svg`     | `heart.svg`                                  | Moral de la unidad |
| `movimiento.svg`| `arrow-right.svg`                            | Puntos de movimiento |

El kit de Vanguard Atelier no trae un `LICENSE` propio dentro de
`design/icons/` (solo `icons.json` con los metadatos de procedencia citados
arriba); el texto de licencia MIT de `gravity-ui/icons` en su repositorio
upstream (`github.com/gravity-ui/icons`, rama `main`, archivo `LICENSE`) es:

```
MIT License

Copyright (c) 2022 YANDEX LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

(Verificado contra `https://raw.githubusercontent.com/gravity-ui/icons/main/LICENSE`
el 2026-07-14. Si se redistribuye este proyecto, conservar este aviso junto
con los 5 archivos listados arriba, tal como exige la licencia MIT.)

## 2. Iconos originales de Reinos de Hierro

Los 15 restantes son dibujos originales de este proyecto, hechos a mano para
el KERNEL visual del juego (SVG 24×24, `stroke="currentColor"`,
`stroke-width="1.75"`, sin rellenos sólidos salvo detalles puntuales como
puntas de clavo o remaches). No derivan de ningún asset de terceros.

| Archivo | Qué representa |
|---|---|
| `oro.svg`         | Moneda (recurso: oro) |
| `alimento.svg`    | Espiga de trigo (recurso: alimento) |
| `levas.svg`       | Dos reclutas (recurso: levas / manpower) |
| `hierro.svg`      | Lingote de metal (recurso: hierro) |
| `caballos.svg`    | Herradura (recurso: caballos) |
| `legitimidad.svg` | Corona (legitimidad dinástica) |
| `guerra.svg`      | Espadas cruzadas (estado: en guerra) |
| `paz.svg`         | Rama de olivo (estado: en paz / tratado) |
| `cronica.svg`     | Libro abierto (crónica del reino) |
| `guardar.svg`     | Documento con esquina doblada (guardar partida) |
| `infanteria.svg`  | Escudo (categoría de unidad: infantería) |
| `lanceros.svg`    | Lanza con asta envuelta (categoría: lanceros / spear) |
| `arco.svg`        | Arco tensado con flecha (categoría: a distancia / ranged) |
| `caballeria.svg`  | Sable curvo (categoría: caballería) |
| `asedio.svg`      | Trabuquete / catapulta (categoría: asedio) |

Todos son propiedad del proyecto Reinos de Hierro, bajo la misma licencia del
repositorio.
