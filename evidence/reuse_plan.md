# Reuse — reuse_plan · Reinos de Hierro

Qué se reutiliza en lugar de inventar (regla: no reescribir lo que el banco/ecosistema ya resolvió):

| Necesidad | Reutilización | En vez de |
|---|---|---|
| Cámara del mapa (paneo/zoom/rotación) | `OrbitControls` de `three/addons` | control de cámara a mano |
| Paleta y elevaciones de UI | `crimson-noir` HEX + patrón hairline de `design/primitives/palettes.css` (Vanguard_Atelier) | CSS desde cero |
| Escala tipográfica | escala modular de `design/primitives/editorial.css` | números mágicos |
| Fuentes | `@fontsource/cinzel`, `@fontsource/alegreya` (npm, self-hosted) | CDN de Google |
| RNG determinista | mulberry32 (dominio público, 12 líneas) | dependencia externa |
| Estado global | store propio de 60 líneas (GDD §14.1 lo permite explícitamente) | Zustand (dep innecesaria en v0) |
| Verificación runtime | Chromium preinstalado del entorno + Playwright para captura | montar infra propia |
| Disciplina de evidencia | CLI `atelier` de Vanguard_Atelier (ledger + check) | prosa sin anclaje |

Deuda declarada: Phaser 3 se añadirá cuando entre la batalla táctica (GDD §8); no se instala
hoy para no cargar 1.2 MB de dependencia sin uso.
