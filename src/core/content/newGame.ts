/**
 * Génesis de partida: Valdemar ~40 provincias (GDD §2.1, §4.1), 3 facciones
 * jugables + tierras sin señor, personajes, ejércitos iniciales.
 * AGENTE B: reemplaza el contenido. MANTÉN las firmas exportadas.
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
import { generateProvinces, growBlock, idAt, inRect, GRID_COLS } from './mapgen';
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
];

/** apellido dinástico usado al nombrar personajes (null = mononimia esteparia). */
const SURNAME: Record<FactionId, string | null> = {
  casa_varga: 'Varga',
  clan_haraldsen: 'Haraldsen',
  kanato_temuk: null,
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

const FACTION_SETUPS: FactionSetup[] = [
  {
    def: PLAYABLE_FACTIONS[0],
    religionId: 'aureismo',
    ai: 'ambitious',
    colorPrimary: '#8C2B2B',
    colorSecondary: '#D9C8A0',
    seedRow: 2, seedCol: 2, targetCount: 9,
    zone: (id) => inRect(id, 1, 3, 1, 3), // bloque centro-oeste
    startUnits: ['milicia', 'milicia', 'lanceros', 'arqueros', 'jinetes'],
    armyName: 'La Legión de Varga',
  },
  {
    def: PLAYABLE_FACTIONS[1],
    religionId: 'viejos_pactos',
    ai: 'tribal',
    colorPrimary: '#2E4A66',
    colorSecondary: '#B9C6CF',
    seedRow: 0, seedCol: 3, targetCount: 8,
    zone: (id) => inRect(id, 0, 0, 0, GRID_COLS - 1), // bloque norte (fila 0 entera)
    startUnits: ['milicia', 'milicia', 'milicia', 'lanceros', 'arqueros'],
    armyName: 'Hueste del Cuervo',
  },
  {
    def: PLAYABLE_FACTIONS[2],
    religionId: 'calculo',
    ai: 'consolidated',
    colorPrimary: '#A67C2E',
    colorSecondary: '#3B2F1B',
    seedRow: 2, seedCol: 6, targetCount: 9,
    zone: (id) => inRect(id, 1, 3, 5, 7), // bloque este
    startUnits: ['jinetes', 'jinetes', 'jinetes', 'arqueros', 'lanceros'],
    armyName: 'El Viento del Kanato',
  },
];

export function newGame(seed: number, playerFactionId?: FactionId): GameState {
  const rng = new Rng(seed);

  const provinces = generateProvinces(rng);
  const byId = new Map(provinces.map(p => [p.id, p]));

  const claimedGlobally = new Set<ProvinceId>();
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

  // relaciones diplomáticas iniciales entre las 3 facciones jugables.
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
  };
}
