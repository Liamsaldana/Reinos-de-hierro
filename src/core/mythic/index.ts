/**
 * LA CAPA MÍTICA (Fase 3, GDD §2.5 y §13.1) — el clímax de Reinos de Hierro:
 * los Pálidos, la Larga Escarcha, el acero estelar, el vidrio ígneo y la Gran
 * Tregua. Es la carta de amor a *Game of Thrones* del proyecto, con nombres
 * originales y baja fantasía: nada de magia jugable, solo un horror antiguo que
 * el norte creía superstición… hasta que la Cerca cae.
 *
 * NÚCLEO PURO: no importa DOM ni Three.js. Toda la aleatoriedad sale del `Rng`
 * que recibe (nunca Math.random/Date.now), así la partida se reproduce byte a
 * byte. Todo lo que muta vive en `GameState.mythic` (types.ts), que es opcional
 * — los mutadores lo rellenan con `ensureMythic`; los lectores puros
 * (`palidosResistanceFactor`, `weaponOfGeneral`) NUNCA lo mutan.
 *
 * -------------------------------------------------------------------------
 * CABLEADO PARA EL INTEGRADOR (lo que otro agente/tú debe conectar):
 *
 *  1. turn.ts `endTurn`: llamar `tickMythic(state, rng)` UNA VEZ por turno,
 *     ANTES del chequeo de victoria (paso 8). Este módulo FIJA el `outcome`
 *     mítico por su cuenta; el paso 8 de turn.ts debe respetar un outcome ya
 *     distinto de 'ongoing' (ya lo hace: `if (state.outcome === 'ongoing')`).
 *
 *  2. turn.ts paso 7 (eliminación de facciones sin provincias) DEBE EXIMIR a
 *     los Pálidos: son una HUESTE, no un reino — viven mientras tengan
 *     ejércitos, aunque no posean provincia alguna. Añade `&& faction.ai !==
 *     'palidos'` a la condición que marca `faction.alive = false`.
 *
 *  3. turn.ts paso 2 (IA) y ai/factionAI.ts DEBEN saltarse a los Pálidos: su
 *     avance lo conduce `tickMythic` (vía `moveArmy`), no `runFactionAI`. En
 *     factionAI el guard inicial debería ser `... || faction.ai === 'palidos'`.
 *
 *  4. combat/autoresolve.ts: multiplicar la fuerza de cada bando por
 *     `palidosResistanceFactor(state, army, enemyFactionId)` cuando el bando
 *     CONTRARIO sea 'los_palidos' (el acero común resbala; el vidrio/acero
 *     estelar muerde). Y sumar `weaponOfGeneral(state, generalId)?.bonusMartial`
 *     al `martial` del general portador al calcular `generalMultiplier`.
 *
 *  5. main.ts: `initNortePanel(store)` (render/ui/nortePanel.ts).
 *
 *  6. content/techs.ts (OTRO agente, en paralelo): añadir la tecnología
 *     `talla_de_vidrio_igneo` (rama militar, era 2). Mientras no exista,
 *     `equipVidrio` la trata como no-hecha (isTechDone → false) y falla limpio.
 * -------------------------------------------------------------------------
 */
import type {
  ActionResult,
} from '../systems/actions';
import type {
  Army, ArmyId, Character, CharacterId, FactionId, GameState, MythicState,
  NamedWeapon, Province, ProvinceId, TechId, UnitInstance,
} from '../types';
import { relKey, seasonOf } from '../types';
import type { Rng } from '../state/rng';
import { getUnitType } from '../content/units';
import { legalMoves, moveArmy } from '../systems/actions';
import { isTechDone } from '../systems/research';
// Efecto de importación: registra 'palido' y 'engendro_de_escarcha' en UNIT_TYPES.
import '../content/mythicUnits';

// ---------- constantes de la capa mítica ----------

/** La hueste de los Yermos: una facción sintética, sin reino propio. */
export const PALIDOS_FACTION_ID: FactionId = 'los_palidos';

/** Tecnología que habilita equipar vidrio ígneo (la añade otro agente a techs.ts). */
export const VIDRIO_TECH: TechId = 'talla_de_vidrio_igneo';

/** Oro por equipar un ejército con puntas de vidrio ígneo. */
export const VIDRIO_COST = 40;

/**
 * Umbral de turno para la Larga Escarcha. Es 44 (no 36) a propósito: el harness
 * de simulación sin jugador (`tests/simulation.test.ts`) corre hasta 40 turnos
 * (semilla 11). Con el umbral en 36, el primer invierno elegible (turno 39, o
 * cualquier turno ≥36 con los 6 presagios ya narrados) dispararía la escarcha
 * DENTRO de esa ventana, spawneando la facción 'los_palidos' — que turn.ts, sin
 * el parche del punto 2 de la cabecera, borraría al instante por no tener
 * provincias, rompiendo invariantes/determinismo del sim. Con 44, el primer
 * turno elegible es el 44 (≥ el 47 si se exige invierno), fuera de TODA ventana
 * del sim. El mito sigue llegando como clímax de las partidas largas de verdad.
 */
export const ESCARCHA_MIN_TURN = 44;

/** Nombres de las tres hojas de acero estelar del mundo (GDD §2.5, §6.3). */
export const NAMED_WEAPON_NAMES = ['Alba de Invierno', 'Lamento del Cuervo', 'Juramento de Aurelia'] as const;

/** Bono de mando (martial) del acero estelar a su portador. */
export const NAMED_WEAPON_BONUS = 3;

/**
 * La cadena de presagios del norte, EN ORDEN (GDD §12, §2.5). Cada invierno con
 * severidad creciente desvela el siguiente, hasta que la Cerca cae y solo queda
 * la Larga Escarcha. Son 6: cuando el sexto se narra, el mundo está maduro para
 * el fin de partida.
 */
export const PRESAGIO_CHAIN = [
  'Los inviernos se alargan más de lo que ningún anciano recuerda: la escarcha llega antes y se marcha tarde, si es que llega a marcharse.',
  'Del norte llega la noticia: la vieja Cerca imperial se resquebraja, y el viento aúlla por sus grietas como si algo, al otro lado, le respondiera.',
  'Los exploradores enviados más allá de la Cerca no regresan. Ni sus monturas. Ni un solo cuervo con su mensaje atado a la pata.',
  'Aldeas enteras del norte amanecen vacías: hogueras a medio arder, mesas servidas, telares a medio tejer, y ni un alma que dé razón de los suyos.',
  'Los pocos que huyen del norte solo repiten, con los ojos idos: «los muertos caminan, y sus ojos son de hielo azul».',
  'LA CERCA HA CAÍDO. Lo que dormía en los Yermos Blancos ha despertado, y marcha hacia el sur bajo una noche que no conoce el alba.',
] as const;

// ---------- helpers internos ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Provincias ordenadas de norte (menor z) a sur (mayor z); desempate por id. */
function provincesByNorth(state: GameState): Province[] {
  return [...state.provinces].sort((a, b) => a.center[1] - b.center[1] || a.id - b.id);
}

function palidoArmies(state: GameState): Army[] {
  return Object.values(state.armies)
    .filter((a) => a.factionId === PALIDOS_FACTION_ID)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function palidoProvinces(state: GameState): Province[] {
  return state.provinces.filter((p) => p.ownerId === PALIDOS_FACTION_ID);
}

// ---------- estado mítico ----------

/**
 * Garantiza y devuelve `state.mythic` con forma completa (defaults neutros).
 * Idempotente: si ya existe, NO reinicia nada — solo rellena `vidrioArmies` si
 * un save antiguo no lo traía. Es el único punto que MUTA para crear el estado.
 */
export function ensureMythic(state: GameState): MythicState {
  const m = (state.mythic ??= {
    winterSeverity: 0,
    presagios: 0,
    escarchaActive: false,
    granTregua: false,
    namedWeapons: [],
    vidrioArmies: [],
  });
  m.vidrioArmies ??= [];
  return m;
}

// ---------- armas nombradas (acero estelar) ----------

/** El arma nombrada que porta este general, o null. Lectura PURA (no muta). */
export function weaponOfGeneral(state: GameState, generalId: CharacterId | null): NamedWeapon | null {
  if (!generalId) return null;
  const weapons = state.mythic?.namedWeapons;
  if (!weapons) return null;
  return weapons.find((w) => w.bearerCharacterId === generalId) ?? null;
}

/**
 * Siembra las tres hojas de acero estelar (una sola vez, con ≥2 presagios): dos
 * en manos de generales vivos de dos casas IA DISTINTAS, una perdida en el
 * norte. Determinista sin gastar Rng (orden estable de facciones/personajes).
 */
function seedWeapons(state: GameState): string[] {
  const m = ensureMythic(state);
  if (m.namedWeapons.length > 0) return [];

  // primer general vivo de cada casa IA (no jugador, no Pálidos), casas distintas
  const bearers: CharacterId[] = [];
  for (const fid of Object.keys(state.factions)) {
    const f = state.factions[fid];
    if (!f.alive || f.ai === 'player' || f.ai === 'palidos') continue;
    const gen = Object.values(state.characters).find(
      (c) => c.factionId === fid && c.role === 'general' && c.alive,
    );
    if (gen) bearers.push(gen.id);
    if (bearers.length >= 2) break;
  }

  const northId = provincesByNorth(state)[0]?.id ?? null;
  m.namedWeapons = NAMED_WEAPON_NAMES.map((name, i): NamedWeapon => {
    const bearer = i < 2 ? bearers[i] ?? null : null;
    return {
      id: `starsteel_${i + 1}`,
      name,
      bearerCharacterId: bearer,
      lostInProvinceId: bearer ? null : northId,
      bonusMartial: NAMED_WEAPON_BONUS,
    };
  });

  const text = 'De túmulos olvidados y viejas forjas regresan a la luz tres hojas de acero estelar —Alba de Invierno, Lamento del Cuervo y Juramento de Aurelia—, el único acero que, junto al vidrio ígneo, muerde de verdad la carne de los Pálidos.';
  state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
  return [text];
}

/**
 * Mejor provincia donde "cae" un arma cuyo portador murió. autoresolve/turn
 * LIMPIAN `army.generalId` al morir el general ANTES de que `tickMythic` lo vea,
 * así que no se puede localizar su ejército por el general; v1 aproxima el lugar
 * de caída en este orden, documentado:
 *   1) la última batalla, si la casa del portador combatió en ella (caso común:
 *      los generales mueren en batalla y `state.lastBattle` guarda esa provincia);
 *   2) la capital de su casa (o cualquier provincia suya);
 *   3) donde ya estuviera antes; 4) el norte, como último recurso.
 */
function dropProvinceFor(state: GameState, bearer: Character | undefined, weapon: NamedWeapon): ProvinceId {
  const lb = state.lastBattle;
  if (bearer && lb && (lb.attacker.factionId === bearer.factionId || lb.defender.factionId === bearer.factionId)) {
    return lb.provinceId;
  }
  if (bearer) {
    const owned = state.provinces.filter((p) => p.ownerId === bearer.factionId);
    const cap = owned.find((p) => p.settlement.level === 4) ?? owned[0];
    if (cap) return cap.id;
  }
  if (weapon.lostInProvinceId != null) return weapon.lostInProvinceId;
  return provincesByNorth(state)[0]?.id ?? state.provinces[0]?.id ?? 0;
}

/** Un portador muerto suelta su hoja al campo (queda `lostInProvinceId`). */
function checkFallenBearers(state: GameState): string[] {
  const m = state.mythic;
  if (!m || m.namedWeapons.length === 0) return [];
  const msgs: string[] = [];
  for (const w of m.namedWeapons) {
    if (!w.bearerCharacterId) continue;
    const bearer = state.characters[w.bearerCharacterId];
    if (bearer && bearer.alive) continue; // sigue portándola
    const dropId = dropProvinceFor(state, bearer, w);
    w.bearerCharacterId = null;
    w.lostInProvinceId = dropId;
    const who = bearer?.name ?? 'su portador';
    const pname = state.provinces.find((p) => p.id === dropId)?.name ?? 'el campo';
    const text = `Al caer ${who}, ${w.name} quedó sobre la nieve de ${pname}, aguardando la mano digna que vuelva a levantarla.`;
    state.chronicle.push({ turn: state.turn, kind: 'dinastia', text });
    msgs.push(text);
  }
  return msgs;
}

/**
 * Un ejército con general vivo, plantado en la provincia donde yace un arma
 * perdida, la reclama para su general. v1: fija el portador y narra; el BONO DE
 * MANDO efectivo lo aplica el integrador en autoresolve sumando
 * `bonusMartial` al `martial` del general (ver punto 4 de la cabecera).
 */
export function claimLostWeapon(state: GameState, armyId: ArmyId): ActionResult {
  ensureMythic(state);
  const army = state.armies[armyId];
  if (!army) return { ok: false, message: 'Ejército no encontrado.' };
  if (!army.generalId) {
    return { ok: false, message: 'Solo un general puede alzar un arma nombrada; este ejército no lleva ninguno.' };
  }
  const gen = state.characters[army.generalId];
  if (!gen || !gen.alive) {
    return { ok: false, message: 'El general de este ejército no está en condiciones de reclamar nada.' };
  }
  const weapon = state.mythic!.namedWeapons.find(
    (w) => w.bearerCharacterId == null && w.lostInProvinceId === army.provinceId,
  );
  if (!weapon) {
    return { ok: false, message: 'No yace aquí ningún arma nombrada que reclamar.' };
  }
  weapon.bearerCharacterId = gen.id;
  weapon.lostInProvinceId = null;
  const pname = state.provinces.find((p) => p.id === army.provinceId)?.name ?? 'el campo';
  const text = `${gen.name} alza ${weapon.name} del campo de ${pname}: el acero estelar vuelve a tener dueño.`;
  state.chronicle.push({ turn: state.turn, kind: 'dinastia', text });
  return { ok: true, message: text };
}

// ---------- vidrio ígneo ----------

/**
 * Validación PURA (no muta) de los requisitos de `equipVidrio`. La comparte la
 * UI (`canEquipVidrio`) para decidir si mostrar el botón, sin cobrar oro.
 */
function validateEquipVidrio(state: GameState, armyId: ArmyId): ActionResult {
  const army = state.armies[armyId];
  if (!army) return { ok: false, message: 'Ejército no encontrado.' };
  const faction = state.factions[army.factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };
  const ownsVidrio = state.provinces.some((p) => p.ownerId === army.factionId && p.vidrioIgneo);
  if (!ownsVidrio) {
    return { ok: false, message: 'No controlas ninguna provincia con vidrio ígneo (solo las Fauces lo dan).' };
  }
  if (!isTechDone(state, army.factionId, VIDRIO_TECH)) {
    return { ok: false, message: 'Aún no dominas la talla del vidrio ígneo.' };
  }
  if ((state.mythic?.vidrioArmies ?? []).includes(armyId)) {
    return { ok: false, message: `${army.name} ya porta puntas de vidrio ígneo.` };
  }
  if (faction.gold < VIDRIO_COST) {
    return { ok: false, message: `Equipar el vidrio ígneo cuesta ${VIDRIO_COST} de oro; el tesoro no llega.` };
  }
  return { ok: true, message: '' };
}

/** ¿Puede este ejército equipar vidrio ígneo AHORA? (para la UI; no muta). */
export function canEquipVidrio(state: GameState, armyId: ArmyId): boolean {
  return validateEquipVidrio(state, armyId).ok;
}

/**
 * Equipa un ejército propio con puntas de vidrio ígneo (GDD §2.5): requiere
 * controlar ≥1 provincia con vidrio ígneo, la tecnología `talla_de_vidrio_igneo`
 * hecha, y 40 de oro. Lo añade a `mythic.vidrioArmies` — a partir de ahí muerde
 * a los Pálidos a 1.25× en vez de a 0.45× (ver `palidosResistanceFactor`).
 */
export function equipVidrio(state: GameState, armyId: ArmyId): ActionResult {
  const m = ensureMythic(state);
  const check = validateEquipVidrio(state, armyId);
  if (!check.ok) return check;
  const army = state.armies[armyId];
  const faction = state.factions[army.factionId];
  faction.gold -= VIDRIO_COST;
  m.vidrioArmies!.push(armyId);
  return {
    ok: true,
    message: `${army.name} engasta puntas de vidrio ígneo en sus armas: ahora su filo hiere de verdad a los Pálidos.`,
  };
}

/**
 * FACTOR DE RESISTENCIA DE LOS PÁLIDOS (PURA — la enchufa el integrador en
 * autoresolve). Multiplica la fuerza efectiva del ejército `army` cuando su
 * ENEMIGO es la hueste de los Pálidos:
 *
 *   · enemigo NO es 'los_palidos'                        → 1     (batalla normal)
 *   · enemigo es 'los_palidos', ejército SIN vidrio ni   → 0.45  (el acero
 *     acero estelar (arma nombrada en su general)                 común resbala)
 *   · enemigo es 'los_palidos', ejército CON vidrio ígneo → 1.25  (vidrio/acero
 *     O con un general portador de arma nombrada                   estelar muerde)
 *
 * "Portar arma nombrada" = el único general del ejército (army.generalId) es
 * portador de alguna `NamedWeapon` (ver `weaponOfGeneral`).
 */
export function palidosResistanceFactor(
  state: GameState, army: Army, enemyFactionId: FactionId,
): number {
  if (enemyFactionId !== PALIDOS_FACTION_ID) return 1;
  const equipped = state.mythic?.vidrioArmies?.includes(army.id) ?? false;
  const bearsNamed = weaponOfGeneral(state, army.generalId) != null;
  return equipped || bearsNamed ? 1.25 : 0.45;
}

// ---------- la Gran Tregua ----------

/**
 * Sella la Gran Tregua entre las casas vivas (GDD §2.5): solo durante la Larga
 * Escarcha y una sola vez. TODAS las guerras entre casas (no las de los Pálidos)
 * terminan en paz blanca; se firma tregua (truceUntilTurn = turno+40) entre cada
 * par de casas vivas para que nadie reabra el frente mientras el hielo avanza.
 */
export function sellarGranTregua(state: GameState): ActionResult {
  const m = ensureMythic(state);
  if (!m.escarchaActive) {
    return { ok: false, message: 'La Gran Tregua solo puede sellarse una vez comenzada la Larga Escarcha.' };
  }
  if (m.granTregua) {
    return { ok: false, message: 'La Gran Tregua ya está sellada: las casas ya marchan juntas.' };
  }

  // se conservan solo las guerras que involucran a los Pálidos
  state.wars = state.wars.filter(
    (w) => w.attackerId === PALIDOS_FACTION_ID || w.defenderId === PALIDOS_FACTION_ID,
  );

  const houses = Object.keys(state.factions).filter(
    (id) => state.factions[id].alive && state.factions[id].ai !== 'palidos',
  );
  const until = state.turn + 40;
  for (let i = 0; i < houses.length; i++) {
    for (let j = i + 1; j < houses.length; j++) {
      const key = relKey(houses[i], houses[j]);
      const rel = state.relations[key] ?? (state.relations[key] = { opinion: 0, treaties: [] });
      rel.truceUntilTurn = until;
      rel.opinion = clamp(rel.opinion + 15, -100, 100); // el enemigo común calienta las cortes
    }
  }

  m.granTregua = true;
  const text = 'Por primera vez en tres generaciones, los estandartes de Valdemar marchan juntos: se sella la Gran Tregua, y las casas envainan sus rencores para alzar sus lanzas contra los Pálidos.';
  state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
  return { ok: true, message: text };
}

// ---------- la Larga Escarcha ----------

/**
 * Dispara la Larga Escarcha (una sola vez; idempotente si ya está activa).
 * Exportada además de para `tickMythic` para tests y eventos (un evento raro del
 * norte podría precipitarla). Crea la facción-hueste 'los_palidos', declara sus
 * guerras SIN pagar legitimidad, y spawnea dos huestes en el extremo norte.
 */
export function forceEscarcha(state: GameState, rng: Rng): string[] {
  void rng; // el spawn es determinista; la firma lleva rng por coherencia/uso futuro
  const m = ensureMythic(state);
  if (m.escarchaActive) return [];
  m.escarchaActive = true;
  m.escarchaStartedTurn = state.turn;

  // 1) el Señor de la Escarcha y la facción-hueste. cultureId/religionId son
  //    solo para satisfacer el tipo Faction (los Pálidos no negocian ni rezan).
  //    age 40: modesto a propósito, para esquivar la mortalidad de invierno de
  //    turn.ts (age>52) de un ser que la leyenda hace milenario.
  const lordId: CharacterId = `${PALIDOS_FACTION_ID}_lord`;
  state.characters[lordId] = {
    id: lordId,
    name: 'El Señor de la Escarcha',
    factionId: PALIDOS_FACTION_ID,
    role: 'ruler',
    age: 40,
    attributes: { martial: 10, stewardship: 0, diplomacy: 0, intrigue: 0 },
    traits: ['implacable'],
    alive: true,
  };
  state.factions[PALIDOS_FACTION_ID] = {
    id: PALIDOS_FACTION_ID,
    name: 'Los Pálidos',
    dynastyName: 'Los Pálidos',
    cultureId: 'norlander',
    religionId: 'viejos_pactos',
    colorPrimary: '#9fb4c0',
    colorSecondary: '#e8f0f4',
    bannerSeed: 0,
    ai: 'palidos',
    rulerId: lordId,
    heirId: null,
    gold: 0,
    manpower: 0,
    foodStock: 0,
    legitimacy: 0,
    alive: true,
  };

  // 2) guerra directa contra cada casa viva (sin `declareWar`: no pagan legitimidad).
  for (const fid of Object.keys(state.factions)) {
    const f = state.factions[fid];
    if (fid === PALIDOS_FACTION_ID || !f.alive || f.ai === 'palidos') continue;
    state.wars.push({
      id: `war_palidos_${fid}_${state.turn}`,
      attackerId: PALIDOS_FACTION_ID,
      defenderId: fid,
      cb: 'sin_causa',
      warScore: 0,
      exhaustionAttacker: 0,
      exhaustionDefender: 0,
      startedTurn: state.turn,
    });
  }

  // 3) dos huestes en las dos provincias más al norte (menor z): 4 Pálidos + 1 engendro.
  const north = provincesByNorth(state).slice(0, 2);
  const palidoT = getUnitType('palido');
  const engendroT = getUnitType('engendro_de_escarcha');
  north.forEach((prov, i) => {
    const units: UnitInstance[] = [];
    for (let k = 0; k < 4; k++) {
      units.push({ typeId: 'palido', men: palidoT.menMax, morale: palidoT.moraleMax, xp: 0 });
    }
    units.push({ typeId: 'engendro_de_escarcha', men: engendroT.menMax, morale: engendroT.moraleMax, xp: 0 });
    const armyId: ArmyId = `army_palidos_${i + 1}`;
    state.armies[armyId] = {
      id: armyId,
      name: i === 0 ? 'La Vanguardia de Hielo' : 'La Hueste de la Escarcha',
      factionId: PALIDOS_FACTION_ID,
      provinceId: prov.id,
      units,
      generalId: null,
      movement: 2,
      movementMax: 2,
    };
  });

  const text = 'LA LARGA ESCARCHA HA COMENZADO. Los Pálidos rompen lo que quedaba de la Cerca y descienden sobre Valdemar; cada caído, de uno u otro bando, se alza bajo su estandarte de hielo. Que las casas elijan: seguir su guerra de siempre, o sobrevivir juntas.';
  state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
  return [text];
}

/** El engorde de invierno: "los caídos se levantan" (+1 Pálido a una hueste). */
function growPalidos(state: GameState): string | null {
  const armies = palidoArmies(state);
  if (armies.length === 0) return null;
  // engorda la hueste con menos unidades (se mantienen parejas); desempate por id.
  let target = armies[0];
  for (const a of armies) {
    if (a.units.length < target.units.length) target = a;
  }
  const t = getUnitType('palido');
  target.units.push({ typeId: 'palido', men: t.menMax, morale: t.moraleMax, xp: 0 });
  const text = 'Los caídos de la última contienda se alzan de nuevo bajo el estandarte de hielo: la hueste de los Pálidos crece.';
  state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
  return text;
}

/**
 * Mejor salto al SUR para una hueste pálida: vecino LEGAL con mayor z (más al
 * sur) que la provincia actual; a igualdad de rumbo, se prefiere el asentamiento
 * mayor (ciudades antes que aldeas) y se penaliza pisar tierra ya pálida (para
 * seguir conquistando, no pasear sobre lo tomado). null si no hay avance al sur.
 */
function southwardTarget(state: GameState, army: Army): ProvinceId | null {
  const here = state.provinces.find((p) => p.id === army.provinceId);
  if (!here) return null;
  const legal = new Set(legalMoves(state, army.id));
  let best: { id: ProvinceId; score: number } | null = null;
  for (const nid of here.neighbors) {
    if (!legal.has(nid)) continue;
    const np = state.provinces.find((p) => p.id === nid);
    if (!np || np.center[1] <= here.center[1]) continue; // solo hacia el sur (mayor z)
    const score = np.center[1] + np.settlement.level * 4 - (np.ownerId === PALIDOS_FACTION_ID ? 1000 : 0);
    if (!best || score > best.score || (score === best.score && nid < best.id)) {
      best = { id: nid, score };
    }
  }
  return best?.id ?? null;
}

/**
 * Cada hueste pálida da UN paso al sur con `moveArmy` (que resuelve sus batallas
 * y, si conquista, registra la crónica vía `occupyProvince`). Resetea el
 * movimiento de las huestes al inicio para que el avance funcione tanto llamado
 * desde `endTurn` (donde ya se resetea) como directamente en los tests.
 */
function advancePalidos(state: GameState, rng: Rng): string[] {
  const msgs: string[] = [];
  for (const army of palidoArmies(state)) {
    army.movement = army.movementMax;
    const target = southwardTarget(state, army);
    if (target === null) continue;
    const before = state.provinces.find((p) => p.id === target)?.ownerId ?? null;
    const res = moveArmy(state, rng, army.id, target);
    if (res.ok) {
      const np = state.provinces.find((p) => p.id === target);
      if (np && np.ownerId === PALIDOS_FACTION_ID && before !== PALIDOS_FACTION_ID) {
        msgs.push(`La marea pálida se apodera de ${np.name}.`);
      }
    }
  }
  return msgs;
}

/**
 * Resuelve el desenlace de la Larga Noche (GDD §13.1). Solo se llama cuando la
 * escarcha YA estaba en marcha al empezar el turno (nunca el mismo turno del
 * spawn), así la hueste tiene al menos una marcha antes de que se pueda declarar
 * victoria por exterminio.
 */
function resolveLongNight(state: GameState): string[] {
  const armyCount = palidoArmies(state).length;
  const provs = palidoProvinces(state).length;
  const total = state.provinces.length;
  const playerProvs = state.provinces.filter((p) => p.ownerId === state.playerFactionId).length;

  // VICTORIA: la última hueste se deshace y no queda tierra pálida.
  if (armyCount === 0 && provs === 0) {
    state.outcome = 'victory_larga_noche';
    const text = 'La última hueste pálida se deshace en escarcha bajo un sol que creían perdido: Valdemar ha sobrevivido a la Larga Noche. Los estandartes que marcharon juntos vuelven a casa convertidos en leyenda.';
    state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
    return [text];
  }

  // DERROTA: la marea pálida anega el mundo (≥40%) o borra el reino del jugador.
  const overrun = total > 0 && provs / total >= 0.40;
  const playerFell = playerProvs === 0 && provs > 0;
  if (overrun || playerFell) {
    state.outcome = 'defeat_palidos';
    const text = 'La Larga Noche cae sobre Valdemar: los Pálidos anegan el mundo de los vivos, y ya no queda reino ni rey que oponer al hielo.';
    state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
    return [text];
  }
  return [];
}

/**
 * EL PULSO MÍTICO — se llama UNA vez por turno (integrador, en `endTurn`, antes
 * del chequeo de victoria). Devuelve las líneas narradas (español) del turno;
 * todas se han empujado también a `state.chronicle`, así que el integrador debe
 * usar el retorno O el corte de crónica, no ambos, para no duplicar.
 *
 * Orden: (a) inviernos y presagios · (b) siembra de acero estelar · armas
 * caídas · (c) disparo de la Larga Escarcha · (d) crecimiento y avance pálido ·
 * (e) desenlace de la Larga Noche.
 */
export function tickMythic(state: GameState, rng: Rng): string[] {
  const m = ensureMythic(state);
  const messages: string[] = [];
  const wasEscarcha = m.escarchaActive;
  const isWinter = seasonOf(state.turn) === 3;

  // (a) INVIERNOS: sube la severidad y, si toca, desvela el siguiente presagio.
  if (isWinter) {
    m.winterSeverity += rng.int(1, 3);
    if (m.presagios < PRESAGIO_CHAIN.length) {
      const text = PRESAGIO_CHAIN[m.presagios];
      m.presagios += 1;
      state.chronicle.push({ turn: state.turn, kind: 'mundo', text });
      messages.push(text);
    }
  }

  // (b) SEMBRAR ARMAS: con los presagios ya innegables (≥2), una sola vez.
  if (m.presagios >= 2 && m.namedWeapons.length === 0) {
    messages.push(...seedWeapons(state));
  }

  // ARMAS CAÍDAS: un portador muerto suelta su hoja (en cualquier momento).
  if (m.namedWeapons.length > 0) {
    messages.push(...checkFallenBearers(state));
  }

  // (c) LA LARGA ESCARCHA: los 6 presagios narrados y turno ≥ umbral. Una vez.
  if (!m.escarchaActive && m.presagios >= PRESAGIO_CHAIN.length && state.turn >= ESCARCHA_MIN_TURN) {
    messages.push(...forceEscarcha(state, rng));
  }

  // (d) MIENTRAS MARCHA LA ESCARCHA: crecen (inviernos) y avanzan (cada turno).
  if (m.escarchaActive) {
    if (isWinter) {
      const grew = growPalidos(state);
      if (grew) messages.push(grew);
    }
    messages.push(...advancePalidos(state, rng));
  }

  // (e) DESENLACE: solo si la escarcha ya estaba activa al empezar este turno.
  if (m.escarchaActive && wasEscarcha && state.outcome === 'ongoing') {
    messages.push(...resolveLongNight(state));
  }

  return messages;
}
