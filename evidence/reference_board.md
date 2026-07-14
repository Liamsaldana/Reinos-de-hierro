# design.research — reference_board · Reinos de Hierro

Referencias operativas (del GDD §1.4 + dirección `luxury-dark`), con QUÉ se toma de cada una:

1. **Crusader Kings III (HUD):** barra superior de recursos compacta con iconos + número;
   panel lateral contextual que cambia con la selección. → estructura de HUD.
2. **Total War (capa de campaña):** mapa como protagonista, UI en los bordes, parte de
   batalla como interrupción modal. → jerarquía mapa>UI, modal de batalla.
3. **Battle Brothers (parte escrito):** resultados narrados con sabor, no solo números.
   → `BattleReport.narrative` en español con nombres propios.
4. **Cartografía antigua / portulanos:** tierra pergamino, tintas ferrogálicas, rotulación
   serif espaciada. → tratamiento del terreno 3D y rótulos (pergamino #EDEBDE sobre hierro).
5. **Encuadernación y sigilografía medieval:** hairlines dorado-pálidos, sellos de cera
   (el rojo #810100 como cera de sello). → botón primario y blasones procedurales.
6. **Banco propio:** `design/primitives/palettes.css` (patrón de elevación hairline del tier
   premium) y `editorial.css` (escala tipográfica modular). → tokens de `styles.css`.

Anti-referencias (lo que NO): dashboards SaaS oscuros con glow morado (trampa declarada de
`luxury-dark`), fantasía genérica con texturas fotográficas de piedra, UI "limpia/moderna" sin voz.
