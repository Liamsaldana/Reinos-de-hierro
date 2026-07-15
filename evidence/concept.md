# design.concept — concept · Reinos de Hierro

## Dirección elegida (UNA, del banco `design/aesthetics/INDEX.md` de Vanguard_Atelier)
**`luxury-dark` (13 · Lujo oscuro).**

**Por qué encarna la metáfora:** el juego ES una corona de hierro — poder sobrio, sangre y
pergamino, decisiones de gabinete a la luz de velas. Superficies casi-negras que se elevan con
hairlines (no cajas grises), un acento que aparece con convicción: eso es una sala del trono,
no un SaaS. La UI de gran estrategia es una "superficie de producto" (dashboard denso) →
aplica también Sistema 1/Sistema 2: primero se entiende objeto/acción/estado, el ornamento después.

**La trampa de la dirección (aceptada, se audita contra ella):** "otro SaaS oscuro con glow
morado" está VETADO. Nada de gradientes agresivos ni glow; elevación por hairline de luz,
contraste disciplinado, espacio caro.

## Paleta (UNA, del banco `design/palettes/` — el HEX es autoridad)
**`crimson-noir`**: `#EDEBDE` (pergamino) · `#810100` (sangre) · `#630102` (borgoña profundo) ·
`#1B1716` (hierro-negro).
Roles: fondo/superficie = hierro-negro y sus elevaciones por hairline; texto = pergamino;
acento único = sangre (`#810100`) para acciones primarias y alertas de guerra; borgoña para
estados hover/presión. Los colores de FACCIÓN en el mapa 3D son datos de juego (heráldica),
no parte de la paleta de UI — conviven porque la UI es casi monocroma.

## Tipografía (prohibidas Inter/Roboto/Arial/system/Fraunces — cumplido)
- Display: **Cinzel** (lapidaria romana; títulos, nombres de reino, numerales).
- Cuerpo: **Alegreya** (serif humanista pensada para lectura larga; paneles, crónica).
- Ambas self-hosted vía `@fontsource/*` (sin CDN, funciona offline).

## Gesto firma
La barra superior y los paneles son losas de hierro-negro separadas del mapa por un hairline
`rgba(237,235,222,.14)`; el botón "Terminar turno" es EL único bloque de sangre sólida de la
pantalla. Títulos Cinzel en versalitas con tracking amplio, datos en Alegreya.

## Primitivas ensambladas (no se inventa CSS desde cero)
Tokens y patrones tomados de `design/primitives/palettes.css` (tier premium, patrón hairline)
y escala editorial de `editorial.css`, adaptados a HUD de juego en `src/render/ui/styles.css`
con los HEX de `crimson-noir` como autoridad.

## A11y
Contraste pergamino-sobre-hierro ≥ 12:1; estados de foco visibles; los colores de facción
llevan además patrón/inicial en el estandarte (daltonismo, GDD §13.2); `prefers-reduced-motion`
degrada transiciones a corte seco.
