/**
 * Reinos de Hierro — contrato de tipos del núcleo (GDD §14.3).
 * REGLA DE ORO: todo GameState es serializable a JSON (guardar/cargar).
 * La lógica del core NO importa Three.js ni DOM. Los renderers leen estado
 * y envían acciones; nunca al revés.
 *
 * ESTE ARCHIVO ES EL CONTRATO ENTRE MÓDULOS. No añadir dependencias aquí.
 */

// ---------- identificadores ----------
export type ProvinceId = number;
export type FactionId = string;
export type CharacterId = string;
export type ArmyId = string;
export type UnitTypeId = string;
export type CultureId = 'aurelios' | 'norlander' | 'estepara';
export type ReligionId = 'aureismo' | 'viejos_pactos' | 'calculo';

// ---------- mundo ----------
export type Terrain =
  | 'plains' | 'hills' | 'mountain' | 'forest'
  | 'swamp' | 'coast' | 'steppe' | 'desert';

export type Season = 0 | 1 | 2 | 3; // 0=Primavera 1=Verano 2=Otoño 3=Invierno
export const SEASON_NAMES = ['Primavera', 'Verano', 'Otoño', 'Invierno'] as const;

export interface Settlement {
  name: string;
  /** 1=aldea 2=pueblo 3=ciudad 4=capital de reino */
  level: 1 | 2 | 3 | 4;
  /** 0=sin muro 1=empalizada 2=muralla 3=ciudadela */
  fortLevel: 0 | 1 | 2 | 3;
}

export interface Province {
  id: ProvinceId;
  name: string;
  terrain: Terrain;
  /** altura media 0..1 — la usa el render para el relieve */
  elevation: number;
  /** centro en coordenadas de mundo (x, z), plano de juego */
  center: [number, number];
  /** polígono del territorio en coords de mundo, sentido horario */
  polygon: [number, number][];
  neighbors: ProvinceId[];
  /** null = tierra sin señor (guarnición neutral) */
  ownerId: FactionId | null;
  settlement: Settlement;
  /** recursos estratégicos presentes (v1: hierro y caballos) */
  iron: boolean;
  horses: boolean;
  baseTax: number;      // oro/turno
  baseFood: number;     // alimento/turno
  baseManpower: number; // levas/turno
  /** milicia defensora local (hombres); pelea sola si no hay ejército */
  garrison: number;
  /** fe dominante de la provincia (Fase 2; opcional: v1 no lo serializaba) */
  religionId?: ReligionId;
  /** edificios construidos (Fase 2, GDD §9.1) */
  buildings?: BuildingId[];
  /** obra en curso (una por provincia) */
  buildQueue?: BuildQueueItem | null;
}

// ---------- construcción (Fase 2, GDD §9.1) ----------
export type BuildingId = string;

export interface BuildQueueItem {
  buildingId: BuildingId;
  turnsLeft: number;
}

// ---------- asedios (Fase 2, GDD §9.2) ----------
export interface Siege {
  id: string;
  provinceId: ProvinceId;
  attackerFactionId: FactionId;
  /** ids de los ejércitos que mantienen el cerco */
  besiegerArmyIds: ArmyId[];
  /** provisiones de la guarnición; 0 → rendición */
  provisions: number;
  provisionsMax: number;
  startedTurn: number;
}

// ---------- tecnología (Fase 2, GDD §11) ----------
export type TechId = string;

export interface ResearchState {
  active: TechId | null;
  /** puntos acumulados hacia la tecnología activa */
  points: number;
  done: TechId[];
}

// ---------- personajes y dinastía ----------
export interface Attributes {
  martial: number;     // mando militar 0..10
  stewardship: number; // administración 0..10
  diplomacy: number;   // 0..10
  intrigue: number;    // 0..10
}

export type CharacterRole = 'ruler' | 'heir' | 'general';

export interface Character {
  id: CharacterId;
  name: string;
  factionId: FactionId;
  role: CharacterRole;
  age: number;
  attributes: Attributes;
  /** ids de rasgo del banco de contenido (p.ej. 'valiente', 'cruel') */
  traits: string[];
  alive: boolean;
}

// ---------- militar ----------
export type UnitCategory = 'infantry' | 'cavalry' | 'ranged' | 'spear' | 'siege';

export interface UnitCost {
  gold: number;
  manpower: number;
  iron?: number;   // requiere provincia con hierro en el reino
  horses?: number; // requiere provincia con caballos en el reino
}

export interface UnitType {
  id: UnitTypeId;
  name: string; // en español, con sabor ("Infantería de escudo aurelia")
  category: UnitCategory;
  tier: 1 | 2;
  /** null = disponible para todas las culturas */
  culture: CultureId | null;
  attack: number;    // 1..20
  defense: number;   // 1..20
  armor: number;     // 0..10
  rangedPower: number; // 0 si no dispara
  initiative: number;  // orden en auto-resolución
  speed: number;       // afecta persecución/retirada
  moraleMax: number;   // 1..20
  menMax: number;      // tamaño del pelotón (p.ej. 100)
  cost: UnitCost;
  upkeep: number;      // oro/turno
}

export interface UnitInstance {
  typeId: UnitTypeId;
  men: number;    // hombres vivos
  morale: number; // 0..moraleMax
  xp: number;     // 0..3 (veteranía)
}

export interface Army {
  id: ArmyId;
  name: string;
  factionId: FactionId;
  provinceId: ProvinceId;
  units: UnitInstance[];
  generalId: CharacterId | null;
  movement: number;    // puntos restantes esta estación
  movementMax: number;
}

// ---------- diplomacia y guerra ----------
export type TreatyType = 'alliance' | 'non_aggression' | 'marriage_tie';

export interface DiploRelation {
  opinion: number; // -100..100
  treaties: TreatyType[];
  /** turno hasta el que dura la tregua tras una paz */
  truceUntilTurn?: number;
}

export type CasusBelli = 'reclamo' | 'religioso' | 'sin_causa';

export interface War {
  id: string;
  attackerId: FactionId;
  defenderId: FactionId;
  cb: CasusBelli;
  /** -100..100 visto desde el atacante */
  warScore: number;
  exhaustionAttacker: number; // 0..100
  exhaustionDefender: number;
  startedTurn: number;
}

// ---------- facciones ----------
export type AIArchetype = 'player' | 'consolidated' | 'ambitious' | 'tribal';

export interface Faction {
  id: FactionId;
  name: string;        // "Reino de Aurelia Occidental"
  dynastyName: string; // "Casa Varga"
  cultureId: CultureId;
  religionId: ReligionId;
  /** color del estandarte en HEX, autoridad para render y UI */
  colorPrimary: string;
  colorSecondary: string;
  /** semilla del generador procedural de heráldica */
  bannerSeed: number;
  ai: AIArchetype;
  rulerId: CharacterId;
  heirId: CharacterId | null;
  gold: number;
  manpower: number;    // reserva de levas
  foodStock: number;
  legitimacy: number;  // 0..100
  alive: boolean;
  /** investigación (Fase 2; opcional: v1 no lo serializaba) */
  research?: ResearchState;
}

// ---------- batalla (auto-resolución, GDD §8.4) ----------
export interface BattleSideReport {
  factionId: FactionId | null; // null = guarnición neutral
  menBefore: number;
  losses: number;
  moraleBroke: boolean;
}

export interface BattleReport {
  provinceId: ProvinceId;
  provinceName: string;
  turn: number;
  season: Season;
  terrain: Terrain;
  weather: string; // texto narrado ("lluvia", "nieve", "despejado", "niebla")
  attacker: BattleSideReport;
  defender: BattleSideReport;
  winner: 'attacker' | 'defender';
  /** líneas narradas del desarrollo, en español, para la crónica */
  narrative: string[];
  /** delta aplicado al warScore de la guerra correspondiente (si la hay) */
  warScoreDelta: number;
}

// ---------- eventos y crónica ----------
export type ChronicleKind = 'guerra' | 'batalla' | 'dinastia' | 'economia' | 'mundo';

export interface ChronicleEntry {
  turn: number;
  text: string; // "En el invierno del año 7, la Casa Varga tomó la ciudadela de Roca Alba."
  kind: ChronicleKind;
}

// ---------- estado raíz ----------
export interface GameState {
  version: 1;
  seed: number;
  /** turno 0-based; año = floor(turn/4)+1, estación = turn%4 */
  turn: number;
  playerFactionId: FactionId;
  provinces: Province[];
  factions: Record<FactionId, Faction>;
  characters: Record<CharacterId, Character>;
  armies: Record<ArmyId, Army>;
  wars: War[];
  relations: Record<string, DiploRelation>; // clave "aId|bId" ordenada alfabéticamente
  chronicle: ChronicleEntry[];
  /** estado del RNG determinista (se serializa para reproducibilidad) */
  rngState: number;
  /** último parte de batalla para mostrar en UI; no persiste significado */
  lastBattle: BattleReport | null;
  /** condición de fin de partida */
  outcome: 'ongoing' | 'victory_conquest' | 'defeat_extinction' | 'defeat_conquered';
  /** asedios activos (Fase 2; opcional: v1 no lo serializaba) */
  sieges?: Siege[];
}

// ---------- helpers derivados (puros) ----------
export function yearOf(turn: number): number { return Math.floor(turn / 4) + 1; }
export function seasonOf(turn: number): Season { return (turn % 4) as Season; }
export function relKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------- selección y puente UI↔mundo (transitorio, NO serializable) ----------
export type Selection =
  | { kind: 'province'; id: ProvinceId }
  | { kind: 'army'; id: ArmyId }
  | null;

/** Lo que la UI necesita del renderer 3D (implementa WorldScene). */
export interface WorldBridge {
  focusProvince(id: ProvinceId): void;
  /** provincias resaltadas como destino de movimiento; null limpia */
  setMoveTargets(ids: ProvinceId[] | null): void;
  /** re-lee el estado y actualiza colores/banderas/ejércitos */
  refresh(): void;
}

// ---------- eventos del store ----------
export type StoreEvent =
  | { type: 'state-replaced' }  // new game / load
  | { type: 'turn-ended' }
  | { type: 'battle'; report: BattleReport }
  | { type: 'map-changed' }     // propiedad/ejércitos cambiaron
  | { type: 'economy-changed' } // oro/comida/levas
  | { type: 'selection'; selection: Selection }
  | { type: 'game-over' };
