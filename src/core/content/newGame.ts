/**
 * Génesis de partida: Valdemar ~40 provincias (GDD §2.1, §4.1). Fase 3
 * (GDD §2.2, §2.4): 5 facciones jugables + tierras sin señor, personajes,
 * ejércitos iniciales.
 * AGENTE T: reemplaza el contenido. MANTÉN las firmas exportadas.
 *
 * 100% determinista: toda la aleatoriedad sale de un único Rng(seed) que
 * viaja por todas las fases en un orden fijo. Nunca Math.random/Date.now.
 */
import type {
  Army, ArmyId, Character, CharacterId, CharacterRole, CultureId, DiploRelation,
  Faction, FactionId, GameState, ProvinceId, ReligionId,
} from '../types';
import { relKey } from '../types';
import { Rng } from '../state/rng';
import { getUnitType } from './units';
import { generateProvinces, growBlock, idAt, inRect, GRID_COLS, GRID_ROWS } from './mapgen';
import { characterName, pickTraits, settlementName } from './names';

export interface PlayableFactionDef {
  id: FactionId;
  name: string;
  dynastyName: string;
  cultureId: CultureId;
  blurb: string; // 1 línea para el menú de selección
}

export const PLAYABLE_FACTIONS: PlayableFactionDef[] = [
  {
    id: 'casa_varga',
    name: 'Ducado de Varga',
    dynastyName: 'Casa Varga',
    cultureId: 'aurelios',
    blurb: 'Herederos de la legitimidad aurelia: ley firme, impuestos disciplinados y ambición de restaurar una corona.',
  },
  {
    id: 'clan_haraldsen',
    name: 'Confederación de Haraldsen',
    dynastyName: 'Clan Haraldsen',
    cultureId: 'norlander',
    blurb: 'Clanes norlander unidos por los Viejos Pactos, forjados en la incursión, el saqueo y la moral inquebrantable.',
  },
  {
    id: 'kanato_temuk',
    name: 'Kanato de Temük',
    dynastyName: 'Kanato de Temük',
    cultureId: 'estepara',
    blurb: 'Jinetes esteparios que pesan cada alianza y cada carga con la misma frialdad calculadora.',
  },
  {
    id: 'republica_sarradia',
    name: 'República de Sarradia',
    dynastyName: 'Casa Al-Nasir',
    cultureId: 'sarradio',
    blurb: 'Mercaderes y sabios del litoral sur: rutas de caravana, bibliotecas de El Cálculo, y un oro que abre más puertas que la lanza.',
  },
  {
    id: 'clanes_highland',
    name: 'Clanes de las Tierras Altas',
    dynastyName: 'Clan Mac Tíre',
    cultureId: 'highland',
    blurb: 'Clanes highland de los Viejos Pactos: cada desfiladero es una muralla, y ningún invasor ha bajado dos veces la misma cuesta.',
  },
];

/** apellido dinástico usado al nombrar personajes (null = mononimia esteparia). */
const SURNAME: Record<FactionId, string | null> = {
  casa_varga: 'Varga',
  clan_haraldsen: 'Haraldsen',
  kanato_temuk: null,
  republica_sarradia: 'ibn Rakim',
  clanes_highland: 'mac Dougal',
};

interface FactionSetup {
  def: PlayableFactionDef;
  religionId: ReligionId;
  ai: Faction['ai'];
  colorPrimary: string;
  colorSecondary: string;
  seedRow: number;
  seedCol: number;
  targetCount: number;
  zone: (id: ProvinceId) => boolean;
  /** 5 unidades t1 iniciales, coherentes con la cultura. */
  startUnits: string[];
  armyName: string;
}

/**
 * Fase 3 (GDD §2.2, §2.4): 5 facciones × 7 provincias cada una (40 - Las
 * Fauces = 39; 5×7=35 reclamadas, 4 sin señor + Las Fauces = 5 sin señor).
 * Las Fauces NUNCA entra en un bloque inicial (ver `claimedGlobally` en
 * `newGame`, pre-sembrado con su id): es territorio mítico contestable
 * (GDD §2.5), no el patio trasero de ningún reino del turno 0.
 *
 * Reparto geográfico (rejilla 8 cols × 5 filas, ver mapgen.ts) — las 5 zonas
 * son RECTÁNGULOS DISJUNTOS por construcción (se verificaron a mano celda a
 * celda, y se re-verifican con `npx vitest run tests/mapgen.test.ts`), así
 * que `growBlock` nunca compite entre dos casas por la misma provincia:
 *
 *       col0  col1  col2  col3  col4  col5  col6  col7
 *  f0:  HIGHLAND(0-1,0-3)      | HARALDSEN(0-1,4-7)
 *  f1:  ................       | ......................
 *  f2:  SARRADIO   | VARGA(2-3,2-4)  | TEMUK(2-4,5-7)
 *  f3:  (2-4,0-1)  | ..............  | ..............
 *  f4:  +(4,2)     | +(4,3) | FAUCES | ..............
 *
 *   - clanes_highland (highland): NUEVA, noroeste — filas 0-1, cols 0-3 (8
 *     celdas, toma 7): el desfiladero que nadie más pisa.
 *   - clan_haraldsen (norlander): noreste — filas 0-1, cols 4-7 (8 celdas,
 *     toma 7); mismo tamaño de bloque que antes, solo desplazado de "fila 0
 *     entera" a la mitad este para dejarle sitio a highland.
 *   - republica_sarradia (sarradio): suroeste — filas 2-4, cols 0-1 + la
 *     celda (4,2) (7 celdas exactas): columna de costa + esquina desértica
 *     del sur, "costa/desert" tal cual pide el encargo; capital portuaria.
 *   - casa_varga (aurelios): centro-sur — filas 2-3, cols 2-4 + la celda
 *     (4,3) (7 celdas exactas); mismo centro de siempre, recorrido hacia el
 *     sur para no pisar a highland.
 *   - kanato_temuk (estepara): sureste — filas 2-4, cols 5-7 (9 celdas,
 *     toma 7); mismo bloque esteparios de siempre, solo más alto (llega
 *     hasta la fila 4) para compensar el hueco que deja varga en fila 1.
 */
const FACTION_SETUPS: FactionSetup[] = [
  {
    def: PLAYABLE_FACTIONS[4],
    religionId: 'viejos_pactos',
    ai: 'tribal',
    colorPrimary: '#4a3b6b',
    colorSecondary: '#B9C6CF',
    seedRow: 0, seedCol: 1, targetCount: 7,
    zone: (id) => inRect(id, 0, 1, 0, 3), // bloque noroeste
    startUnits: ['milicia', 'honderos_highland', 'honderos_highland', 'lanceros', 'montaneses_highland'],
    armyName: 'La Guardia de Mac Tíre',
  },
  {
    def: PLAYABLE_FACTIONS[1],
    religionId: 'viejos_pactos',
    ai: 'tribal',
    colorPrimary: '#2E4A66',
    colorSecondary: '#B9C6CF',
    seedRow: 0, seedCol: 5, targetCount: 7,
    zone: (id) => inRect(id, 0, 1, 4, GRID_COLS - 1), // bloque noreste
    startUnits: ['milicia', 'milicia', 'milicia', 'lanceros', 'arqueros'],
    armyName: 'Hueste del Cuervo',
  },
  {
    def: PLAYABLE_FACTIONS[3],
    religionId: 'calculo',
    ai: 'consolidated',
    colorPrimary: '#1f6f61',
    colorSecondary: '#D9C8A0',
    seedRow: GRID_ROWS - 1, seedCol: 0, targetCount: 7,
    // bloque suroeste: columna de costa (filas 2-4) + esquina desértica del
    // sur (celda extra en col2) — "costa/desert".
    zone: (id) => inRect(id, 2, GRID_ROWS - 1, 0, 1) || id === idAt(GRID_ROWS - 1, 2),
    startUnits: ['milicia', 'lanceros_ligeros_sarradios', 'lanceros_ligeros_sarradios', 'arqueros', 'camelleros_sarradios'],
    armyName: 'La Flota de Al-Nasir',
  },
  {
    def: PLAYABLE_FACTIONS[0],
    religionId: 'aureismo',
    ai: 'ambitious',
    colorPrimary: '#8C2B2B',
    colorSecondary: '#D9C8A0',
    seedRow: 2, seedCol: 3, targetCount: 7,
    // bloque centro-sur + una celda extra en col3 para completar 7.
    zone: (id) => inRect(id, 2, 3, 2, 4) || id === idAt(GRID_ROWS - 1, 3),
    startUnits: ['milicia', 'milicia', 'lanceros', 'arqueros', 'jinetes'],
    armyName: 'La Legión de Varga',
  },
  {
    def: PLAYABLE_FACTIONS[2],
    religionId: 'calculo',
    ai: 'consolidated',
    colorPrimary: '#A67C2E',
    colorSecondary: '#3B2F1B',
    seedRow: 2, seedCol: 6, targetCount: 7,
    zone: (id) => inRect(id, 2, GRID_ROWS - 1, 5, GRID_COLS - 1), // bloque sureste
    startUnits: ['jinetes', 'jinetes', 'jinetes', 'arqueros', 'lanceros'],
    armyName: 'El Viento del Kanato',
  },
];

export function newGame(seed: number, playerFactionId?: FactionId): GameState {
  const rng = new Rng(seed);

  const provinces = generateProvinces(rng);
  const byId = new Map(provinces.map(p => [p.id, p]));

  const claimedGlobally = new Set<ProvinceId>();
  // Las Fauces (única provincia con vidrioIgneo, GDD §2.5) se marca reclamada
  // DE ANTEMANO para que growBlock jamás se la ofrezca a ninguna de las 5
  // facciones: es territorio mítico contestable, no el patio trasero de nadie
  // en el turno 0. Sigue contando dentro de las "5 sin señor" del reparto.
  const fauces = provinces.find(p => p.vidrioIgneo);
  if (fauces) claimedGlobally.add(fauces.id);

  const factions: Record<FactionId, Faction> = {};
  const characters: Record<CharacterId, Character> = {};
  const armies: Record<ArmyId, Army> = {};
  let charCounter = 0;

  for (const setup of FACTION_SETUPS) {
    const seedId = idAt(setup.seedRow, setup.seedCol);
    const block = growBlock(provinces, seedId, setup.targetCount, setup.zone, claimedGlobally, rng);
    for (const pid of block) {
      const p = byId.get(pid)!;
      p.ownerId = setup.def.id;
      p.garrison = rng.int(200, 500);
    }

    // la provincia semilla es la capital: nivel 4, ciudadela.
    const capital = byId.get(seedId)!;
    capital.settlement = {
      name: settlementName(rng, capital.name, capital.terrain, true),
      level: 4,
      fortLevel: 2,
    };

    // personajes: gobernante, heredero, general.
    const surname = SURNAME[setup.def.id];
    const makeCharacter = (role: CharacterRole, ageRange: [number, number]): Character => {
      charCounter += 1;
      const id = `chr_${charCounter}`;
      const character: Character = {
        id,
        name: characterName(rng, setup.def.cultureId, surname),
        factionId: setup.def.id,
        role,
        age: rng.int(ageRange[0], ageRange[1]),
        attributes: {
          martial: rng.int(2, 9),
          stewardship: rng.int(2, 9),
          diplomacy: rng.int(2, 9),
          intrigue: rng.int(2, 9),
        },
        traits: pickTraits(rng),
        alive: true,
      };
      characters[id] = character;
      return character;
    };
    const ruler = makeCharacter('ruler', [32, 50]);
    const heir = makeCharacter('heir', [16, 24]);
    const general = makeCharacter('general', [25, 45]);

    factions[setup.def.id] = {
      id: setup.def.id,
      name: setup.def.name,
      dynastyName: setup.def.dynastyName,
      cultureId: setup.def.cultureId,
      religionId: setup.religionId,
      colorPrimary: setup.colorPrimary,
      colorSecondary: setup.colorSecondary,
      bannerSeed: rng.int(1, 99999),
      ai: setup.ai,
      rulerId: ruler.id,
      heirId: heir.id,
      gold: 150,
      manpower: 2200,
      foodStock: 120,
      legitimacy: 60,
      alive: true,
      research: { active: null, points: 0, done: [] },
    };

    // ejército inicial en la capital, con general asignado.
    const armyId: ArmyId = `army_${setup.def.id}`;
    armies[armyId] = {
      id: armyId,
      name: setup.armyName,
      factionId: setup.def.id,
      provinceId: seedId,
      units: setup.startUnits.map((typeId) => {
        const unitType = getUnitType(typeId);
        return { typeId, men: unitType.menMax, morale: unitType.moraleMax, xp: 0 };
      }),
      generalId: general.id,
      movement: 2,
      movementMax: 2,
    };
  }

  // Fase 2: fe dominante, edificios y cola de obra por provincia.
  for (const p of provinces) {
    const owner = p.ownerId ? factions[p.ownerId] : null;
    p.religionId = owner
      ? owner.religionId
      : p.terrain === 'steppe' ? 'calculo'
      : p.terrain === 'mountain' || p.terrain === 'hills' ? 'viejos_pactos'
      : 'aureismo';
    p.buildings = [];
    p.buildQueue = null;
  }

  // relaciones diplomáticas iniciales entre las 5 facciones jugables (los 10 pares).
  const relations: Record<string, DiploRelation> = {};
  for (let i = 0; i < PLAYABLE_FACTIONS.length; i++) {
    for (let j = i + 1; j < PLAYABLE_FACTIONS.length; j++) {
      relations[relKey(PLAYABLE_FACTIONS[i].id, PLAYABLE_FACTIONS[j].id)] = { opinion: -10, treaties: [] };
    }
  }

  return {
    version: 1,
    seed,
    turn: 0,
    playerFactionId: playerFactionId ?? 'casa_varga',
    provinces,
    factions,
    characters,
    armies,
    wars: [],
    relations,
    chronicle: [
      {
        turn: 0,
        kind: 'mundo',
        text: 'Tres generaciones después de la caída de Aurelia, Valdemar afila sus espadas...',
      },
    ],
    rngState: rng.state,
    lastBattle: null,
    outcome: 'ongoing',
    sieges: [],
    // NOTA para el integrador (GDD §2.5, Fase 3): `state.mythic` se deja SIN
    // inicializar aquí a propósito. `src/core/mythic/index.ts` (AGENTE S) ya
    // establece el contrato de que la capa mítica nace perezosa —
    // `ensureMythic(state)` es el ÚNICO punto que la crea (con estos mismos
    // defaults), y `tests/mythic.test.ts` (fuera de mi propiedad) verifica
    // explícitamente `expect(s.mythic).toBeUndefined()` justo después de
    // `newGame(...)`. Poblar `mythic` aquí —tal como pedía el encargo
    // original de esta ola— rompería esa suite ya verde de otro agente; por
    // eso me desvío del encargo en ESTE punto concreto y lo dejo así. La
    // forma prevista (para referencia, igual a la de `ensureMythic`) sería:
    //   mythic: {
    //     winterSeverity: 0, presagios: 0, escarchaActive: false,
    //     granTregua: false, namedWeapons: [], vidrioArmies: [],
    //   },
    // `hegemonyStreakPlayer` no tiene ese conflicto (ningún test fija su
    // valor tras newGame), así que sí se inicializa como pedía el encargo.
    hegemonyStreakPlayer: 0,
  };
}
