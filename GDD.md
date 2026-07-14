# Documento de Diseño de Juego (GDD)
## Reinos de Hierro *(título de trabajo)*

**Versión:** 1.0 — Planeación maestra
**Género:** Gran estrategia medieval por turnos con combate táctico
**Plataforma:** Navegador (single-player, sin multijugador)
**Stack objetivo:** TypeScript · Three.js (mapa estratégico 3D) · Phaser 3 (batalla táctica 2D) · HTML/CSS/SVG (interfaz)
**Programación asistida por:** Fable 5

> Títulos alternativos a considerar: *Coronas de Hierro*, *La Corona Fracturada*, *Estandartes*, *Reinos y Tratados*, *Yugo y Corona*. El nombre en clave del proyecto es **Reinos de Hierro**; se puede cambiar sin costo antes de la Fase 1.

---

## 0. Cómo leer este documento

Este GDD es la fuente única de verdad del proyecto. Está organizado en tres capas:

1. **Diseño (secciones 1–13):** qué es el juego y cómo se juega. Sin código.
2. **Arquitectura técnica (sección 14):** cómo se construye. Estructura de módulos y datos.
3. **Ejecución (secciones 15–17):** en qué orden se construye, qué assets se necesitan, y qué riesgos/dudas quedan abiertas.

Cada sistema grande incluye una nota **[Alcance v1]** que indica qué entra en la primera versión jugable (el MVP) y qué se pospone. Esto es deliberado: construimos un juego *jugable y divertido* pronto, y le añadimos profundidad por capas.

---

## 1. Visión y pilares de diseño

### 1.1 Declaración de visión
Reinos de Hierro es un juego de gran estrategia para un jugador donde encarnas a la corona de un reino en un mundo ficticio de estética medieval. Alternas entre dos escalas: la **capa estratégica** (un mapa 3D del continente donde gestionas territorios, economía, diplomacia, religión, tecnología y ejércitos, por turnos) y la **capa táctica** (batallas en cuadrícula donde el resultado de las guerras se decide con maniobra, terreno, clima y tipos de tropa). El corazón del juego es la **toma de decisiones geopolítico-militar**: cada guerra, tratado, matrimonio o herejía reconfigura el tablero.

### 1.2 Pilares de diseño (las reglas que resuelven cualquier duda)
Cuando una decisión de diseño sea ambigua, se resuelve a favor del pilar más alto.

1. **La decisión importa.** Toda elección (declarar guerra, firmar paz, investigar, casar a un heredero) debe tener consecuencias visibles y encadenadas. Nada es cosmético.
2. **La guerra es geopolítica, no solo militar.** Ganar batallas no basta; hay que gestionar alianzas, legitimidad, agotamiento bélico y economía. Un genio táctico puede perder por aislamiento diplomático.
3. **Profundidad legible.** Sistemas profundos pero comunicados con claridad: iconos, tooltips y "por qué pasó esto". El jugador nunca debe perder por una regla oculta.
4. **Asimetría con identidad.** Facciones, culturas y religiones se sienten distintas (bonos, tropas únicas, mecánicas propias), no reskins.
5. **Construir por capas.** Cada sistema funciona de forma aislada y se puede activar/desactivar. Esto permite un MVP real y crecimiento sin reescrituras.

### 1.3 Fantasía del jugador
"Soy el soberano de una casa. Empecé con un ducado frágil y, a base de guerra inteligente, matrimonios astutos y ciencia, forjé un imperio — o vi caer mi dinastía intentándolo."

### 1.4 Referencias (para alinear expectativas visuales y de sistemas)
- **Sistemas de diplomacia/dinastía:** Crusader Kings.
- **Mapa y conquista por turnos:** Civilization, Total War (capa de campaña).
- **Batalla táctica en cuadrícula:** Battle Brothers, Fire Emblem, The Battle of Wesnoth.
- **Estética 2D con arte IA:** Northgard, Wildermyth, Battle Brothers.

---

## 2. Ambientación y worldbuilding

Mundo ficticio de **baja fantasía**: sin magia jugable ni criaturas; estética medieval realista. La ficción da libertad creativa total y evita cualquier problema de licencias por usar naciones o figuras reales.

### 2.1 El continente: Valdemar
Un continente llamado **Valdemar**, fracturado tras el colapso del antiguo **Imperio de Aurelia** hace tres generaciones. Hoy es un mosaico de reinos, ducados y ciudades-estado que compiten por reclamar el legado imperial. Geografía variada: llanuras fértiles al centro, montañas al norte, costas y archipiélagos al oeste, estepas al este, y un sur árido. Esta variedad geográfica es funcional: alimenta recursos, terreno de batalla y clima.

Dos extremos del mapa cargan con la **capa mítica** del mundo (ver 2.5): al **extremo norte**, más allá de una vieja línea de fortificaciones imperiales abandonadas —**la Cerca**—, se extienden los **Yermos Blancos**, tierra congelada de la que las leyendas advierten que algo antiguo despierta cuando los inviernos se alargan. Al **sur volcánico**, las **Fauces** (una cadena de volcanes) son la única fuente conocida de **vidrio ígneo**, una obsidiana negra que el folclore dice capaz de "matar lo que el acero no puede".

### 2.2 Culturas (grupos culturales)
Las culturas definen estética, nombres, bonos suaves y tropas base. Para el v1 se proponen **cinco**:

| Cultura | Inspiración estética | Rasgo identitario | Tropa emblemática |
|---|---|---|---|
| **Aurelios** | Latino/imperial | Legitimidad y administración; bonos a estabilidad | Infantería pesada de escudo |
| **Norlander** | Nórdico/germano | Incursión y moral; bonos ofensivos | Guerreros de hacha / asaltantes |
| **Estepara** | Estepario/nómada | Movilidad; caballería superior | Arqueros a caballo |
| **Sarradio** | Mediterráneo/levantino | Comercio y ciencia; bonos económicos y de investigación | Lanceros ligeros / camelleros |
| **Highland** | Montañés/celta | Defensa y terreno; bonos en montaña/colina | Montañeses con lanza larga |

**[Alcance v1]:** 3 culturas jugables (Aurelios, Norlander, Estepara); las otras dos entran en Fase 3.

### 2.3 Religiones
Las religiones dan cohesión, casus belli (guerra santa) y modificadores. Propuesta de **tres** grandes sistemas de fe más herejías:

- **La Luz Solar (Aureísmo):** monoteísta, jerárquico, con un Pontífice que puede excomulgar. Bonos a legitimidad; puede llamar a cruzadas.
- **Los Viejos Pactos:** politeísmo animista de los Norlander y esteparios. Descentralizado; favorece guerra e incursión, tolera múltiples deidades.
- **El Cálculo (Sarradismo):** fe filosófica-mercantil; venera el conocimiento y el equilibrio. Bonos a ciencia y comercio, penalización a fanatismo.
- **Herejías:** cada fe mayor puede fracturarse (ej. "Aureísmo Reformado"), generando tensión interna y oportunidades diplomáticas.

**Mecánicas religiosas:** nivel de piedad, autoridad religiosa, conversión de provincias, casus belli santo, y **cisma** (evento que divide una fe). **[Alcance v1]:** las 3 fes con conversión de provincia y un casus belli religioso simple. Herejías y Pontífice/excomunión en Fase 3.

### 2.4 Facciones (los actores del mapa)
Una **facción** = una casa dinástica que gobierna un reino/ducado. Cada partida arranca con ~12–20 facciones repartidas por Valdemar. Tipos de facción por **arquetipo de IA y bonos**:

- **Reino consolidado** (grande, estable, conservador).
- **Ducado ambicioso** (mediano, expansionista — buen punto de inicio para el jugador).
- **Ciudad-estado mercantil** (rica, débil militarmente, diplomática).
- **Confederación tribal** (Norlander/Estepara: agresiva, incursora).
- **Teocracia** (impulsada por religión, cruzadas).
- **Remanente imperial** (reclama toda Aurelia; antagonista natural de fin de partida).

Cada facción tiene: gobernante (con rasgos), árbol dinástico, tesorería, ejércitos, relaciones diplomáticas, religión y cultura. **[Alcance v1]:** 3 arquetipos de IA (consolidado, ambicioso, tribal) para probar el bucle; el resto en Fase 2–3.

### 2.5 La capa mítica (inspiración *Game of Thrones*, con nombres originales)

El mundo es **baja fantasía**: nadie lanza hechizos y no hay dragones ni criaturas como unidades cotidianas. Lo mítico es **raro, antiguo y de altísimo peso** — igual que en *GoT*, casi todos lo tratan como superstición… hasta que deja de serlo. Tres elementos originales capturan ese espíritu:

**1. Los Pálidos y la Larga Escarcha (la amenaza existencial del norte).**
Los **Pálidos** son una hueste ancestral de los Yermos Blancos: guerreros de hielo que reaniman a los caídos. Durante casi toda la partida son solo leyenda del norte. En el **fin de partida** (Fase 3), si los inviernos se recrudecen y se cumplen ciertos umbrales, comienza **la Larga Escarcha**: los Pálidos rompen la Cerca y avanzan hacia el sur cada invierno, creciendo con cada muerto que levantan. Mecánicas:
- Son **casi inmunes al acero común** (lo resisten) y **aterrorizan** (fuerte penalización de moral a tropas cercanas). Solo el **vidrio ígneo** y el **acero estelar** los hieren de verdad.
- Convierten tus bajas —y las del enemigo— en más Pálidos: perder batallas contra ellos *fortalece* al enemigo.
- Fuerzan un dilema geopolítico brutal: seguir tu guerra dinástica o pactar una **Gran Tregua** con rivales para sobrevivir juntos. Quien ignore el norte demasiado tiempo puede despertar y ya no tener reino que salvar.

**2. Acero estelar (el metal legendario — equivalente al "acero valyrio").**
Forjado con **hierro caído** de meteoritos (lo que lo mantiene plausible dentro de la baja fantasía), el **acero estelar** es extraordinariamente raro. En todo Valdemar existen solo un puñado de **armas nombradas** (espadas ancestrales de casas antiguas). Cada una:
- Da un **gran bono** al héroe que la porta (ataque, moral, iniciativa) y **hiere plenamente a los Pálidos**.
- Es un **objeto del mundo**: se hereda, se puede **perder si el héroe muere** (queda en el campo para ser recuperada), **regalar en diplomacia**, exigir en un tratado de paz, o **saquear**. Poseer una es un objetivo geopolítico en sí mismo.
- No se puede fabricar (se perdió el arte); solo, quizá, **reforjar** una existente (evento raro).

**3. Vidrio ígneo (el material-contra minable — equivalente al "vidriodragón").**
Obsidiana negra extraíble solo en las provincias volcánicas de las **Fauces** (al sur). Es un **recurso estratégico**: barato de equipar pero de **suministro limitado**. Equipar unidades con puntas de vidrio ígneo las hace **efectivas contra los Pálidos**. Cuando empieza la Larga Escarcha, quien controle las Fauces controla la única mina de salvación → **carrera de recursos** y nuevo casus belli de fin de partida.

**Toque mítico menor (a lo largo de la partida):** reliquias antiguas, profecías (eventos con presagios que a veces aciertan), órdenes juramentadas que vigilan la Cerca, y rumores del norte. Sin magia jugable: todo se resuelve como eventos, objetos y unidades especiales.

**[Alcance por fases]:** toda la capa mítica es **contenido de Fase 3** (fin de partida). El vidrio ígneo puede existir como recurso "de lujo/raro" inerte desde antes, pero los Pálidos, el acero estelar nombrado y la Larga Escarcha se activan en Fase 3, cuando los cimientos ya son sólidos. Así el MVP no se infla y el mito llega como clímax.

---

## 3. Bucle de juego (game loop) y estructura del turno

### 3.1 Bucle macro
Fundar/heredar reino → expandir (guerra o diplomacia) → gestionar (economía, tecnología, religión, dinastía) → responder a eventos y guerras → alcanzar condición de victoria (o extinción de la dinastía = derrota).

### 3.2 El turno (estación)
Cada turno representa una **estación** (Primavera, Verano, Otoño, Invierno). 4 turnos = 1 año. La estación afecta clima de batalla, ingresos (cosecha en otoño), y campañas (invierno penaliza movimiento y atrición). Fases dentro de un turno del jugador:

1. **Fase de eventos:** se resuelven eventos pendientes (nacimientos, muertes, propuestas diplomáticas, revueltas).
2. **Fase de gestión:** ajustar impuestos, órdenes de construcción, asignar investigación, decretos.
3. **Fase de diplomacia:** proponer/aceptar tratados, matrimonios, declarar guerra/paz.
4. **Fase militar:** reclutar, mover ejércitos, iniciar asedios/batallas (una batalla táctica interrumpe el turno y abre la capa de combate).
5. **Fin de turno:** las facciones IA ejecutan sus turnos; se calculan ingresos, atrición, crecimiento y consecuencias.

**[Alcance v1]:** el ciclo completo de 5 fases, con IA por turnos simple pero funcional.

---

## 4. Capa estratégica: mapa y territorio

### 4.1 El mapa (Three.js)
Mapa 3D del continente con relieve real (elevación), dividido en **provincias** (unos 60–100 en el v1). Cámara con paneo, zoom y rotación. Cada provincia:

- Pertenece a una facción (color y estandarte).
- Tiene un **tipo de terreno** (llanura, colina, montaña, bosque, pantano, costa, estepa, desierto) que define recursos y el mapa de batalla que se genera si hay combate ahí.
- Tiene una **capital/asentamiento** con nivel (aldea → pueblo → ciudad → capital) y fortificación (sin muro → empalizada → muralla → ciudadela).
- Produce recursos y aporta población, reclutamiento e impuestos.

**Representación:** malla 3D con relieve + polígonos de provincia superpuestos (bordes que se iluminan al pasar el cursor). Los estandartes, ciudades y ejércitos son sprites/íconos 3D anclados al terreno. El detalle 3D es *del terreno y la ambientación*; las unidades y edificios pueden ser billboards (sprites siempre de cara a cámara) para ahorrar trabajo de modelado.

### 4.2 Provincias y control
Conquistar = tomar la capital de la provincia (asedio + batalla). El control genera **desgaste de ocupación** si la cultura/religión difiere (riesgo de revuelta), mitigable con guarniciones, conversión o gobernadores.

**[Alcance v1]:** mapa 3D con ~40 provincias, terreno, propiedad por facción, movimiento de ejércitos y toma de capitales.

### 4.3 Ejércitos en el mapa
Los ejércitos son **stacks** (agrupaciones de unidades con un general opcional) que se mueven entre provincias adyacentes. Puntos de movimiento por estación, modificados por terreno y clima. Al entrar en provincia enemiga con guarnición/ejército → se dispara batalla o asedio.

---

## 5. Recursos y economía

### 5.1 Recursos (diferentes tipos)
Dos categorías:

**Recursos básicos (flujo, se producen y consumen cada turno):**
- **Oro** — moneda universal (impuestos, comercio). Paga tropas, edificios, sobornos.
- **Alimento** — sostiene población y ejércitos; excedente = crecimiento, déficit = hambruna/atrición.
- **Mano de obra (levas)** — reserva de reclutamiento; se regenera con población.

**Recursos estratégicos (de provincia, habilitan tropas/edificios avanzados):**
- **Hierro** — armaduras y armas pesadas (infantería/caballería pesada).
- **Caballos** — caballería (abundante en estepa).
- **Madera** — asedio, barcos, fortificaciones.
- **Piedra** — murallas y ciudadelas.
- **Bienes de lujo** (sal, seda, especias, vino) — comercio y felicidad/legitimidad.
- **Vidrio ígneo** (obsidiana, solo en las Fauces volcánicas) — recurso mítico raro; equipa unidades contra los Pálidos. Suministro limitado → carrera de recursos en el fin de partida (ver 2.5). *Presente como recurso raro desde antes; su utilidad se activa con la Larga Escarcha en Fase 3.*
- **Acero estelar** — no se produce ni se mina: existe solo como **armas nombradas** únicas repartidas por el mundo (objetos de héroe, no un flujo). Ver 2.5 y 6.3.

### 5.2 Economía
- **Ingresos:** impuestos (ajustables, con tensión si son altos) + comercio (rutas entre provincias/facciones) + tributos.
- **Gastos:** mantenimiento de ejércitos, edificios, corte, sobornos diplomáticos.
- **Estabilidad/Legitimidad:** métrica que sube con buen gobierno y baja con guerra prolongada, impuestos altos, ocupaciones. Baja legitimidad → revueltas, pretendientes, secesiones.

**[Alcance v1]:** Oro, Alimento, Mano de obra + Hierro y Caballos como estratégicos. Comercio simple (bonus por provincia costera/ruta). Lujos y rutas complejas en Fase 3.

---

## 6. Facciones, dinastía y héroes

### 6.1 Dinastía y gobernante
El jugador controla una **casa**. El gobernante tiene atributos (**Mando militar, Administración, Diplomacia, Intriga**) y **rasgos** (Valiente, Cruel, Enfermizo, Genio, etc.) que afectan el juego. Los gobernantes envejecen y **mueren** (edad, batalla, enfermedad, asesinato) → sucesión. Si no hay heredero válido → crisis sucesoria o fin de la dinastía (derrota).

### 6.2 Herederos, matrimonios y sucesión
- **Matrimonios** (ver Diplomacia): generan herederos y lazos entre casas.
- **Ley de sucesión:** primogenitura (v1); electiva/senioral en fases futuras.
- Herederos con malos rasgos = riesgo; se pueden educar (asignar mentor/foco).

### 6.3 Héroes / Generales
Personajes especiales que lideran ejércitos y gobiernan provincias:

- **Generales:** dan bonos al stack (moral, iniciativa, tácticas especiales) y suben de nivel con victorias, desbloqueando habilidades (Carga, Muro de escudos, Emboscada).
- **Gobernadores:** administran provincias (más impuestos, menos revuelta).
- **Agentes** (Fase 3): diplomáticos, espías, obispos para acciones encubiertas (sabotaje, conversión, sobornos).

Los héroes tienen retrato, nombre cultural, rasgos y pueden **morir en batalla** o ser capturados. Al capturar a un héroe enemigo, el jugador **decide su destino** (con consecuencias diplomáticas): pedir **rescate** (oro, provincias o concesiones), **liberarlo** (mejora opinión/honor), **encarcelarlo** (mantiene la ventaja pero genera tensión) o **ejecutarlo** (elimina la amenaza, pero daña gravemente la opinión y puede desatar vendettas). Simétricamente, si *tu* héroe cae capturado, puedes negociar su rescate.

**Armas nombradas de acero estelar (ver 2.5):** un héroe puede **portar** una de las raras espadas de acero estelar del mundo. El arma es un objeto persistente que se hereda dentro de la casa; si el héroe muere en batalla, el arma **queda en el campo** y puede ser recuperada por el vencedor. Portar acero estelar es un símbolo de prestigio y una de las pocas defensas reales contra los Pálidos.

**[Alcance v1]:** gobernante con atributos/rasgos, herederos, sucesión por primogenitura, generales con 3–4 habilidades, y **permadeath con captura/rescate**. Gobernadores, agentes y las armas nombradas de acero estelar entran con la capa mítica (Fase 3).

---

## 7. Tropas: tipos, variantes y contadores

### 7.1 Categorías base (el "piedra-papel-tijera")
El sistema táctico se apoya en un triángulo de contadores claro y legible:

- **Infantería** (pesada/ligera): columna vertebral; buena vs caballería con lanzas, vulnerable a arqueros a distancia.
- **Caballería** (pesada/ligera/arqueros a caballo): rompe flancos y arqueros; sufre contra lanceros/piqueros formados.
- **A distancia** (arqueros, ballesteros, hondas): castiga infantería y desgasta antes del choque; frágil en cuerpo a cuerpo.
- **Lanceros/Piqueros** (especialistas anti-caballería): anclan la línea; lentos y débiles vs distancia.
- **Asedio** (arietes, torres, catapultas): solo relevante contra fortificaciones.

Regla mental para el jugador: *Lanza gana a Caballo, Caballo gana a Arco, Arco gana a Espada, Espada gana a Lanza.* Con matices de armadura, moral y terreno.

### 7.2 Estadísticas de unidad
Cada unidad tiene: Ataque, Defensa, Armadura, Daño, Alcance, Moral, Iniciativa/Velocidad, Salud del pelotón (nº de soldados), Coste (oro + recurso estratégico + mano de obra), y **requisitos** (edificio, tecnología, recurso, cultura/religión).

### 7.3 Variantes y desbloqueo (árbol de tropas)
Cada tipo base tiene **variantes** desbloqueables por tecnología, edificio, cultura o religión. Ejemplos:

- Infantería ligera → **Infantería de escudo** (tech: Escudos coordinados) → **Guardia veterana** (edificio: Cuartel nivel 3).
- Arqueros → **Ballesteros** (tech: Ballesta) → **Ballesteros de arco de acero / arqueros largos veteranos** (tech tardía de metalurgia; sin pólvora).
- Caballería ligera → **Caballería de choque** (tech: Estribo + recurso Hierro) → **Caballeros con blasón** (edificio: Orden de caballería + religión).
- Tropa **única cultural**: cada cultura tiene 1–2 unidades exclusivas (ej. *Asaltantes Norlander*, *Arqueros a caballo Estepara*, *Legionarios Aurelios*).

**[Alcance v1]:** 5 categorías base × 2 niveles + 1 unidad única por cultura jugable (~14–16 unidades). Variantes avanzadas y pólvora en Fase 3.

---

## 8. Sistema de batalla táctica (el corazón del combate)

Combate **por turnos en cuadrícula** (rejilla de casillas hexagonales o cuadradas — se recomienda **hexágonos** por mejor movimiento y flanqueo). Renderizado en **Phaser 3** (2D isométrico o cenital con sprites).

### 8.1 Preparación de batalla
- El **terreno del mapa de batalla se genera según la provincia** donde ocurre (bosque = árboles que bloquean visión y frenan caballería; colina = ventaja de alto; pantano = penaliza movimiento; costa/río = obstáculo).
- El **clima** proviene de la estación: lluvia (reduce alcance de arcos, embarra el terreno), nieve/invierno (atrición, movimiento lento), niebla (reduce visión), sol (normal). El defensor suele elegir despliegue; el atacante decide comprometerse o retirarse.
- **Fase de despliegue:** el jugador coloca sus pelotones en su zona; puede formar líneas, reservar caballería para flanqueo, y elegir formación.

### 8.2 Resolución por turnos
Orden por **Iniciativa**. En su activación, cada unidad puede **mover + una acción** (atacar cuerpo a cuerpo, disparar, cargar, adoptar formación, defender). Conceptos clave:

- **Zona de control y flanqueo:** atacar por flanco/retaguardia da bonos grandes → premia maniobra, no solo estadísticas.
- **Moral:** cada unidad tiene moral; bajas, flanqueos, muerte del general o unidades huyendo la reducen. A cero → **rota** (huye o se rinde). Las batallas se ganan quebrando la moral, no siempre aniquilando.
- **Altura y terreno:** alto terreno da bono a distancia y defensa; bosque da cobertura; ríos/puentes crean cuellos de botella.
- **Formaciones:** Muro de escudos (defensa vs frontal), Cuña (carga de caballería), Dispersa (vs proyectiles). Cambiar de formación cuesta la acción.
- **Habilidades de general:** aura de moral, orden de carga, emboscada, "¡Aguantad!". Limitadas por turno/cooldown.

### 8.3 Fin de batalla y consecuencias
Victoria por ruta/aniquilación del enemigo o por control de objetivos. Resultados: bajas reales aplicadas al stack, generales pueden morir/herirse/ser capturados, moral estratégica, y el ganador toma la provincia (o levanta el asedio). **Botín** y **prisioneros** = decisiones (ejecutar, liberar por rescate, reclutar).

### 8.4 Auto-resolución opcional
Para batallas menores, el jugador puede **auto-resolver** (cálculo con modificadores: fuerza, terreno, clima, general, moral) y ver un reporte narrado. Esto respeta el tiempo del jugador y es, además, el **motor de combate que la IA usa entre facciones**. *Nota de diseño:* la auto-resolución se construye primero porque también da el resultado de las batallas de la IA; el mapa táctico jugable se construye encima.

**[Alcance v1]:** cuadrícula hexagonal, terreno según provincia, clima básico (lluvia/nieve/niebla/sol), moral, flanqueo, altura, 3 formaciones, habilidades de general, y auto-resolución. Suficiente para batallas satisfactorias. Formaciones avanzadas y clima extendido después.

---

## 9. Fortalezas, construcción y asedios

### 9.1 Construcción
Cada asentamiento tiene ranuras de **edificios** que mejoran producción, reclutamiento, defensa e investigación:

- **Económicos:** granja, mina, mercado, puerto.
- **Militares:** cuartel (desbloquea/mejora tropas), establo, campo de tiro, fundición (hierro→armas), astillero.
- **Defensivos:** empalizada → muralla → **ciudadela** (niveles de fortificación).
- **Civiles/religiosos:** biblioteca (ciencia), templo (piedad/conversión), corte (legitimidad).

Construir cuesta oro + recursos + turnos. **[Alcance v1]:** ~10 edificios clave y 4 niveles de fortificación.

### 9.2 Fortalezas y asedios
Atacar una provincia fortificada = **asedio** antes de la batalla:

- El atacante rodea el asentamiento; cada turno de asedio reduce provisiones de la guarnición (o el atacante sufre atrición/enfermedad).
- El atacante puede **asaltar** (batalla táctica con muros: escaleras, arietes, torres de asedio, brechas de catapulta) o **esperar** a que se rinda por hambre.
- La **defensa** aprovecha muros (bonos enormes a defensa/distancia desde almenas). Las máquinas de asedio (recurso Madera) abren brechas que convierten el asalto en batalla campal dentro de la ciudadela.

**[Alcance v1]:** asedio por bloqueo (rendición por provisiones) + asalto como batalla táctica con una muralla simple y arietes/escaleras. Torres y brechas de catapulta en Fase 3.

---

## 10. Diplomacia

El sistema que hace la guerra "geopolítica". Toda facción tiene una **opinión** hacia las demás (afectada por acciones, cultura, religión, fronteras, traiciones).

### 10.1 Acciones diplomáticas
- **Tratados de paz:** alto el fuego, paz blanca, paz con cesión de provincias/oro (tras acumular **puntaje de guerra** en batallas y asedios).
- **Alianzas:** defensivas u ofensivas; arrastran a aliados a tus guerras (y a ti a las suyas).
- **Pactos de no agresión / tregua.**
- **Matrimonios:** casan miembros de ambas casas → lazo dinástico, mejora opinión, posibilita **reclamos hereditarios** sobre el otro reino (¡casus belli futuro, o unión pacífica si se extingue la otra línea!).
- **Tratados comerciales:** rutas que generan oro a ambos.
- **Vasallaje/tributo:** una facción débil se somete a cambio de protección.
- **Sobornos y favores:** oro por opinión, o por romper una alianza enemiga.
- **Casus belli:** motivos legítimos de guerra (reclamo, religión, insulto). Guerrear sin casus belli daña la legitimidad y la opinión de todos.

### 10.2 Guerra como estado diplomático
Declarar guerra abre un **estado de guerra** con objetivos y puntaje. La guerra genera **agotamiento bélico** (económico y de legitimidad) que presiona a ambos bandos a negociar. Esto evita guerras eternas y premia objetivos claros.

**[Alcance v1]:** opinión, casus belli básico (reclamo + religión), declarar/hacer la paz con puntaje de guerra, alianzas defensivas, no agresión y matrimonios (con lazo de opinión + herencia simple). Comercio, vasallaje y sobornos en Fase 2–3.

---

## 11. Ciencia y tecnología (árbol de mejoras)

Árbol de investigación que desbloquea tropas, edificios, mecánicas y bonos. El jugador asigna **puntos de investigación** (producidos por bibliotecas/población/cultura Sarradio) a una tecnología por vez (o varias ramas en paralelo en fases futuras).

### 11.1 Ramas propuestas
- **Militar:** metalurgia (armaduras, acero de mejor calidad), armamento (ballesta, pica, arco de acero — **sin pólvora**), tácticas (formaciones, habilidades de general), asedio (máquinas). En la era tardía, una rama especial permite **forjar puntas de vidrio ígneo** y estudiar la defensa contra los Pálidos.
- **Economía:** agricultura (alimento), acuñación (oro), comercio (rutas, mercados), ingeniería (edificios más baratos).
- **Estado:** administración (menos revuelta, más provincias controlables), leyes (sucesión, impuestos), burocracia.
- **Cultura/Fe:** teología (conversión, autoridad religiosa), erudición (más ciencia), diplomacia (mejores tratados).

Cada tecnología tiene requisitos (era, edificio, a veces recurso) y algunas son **exclusivas por cultura/religión** (asimetría). El árbol progresa por **eras** (Temprana → Alta → Tardía Edad Media), y avanzar de era desbloquea las siguientes ramas.

**[Alcance v1]:** ~20–25 tecnologías en 3 ramas (Militar, Economía, Estado) a lo largo de 2 eras, con una investigación activa a la vez. Cuarta rama, pólvora y tercera era en Fase 3.

---

## 12. Eventos, crónica y "juego emergente"

- **Eventos dinásticos:** nacimientos, muertes, enfermedades, bodas, traiciones, pretendientes.
- **Eventos de mundo:** hambrunas (invierno duro), plagas, revueltas campesinas, herejías, aparición del Remanente Imperial como amenaza tardía.
- **Presagios y el norte (capa mítica, Fase 3):** eventos que anticipan la Larga Escarcha (inviernos cada vez más duros, la Cerca que se resquebraja, exploradores que no regresan, profecías), el descubrimiento o pérdida de un arma de acero estelar, y el inicio formal de **la Larga Noche** como crisis de fin de partida (ver 2.5 y 13.1).
- **Decisiones con ramificación:** cada evento presenta 2–4 opciones con consecuencias (ej.: un noble se rebela → aplastar, negociar, o cederle tierras).
- **Crónica:** registro narrativo de la partida ("En el invierno del año 7, la Casa X tomó la ciudadela de Y") que da memoria e identidad a cada partida.

**[Alcance v1]:** ~15 eventos base (dinásticos + hambruna + revuelta) con decisiones. Biblioteca de eventos crece cada fase.

---

## 13. Progresión, condiciones de victoria e interfaz

### 13.1 Condiciones de victoria (elegibles al iniciar partida)
- **Conquista:** controlar X% del continente o todas las capitales.
- **Restauración imperial:** reunir las provincias del núcleo de Aurelia y proclamar el Imperio.
- **Dinástica:** colocar a tu sangre en N tronos (vía matrimonios/herencia).
- **Hegemonía:** ser la facción más poderosa (militar+económica+diplomática) durante N años.
- **La Larga Noche (supervivencia):** si se activa la Larga Escarcha, sobrevivir y **rechazar a los Pálidos** de vuelta al norte se convierte en una condición de victoria alternativa —a veces cooperando forzosamente con rivales— que puede eclipsar cualquier guerra dinástica en curso.
- **Derrota:** extinción de tu dinastía, pérdida de todas tus provincias, o ser arrasado por los Pálidos.

**[Alcance v1]:** Conquista + Derrota por extinción. Las demás, incluida la Larga Noche, en Fase 3.

### 13.2 Dirección de UI/UX
- **Capa de mundo (Three.js):** el mapa 3D con barra superior (recursos, fecha/estación, alertas), panel lateral contextual (provincia/ejército/facción seleccionada), y minimapa.
- **Capa de menús (HTML/CSS/SVG por encima del canvas):** diplomacia, árbol tecnológico (SVG interactivo), gestión de reino, dinastía, reportes. Se dibujan como HTML sobre el canvas para máxima nitidez y facilidad de iteración.
- **Capa de batalla (Phaser):** cuadrícula, panel de unidad, orden de iniciativa, botones de acción/formación/habilidad, indicador de clima y terreno.
- **Principios:** todo dato importante con **tooltip explicativo**; toda consecuencia con un "por qué" (ej. *−15 opinión: guerra sin casus belli*). Accesibilidad: daltonismo (patrones además de color en estandartes), escala de UI.

---

## 14. Arquitectura técnica

### 14.1 Stack y por qué
- **TypeScript** — todo el código. Tipado fuerte = menos bugs, y Fable 5 itera mejor sobre código tipado y modular.
- **Vite** — herramienta de build y servidor de desarrollo (rápido, estándar). Aquí es donde entra **Node**: como andamio de construcción, no como motor del juego.
- **Three.js** — render del **mapa estratégico 3D** (terreno con relieve, cámara, estandartes/ejércitos como billboards).
- **Phaser 3** — render de la **batalla táctica 2D** (cuadrícula, sprites, animaciones, partículas de clima).
- **HTML/CSS + SVG** (opcionalmente con un framework ligero como Preact/React solo si la UI crece) — **toda la interfaz** (menús, diplomacia, árbol tecnológico SVG). Se superpone al canvas.
- **Zustand o un store propio** — estado global del juego (una sola fuente de verdad serializable).
- **Guardado:** serialización del estado a JSON → IndexedDB/localStorage (partida local) y exportar/importar archivo. Sin backend en el v1.

**Nota sobre 3D + 2D juntos:** el mapa (Three.js) y la batalla (Phaser) son **escenas separadas** que no corren a la vez: al iniciar una batalla se oculta el mapa y se monta la escena Phaser; al terminar, se devuelve el resultado al estado y se vuelve al mapa. Esto mantiene el rendimiento y simplifica el desarrollo. Ambos comparten el mismo **modelo de datos** en TypeScript.

### 14.2 Principio de arquitectura: lógica separada del render
El **núcleo del juego (game core)** es TypeScript puro, sin dependencia de Three.js/Phaser: reglas, estado, resolución de combate, IA, economía. Los renderizadores (Three.js, Phaser, UI) **leen** el estado y **envían acciones**. Ventajas: se puede probar la lógica sin gráficos, cambiar el render sin tocar reglas, y la IA usa el mismo motor que el jugador.

```
/src
  /core            ← TypeScript puro, testeable, sin render
    /state         ← modelo de datos, store, guardado/carga
    /systems       ← economía, diplomacia, tecnología, dinastía, religión
    /combat        ← resolución táctica + auto-resolución (compartida con IA)
    /ai            ← toma de decisiones de facciones
    /content       ← datos: unidades, edificios, techs, eventos, culturas (JSON/TS)
  /render
    /world         ← escena Three.js del mapa estratégico
    /battle        ← escena Phaser de la batalla táctica
    /ui            ← componentes HTML/CSS/SVG (menús, diplomacia, tech tree)
  /assets          ← imágenes, sprites, íconos, modelos, audio
  main.ts          ← arranque, ensamblado de escenas
```

### 14.3 Modelo de datos (bosquejo)
Entidades núcleo (interfaces TypeScript): `GameState`, `Faction`, `Character` (gobernante/héroe), `Province`, `Settlement`, `Army`, `Unit`, `Technology`, `Building`, `DiplomaticRelation`, `Treaty`, `Religion`, `Culture`, `War`, `Event`. Todo el estado vive en `GameState` y es **serializable a JSON** (clave para guardar/cargar y para depurar con IA).

### 14.4 Datos como contenido (data-driven)
Unidades, edificios, tecnologías, culturas, religiones y eventos se definen como **datos** (archivos JSON/TS), no como código incrustado. Así se puede balancear, añadir contenido y (más adelante) permitir mods sin tocar la lógica. Esto también hace trivial que Fable 5 añada "una unidad nueva" editando un archivo de datos.

---

## 15. Pipeline de assets (imágenes y arte con IA)

Sí se pueden generar imágenes/assets con IA, y encajan perfecto con el estilo 2D. Plan de assets por tipo:

- **Terreno del mapa (Three.js):** texturas de terreno (llanura, bosque, montaña, etc.) y un mapa de altura. Estilo pintado/ilustrado coherente.
- **Fichas/sprites de unidad (Phaser):** una imagen por unidad (idle + ataque simple), estilo consistente. Empezar con "tokens"/estandartes y evolucionar a sprites animados.
- **Retratos de personajes:** gobernantes y héroes por cultura/edad/sexo (bibliotecas de retratos combinables).
- **Iconos de UI:** recursos, edificios, tecnologías, tropas (set coherente, SVG cuando sea posible).
- **Estandartes/heráldica:** generador de blasones por facción (combinaciones de escudo + carga + colores) — puede ser procedural con SVG.
- **Ambientación:** ilustraciones para eventos, pantallas de título, fondos de menú.

**Herramientas disponibles en esta sesión:** puedo generar imágenes, y también hay generación 3D (imagen→modelo GLB) si en el futuro quieres modelos reales en el mapa. Recomiendo empezar 2D e introducir 3D solo donde aporte.

**[Alcance v1]:** set mínimo coherente — 8 texturas de terreno, ~16 fichas de unidad, ~12 retratos base, set de iconos, y un generador de heráldica SVG simple.

---

## 16. Roadmap por fases (de MVP a juego completo)

Filosofía: **cada fase produce algo jugable.** No construimos todo y rezamos; construimos un juego pequeño y lo engordamos.

### Fase 0 — Cimientos técnicos (andamiaje)
Proyecto Vite + TypeScript. Estructura `/core` `/render`. `GameState` serializable, guardar/cargar. Escena Three.js con un mapa de prueba (10–15 provincias, selección, paneo/zoom). Bucle de turno vacío. *Entregable:* puedes hacer clic en provincias y pasar turnos.

### Fase 1 — MVP jugable (el "vertical slice")
Mapa de ~40 provincias. 3 facciones (tú + 2 IA). Recursos básicos (oro/alimento/mano de obra + hierro/caballos). Reclutar y mover ejércitos. **Batalla táctica jugable** (hexágonos, ~14 unidades, terreno según provincia, clima básico, moral, flanqueo, formaciones, general) + auto-resolución. Tomar capitales / conquista. IA que expande y pelea. Guardar/cargar. *Entregable:* **una guerra completa de principio a fin es divertida.**

### Fase 2 — Reino con profundidad
Diplomacia (alianzas, paz con puntaje de guerra, no agresión, matrimonios + herencia). Dinastía y sucesión (gobernante, herederos, muerte, rasgos). Construcción (edificios + niveles de fortificación) y **asedios**. Árbol tecnológico (2 eras, 3 ramas). Eventos (dinásticos + hambruna + revuelta). Religión básica (3 fes, conversión, casus belli religioso). *Entregable:* una **partida larga con decisiones geopolíticas** reales.

### Fase 3 — Gran estrategia completa
5 culturas y todas las variantes de tropa. Herejías, Pontífice/excomunión, cruzadas. Comercio/rutas y lujos. Vasallaje, sobornos, agentes/espías. Máquinas de asedio completas. 3ª era (armas de acero avanzadas/ballesta pesada, **sin pólvora**). Más condiciones de victoria (restauración imperial, dinástica, hegemonía). **Capa mítica completa (ver 2.5):** los Pálidos y la Larga Escarcha, armas nombradas de acero estelar, vidrio ígneo como recurso decisivo, la Gran Tregua y la condición de supervivencia "La Larga Noche". Remanente Imperial como amenaza rival de fin de partida. Crónica narrativa. Balance y pulido de IA. *Entregable:* el juego que describiste, completo.

### Fase 4 — Pulido y contenido
Más eventos, música/SFX, tutorial, dificultad ajustable, accesibilidad, optimización, y (opcional) backend para guardar en la nube o compartir partidas.

> Estimación de esfuerzo (con desarrollo asistido por IA, orientativa): Fase 0 ≈ arranque; Fase 1 = el grueso del trabajo técnico; Fases 2–3 son sobre todo **contenido y sistemas sobre cimientos ya sólidos**. La clave es no saltar a Fase 3 antes de que Fase 1 sea divertida.

---

## 17. Riesgos y decisiones abiertas

### 17.1 Riesgos principales y mitigación
1. **Alcance excesivo (el mayor riesgo).** Mitigación: el enfoque por fases y las notas [Alcance v1]. Regla de oro: *si Fase 1 no es divertida, no añadir Fase 2.*
2. **IA de facciones poco convincente.** Mitigación: empezar con IA de reglas simples (evaluar amenazas, expandir al vecino débil, aceptar paz cuando pierde) y mejorar por capas. La auto-resolución compartida ayuda.
3. **Batalla táctica demasiado compleja de balancear.** Mitigación: triángulo de contadores claro + moral como mecánica decisiva; pocas unidades bien diferenciadas antes que muchas confusas.
4. **Rendimiento 3D en navegador.** Mitigación: terreno 3D pero unidades/edificios como billboards; provincias limitadas; escenas separadas mapa/batalla.
5. **Coherencia visual del arte IA.** Mitigación: definir un "art bible" (paleta, estilo, prompts base) antes de generar en masa.

### 17.2 Decisiones — RESUELTAS ✔
Todas las decisiones fundamentales quedaron confirmadas:

1. **Cuadrícula de batalla:** ✔ **Hexagonal** (mejor flanqueo/movimiento).
2. **Pólvora:** ✔ **No.** El juego se queda en armas de acero/ballesta en todas las eras. La tecnología tardía avanza en metalurgia y tácticas, no en pólvora.
3. **Tamaño del mapa v1:** ✔ **~40 provincias.**
4. **Escala de tiempo:** ✔ **4 estaciones/año, gobernantes mortales** (habilita el pilar dinástico).
5. **Nombre del juego:** ✔ **Reinos de Hierro.**
6. **Inicio de partida:** ✔ **Elegir una casa/facción pre-hecha** en el v1. El **editor de casa y heráldica personalizada** se profundiza en fases posteriores.
7. **Nivel de fantasía:** ✔ **Baja fantasía con toque mítico estilo *GoT*** (ver 2.5): sin magia jugable, pero con la amenaza de los Pálidos/Larga Escarcha, el acero estelar (metal legendario) y el vidrio ígneo (material-contra). Todo como capa de fin de partida en Fase 3.
8. **Permadeath de héroes:** ✔ **Sí**, con **captura y opciones de rescate** (rescate/liberar/encarcelar/ejecutar), en ambos sentidos.

> No quedan decisiones bloqueantes. El siguiente movimiento es puramente de ejecución (Fase 0).

---

## Apéndice A — Glosario rápido
- **Capa estratégica / táctica:** el mapa grande / la batalla en cuadrícula.
- **Stack (ejército):** grupo de unidades que se mueve junto por el mapa.
- **Casus belli:** motivo legítimo para declarar guerra sin penalización.
- **Puntaje de guerra:** medida de quién va ganando una guerra; habilita términos de paz.
- **Agotamiento bélico:** desgaste que empuja a negociar la paz.
- **Auto-resolución:** cálculo automático de una batalla sin jugarla en cuadrícula.
- **Data-driven:** el contenido (unidades, techs) vive en datos editables, no en código.

## Apéndice B — Próximo paso sugerido
Cuando quieras arrancar la construcción, el primer entregable es la **Fase 0** (andamiaje Vite + TypeScript + escena Three.js con mapa de prueba y bucle de turno). Puedo generarlo como proyecto de código, junto con el primer set de assets del "art bible". Solo dilo y empezamos.
