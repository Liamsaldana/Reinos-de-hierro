# Feedback del dueño #1 (2026-07-14) — referencia visual GoT-style

## Lo que dijo (destilado)
1. "Me gusta el 3D pero le falta más esfuerzo en assets visuales; el mapa se siente muy vacío,
   muy feo, sin sentido." → el mundo necesita silueta de continente, mar real, vegetación,
   castillos, nombres de región, bordes que brillen por dueño (ref: mapa político con El Norte).
2. "La UI: no sabes exactamente qué está pasando ni nada." → falta legibilidad de estado:
   tracker de qué hacer, informe del turno, deltas de recursos, amenazas visibles.
3. "Dos mapas: uno grande y luego uno no tan grande." → escalas: mapa político global ↔ vista
   regional con detalle. Decisión: LOD en la misma escena (lejos = político con nombres de región;
   cerca = terreno con árboles/castillos/hexes de la batalla) + batalla táctica hexagonal (ya
   existe) + sede de poder como tercera escala. Un segundo mapa regional persistente separado
   queda ANOTADO como opción futura si el LOD no basta.
4. "El castillo del jugador… para cada sede de poder o reinos." → vista de castillo procedural
   por capital con hotspots (Sala del trono / Cuartel / Tesorería / Crónica), visitable también
   en cortes extranjeras (solo lectura).
5. Imagen del esquema militar de Winterfell → dirección para el futuro HUD de batalla:
   planificación de despliegue con leyenda de tipos (anotado para la fase de pulido táctico).

## Mapeo a ejecución (ola 3, en vuelo)
- K → overhaul visual del mapa (costa, mar, bosques/rocas instanciados, castillos 3D por nivel
  de asentamiento, bordes con halo por dueño, labels de región/provincia con LOD, flechas de ruta).
- L → legibilidad: informe del turno, franja de estado (guerras/huestes ociosas/amenazas/sucesión),
  breadcrumb de selección, deltas con fórmula en tooltip, iconos.
- M → sede de poder (castillo 3D con hotspots, reclutamiento real desde el Cuartel).
- N → la IA debe morder: diagnóstico del hallazgo del sim (0 batallas en 30 turnos) y arreglo
  con criterios de éxito medibles en tests/simulation.test.ts.
