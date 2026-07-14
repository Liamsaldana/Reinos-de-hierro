# Dogfood del runtime Atelier — proyecto Reinos de Hierro

Fricciones y observaciones reales usando `bin/atelier` de Vanguard_Atelier para fabricar
este juego (sesión 2026-07-14, agente Fable 5 orquestando + 5 subagentes).

1. **`riverstar-core` no estaba en el scope de la sesión.** CLAUDE.md ordena leer el
   playbook (`riverstar-core/03-methodology/playbook-builder-ia.md`) antes de tocar nada,
   pero el repo no era accesible. Se operó solo con CLAUDE.md + README + KERNEL. Sugerencia:
   un extracto mínimo de supervivencia del playbook dentro de Vanguard_Atelier evitaría el
   arranque a ciegas cuando la sesión no incluye riverstar-core.
2. **`produce` no exige `run` previo del módulo.** Se produjeron `app_map`, `brief`,
   `concept`, `reference_board` y `reuse_plan` sin haber ejecutado `atelier run <módulo>`
   ni una sola vez. Si `run` es parte del rito (cargar el contrato antes de producir),
   hoy no está gateado; si es opcional por diseño, documentarlo — sorprende.
3. **Mensaje de `init` ambiguo:** "Edit .atelier/ledger.json 'scan' honestly" choca de frente
   con la trampa documentada de "editar `ledger.json` a mano pone el check en RED". Un
   subcomando (`atelier scan set ...`) o aclarar qué campo sí es editable evitaría el susto.
4. **El banco de estéticas no tiene dirección para HUD de juego.** `luxury-dark` se adaptó
   bien (hairlines + acento único leen perfecto como "sala del trono"), pero la trampa
   específica de HUD (densidad de datos de juego + mapa protagonista debajo) no está escrita
   en ninguna de las 15 direcciones. Candidato a entrada nueva o a nota en
   `design/principles/INDEX.md`.
5. **Positivo:** el preset `web_app_with_ui` modeló bien un juego (design.* + api.build en
   paralelo tras frame); `produce --evidence` verificando el archivo en disco obligó a
   escribir brief/concept ANTES de programar — orden correcto, cero costo.
6. **Positivo:** paleta por HEX-autoridad (`crimson-noir`) + prohibición de fuentes slop
   bajó de verdad la entropía: cero discusión de colores en los 5 subagentes, todos
   recibieron los mismos tokens.
