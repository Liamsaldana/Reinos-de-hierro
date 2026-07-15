# Reinos de Hierro

Gran estrategia medieval por turnos en el navegador: mapa 3D del continente de **Valdemar**
(Three.js), economía por estaciones, dinastías mortales, guerra con batallas auto-resueltas
y crónica narrada. Single-player, sin backend. **`GDD.md` es la fuente única de verdad.**

## Correr

```bash
npm install
npm run dev        # servidor de desarrollo (Vite)
npm run build      # build de producción
npm run typecheck  # tsc estricto
npm test           # vitest (mapgen, combate, turnos, persistencia)
```

## Estado actual (sprint Fase 0 → núcleo de Fase 1)

Hecho en este sprint — ver `evidence/` para las pruebas en disco:
- Mapa 3D de ~40 provincias con relieve, selección, paneo/zoom/rotación, tinte por dueño,
  estandartes heráldicos procedurales y banderas de ejército.
- Bucle de turno por estaciones (4/año): ingresos, cosecha, mantenimiento, levas, atrición,
  edad y muerte de gobernantes con sucesión.
- Reclutamiento (con recursos estratégicos: hierro/caballos), movimiento de ejércitos,
  **batalla auto-resuelta** (terreno, clima por estación, contadores, moral, generales)
  con parte narrado en español, ocupación y conquista.
- Guerra y paz: casus belli, puntaje de guerra, agotamiento, tregua.
- 2 IA rivales (arquetipos ambicioso/tribal/consolidado) usando el mismo motor que el jugador.
- Guardar/cargar: localStorage + exportar/importar JSON.
- Victoria por conquista; derrota por extinción dinástica o pérdida total.

Pendiente (siguiente sprint, por diseño del GDD §16): batalla táctica jugable en Phaser
(la auto-resolución va primero, GDD §8.4), asedios con provisiones, diplomacia profunda
(matrimonios, alianzas), tecnología, eventos con decisiones, y las Fases 2–4.

## Arquitectura (GDD §14)

```
src/core     ← TypeScript puro, testeable, sin render (estado, sistemas, combate, IA, contenido)
src/render   ← world/ (Three.js) + ui/ (HTML/CSS)  — leen estado, envían acciones
src/main.ts  ← ensamblado
```

Todo el estado del juego es un `GameState` serializable a JSON con RNG determinista
(misma semilla → misma partida). Dirección de arte de la UI: **lujo oscuro × crimson-noir**
(pergamino `#EDEBDE`, sangre `#810100`, hierro `#1B1716`), tipografías Cinzel + Alegreya
(self-hosted). Decisiones de diseño y evidencia: `evidence/concept.md`.

Este proyecto se construyó con la disciplina del runtime **Vanguard Atelier**
(ledger de evidencia dependency-gated); las fricciones encontradas están en
`evidence/dogfood_atelier.md`.
