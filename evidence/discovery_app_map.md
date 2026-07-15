# Discovery — app_map · Reinos de Hierro (sprint Fase 0→1)

**Fuente de verdad:** `GDD.md` v1.0 (planeación maestra completa, decisiones §17.2 todas resueltas).
**Estado del repo al arrancar:** vacío (0 commits). Este sprint lo funda.

## Mapa de la aplicación (qué se construye en este sprint)

| Zona | Módulo | Archivos | Estado |
|---|---|---|---|
| Núcleo | Contrato de tipos + store + RNG | `src/core/types.ts`, `state/store.ts`, `state/rng.ts` | hecho (a mano, es el contrato) |
| Núcleo | Turnos + economía + persistencia | `src/core/systems/*`, `state/persistence.ts` | delegado (agente A) |
| Contenido | Mapa Valdemar ~40 provincias + 3 culturas + 3 religiones + unidades + facciones | `src/core/content/*` | delegado (agente B) |
| Núcleo | Auto-resolución de batalla + IA de facción | `src/core/combat/*`, `src/core/ai/*` | delegado (agente D) |
| Render | Mundo 3D Three.js (relieve, provincias, picking, cámara, estandartes) | `src/render/world/*` | delegado (agente C) |
| Render | UI HTML/CSS (barra, paneles, parte de batalla, guardar/cargar) | `src/render/ui/*` | delegado (agente E) |
| Integración | `main.ts` ensambla escenas | `src/main.ts` | orquestador |

## Fuera de alcance de este sprint (honesto)
- Batalla táctica jugable en Phaser (GDD §8): la auto-resolución va primero **por diseño**
  (GDD §8.4: "la auto-resolución se construye primero"). Phaser entra en el siguiente sprint.
- Diplomacia completa, asedios, tecnología, eventos, capa mítica: Fases 2–3 del roadmap.

## Restricciones del entorno
- Navegador, single-player, sin backend (GDD §14.1). Node solo como andamio (Vite).
- Sin `riverstar-core` en esta sesión (no está en el scope de repos) → se opera con
  CLAUDE.md + KERNEL de Vanguard_Atelier. Anotado como fricción en dogfood.
