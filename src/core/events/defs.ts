/**
 * Banco de ~15 eventos base (GDD §12, alcance v1): dinásticos + mundo, todos
 * con decisiones. Todos actúan sobre la facción del jugador
 * (`state.playerFactionId`) — las IA no reciben eventos en v1.
 *
 * Cada def solo toca campos que ya existen en GameState (oro, comida, levas,
 * legitimidad, opinión, provincias, personajes) y usa nombres reales del
 * estado (gobernante, casa, provincia) para el sabor narrativo.
 *
 * AGENTE H (eventos): módulo propio.
 */
import type {
  Attributes, Character, CharacterId, CultureId, Faction, FactionId, GameState, Province, ProvinceId,
} from '../types';
import { relKey, seasonOf, yearOf } from '../types';
import type { Rng } from '../state/rng';
import type { EventPayload, GameEventDef } from './types';

// ---------- helpers internos ----------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function clampLegitimacy(v: number): number { return clamp(v, 0, 100); }
function clampOpinion(v: number): number { return clamp(v, -100, 100); }
function clampAttr(v: number): number { return clamp(v, 0, 10); }
/** gasta `amount` de un recurso sin dejarlo negativo. */
function spend(current: number, amount: number): number { return Math.max(0, current - amount); }

function reuseNumber(payload: EventPayload | undefined, key: string, roll: () => number): number {
  const v = payload?.[key];
  return typeof v === 'number' ? v : roll();
}
function reuseString(payload: EventPayload | undefined, key: string, roll: () => string): string {
  const v = payload?.[key];
  return typeof v === 'string' ? v : roll();
}

function playerFaction(state: GameState): Faction {
  return state.factions[state.playerFactionId];
}
function findCharacter(state: GameState, id: CharacterId | null | undefined): Character | undefined {
  return id ? state.characters[id] : undefined;
}
function rulerOf(state: GameState): Character | undefined {
  return findCharacter(state, playerFaction(state).rulerId);
}
function ownProvinces(state: GameState): Province[] {
  return state.provinces.filter(p => p.ownerId === state.playerFactionId);
}
function findProvince(state: GameState, id: ProvinceId): Province | undefined {
  return state.provinces.find(p => p.id === id);
}
function generalsOf(state: GameState): Character[] {
  return Object.values(state.characters).filter(
    c => c.factionId === state.playerFactionId && c.role === 'general' && c.alive,
  );
}
function otherAliveFactions(state: GameState): Faction[] {
  return Object.values(state.factions).filter(f => f.id !== state.playerFactionId && f.alive);
}
function getRelation(state: GameState, otherId: FactionId) {
  const key = relKey(state.playerFactionId, otherId);
  let rel = state.relations[key];
  if (!rel) {
    rel = { opinion: 0, treaties: [] };
    state.relations[key] = rel;
  }
  return rel;
}
function uniqueCharacterId(state: GameState, factionId: FactionId): CharacterId {
  let n = 1;
  let id = `evchar_${factionId}_${n}`;
  while (state.characters[id]) {
    n += 1;
    id = `evchar_${factionId}_${n}`;
  }
  return id;
}
function armiesInProvince(state: GameState, provinceId: ProvinceId, factionId: FactionId) {
  return Object.values(state.armies).filter(a => a.provinceId === provinceId && a.factionId === factionId);
}

const ATTR_KEYS: (keyof Attributes)[] = ['martial', 'stewardship', 'diplomacy', 'intrigue'];
const ATTR_LABELS: Record<keyof Attributes, string> = {
  martial: 'el mando militar', stewardship: 'la administración', diplomacy: 'la diplomacia', intrigue: 'la intriga',
};

/** nombres de sabor para recién nacidos (independiente del banco de content/names.ts). */
const HEIR_NAMES: Record<CultureId, readonly string[]> = {
  aurelios: ['Lucio', 'Flavia', 'Sabina', 'Tiberio', 'Marcela', 'Cayo', 'Druso', 'Lucrecia'],
  norlander: ['Eirik', 'Sigrid', 'Torvald', 'Hilda', 'Bjarne', 'Runa', 'Ase', 'Kolbein'],
  estepara: ['Bataar', 'Sarnai', 'Nomin', 'Enkhtuya', 'Odval', 'Tuya', 'Mönkh', 'Solongo'],
  sarradio: ['Zahir', 'Layla', 'Nadim', 'Soraya', 'Rashid', 'Amira', 'Farid', 'Yasmin'],
  highland: ['Ewan', 'Moira', 'Duncan', 'Ailsa', 'Bran', 'Iona', 'Alasdair', 'Sine'],
};
function guessSurname(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}
function newbornName(rng: Rng, cultureId: CultureId, surname: string | null): string {
  const first = rng.pick(HEIR_NAMES[cultureId]);
  return surname ? `${first} ${surname}` : first;
}

// ---------- 1. nacimiento de heredero ----------

const nacimientoHeredero: GameEventDef = {
  id: 'nacimiento_heredero',
  kind: 'dinastia',
  weight: 10,
  condition(state) {
    const faction = playerFaction(state);
    const ruler = rulerOf(state);
    return faction.heirId === null && !!ruler && ruler.alive && ruler.age < 55;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const ruler = rulerOf(state)!;
    const surname = guessSurname(ruler.name);
    const heirName = reuseString(payload, 'heirName', () => newbornName(rng, faction.cultureId, surname));
    const martial = reuseNumber(payload, 'martial', () => rng.int(2, 8));
    const stewardship = reuseNumber(payload, 'stewardship', () => rng.int(2, 8));
    const diplomacy = reuseNumber(payload, 'diplomacy', () => rng.int(2, 8));
    const intrigue = reuseNumber(payload, 'intrigue', () => rng.int(2, 8));
    const finalPayload: EventPayload = { heirName, martial, stewardship, diplomacy, intrigue };

    const bear = (celebrate: boolean) => (s: GameState, _rng: Rng, p: EventPayload): string[] => {
      const f = playerFaction(s);
      const id = uniqueCharacterId(s, f.id);
      const attrs: Attributes = {
        martial: Number(p.martial), stewardship: Number(p.stewardship),
        diplomacy: Number(p.diplomacy), intrigue: Number(p.intrigue),
      };
      const child: Character = {
        id, name: String(p.heirName), factionId: f.id, role: 'heir', age: 0,
        attributes: attrs, traits: [], alive: true,
      };
      s.characters[id] = child;
      f.heirId = id;
      if (celebrate) {
        f.gold = spend(f.gold, 20);
        f.legitimacy = clampLegitimacy(f.legitimacy + 5);
        return [
          `Nace ${child.name}, nuevo heredero de la Casa ${f.dynastyName}.`,
          'La corte celebra con una fiesta real: -20 oro, +5 legitimidad.',
        ];
      }
      return [`Nace ${child.name}, nuevo heredero de la Casa ${f.dynastyName}, en un bautizo discreto.`];
    };

    return {
      title: 'Nace un heredero',
      text: `${ruler.name}, soberano/a de la Casa ${faction.dynastyName}, recibe la noticia: la cuna real vuelve a estar ocupada.`,
      payload: finalPayload,
      choices: [
        { label: 'Celebrar con una fiesta real (-20 oro, +5 legitimidad)', effect: bear(true) },
        { label: 'Bautizo discreto, sin festejos', effect: bear(false) },
      ],
    };
  },
};

// ---------- 2. enfermedad del gobernante ----------

const enfermedadGobernante: GameEventDef = {
  id: 'enfermedad_gobernante',
  kind: 'dinastia',
  weight: 8,
  condition(state) {
    const ruler = rulerOf(state);
    return !!ruler && ruler.alive;
  },
  build(state, rng, payload) {
    const ruler = rulerOf(state)!;
    const attrKey = reuseString(payload, 'attr', () => rng.pick(ATTR_KEYS)) as keyof Attributes;
    const amount = reuseNumber(payload, 'amount', () => rng.int(1, 2));
    const finalPayload: EventPayload = { attr: attrKey, amount, rulerId: ruler.id };

    return {
      title: 'El gobernante enferma',
      text: `${ruler.name} cae enfermo/a de un mal extraño; los físicos de la corte no se ponen de acuerdo sobre el tratamiento.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Llamar a médicos extranjeros (-10 legitimidad)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            f.legitimacy = clampLegitimacy(f.legitimacy - 10);
            const r = findCharacter(s, String(p.rulerId));
            return [`Médicos extranjeros curan a ${r?.name ?? 'el gobernante'}, pero el clero murmura: -10 legitimidad.`];
          },
        },
        {
          label: 'Dejar que la naturaleza siga su curso',
          effect: (s, _rng, p) => {
            const r = findCharacter(s, String(p.rulerId));
            if (!r) return ['El enfermo ya no está entre los vivos: no hay nada que curar.'];
            const key = p.attr as keyof Attributes;
            const amt = Number(p.amount);
            r.attributes[key] = clampAttr(r.attributes[key] - amt);
            return [`${r.name} sobrevive, pero queda debilitado/a en ${ATTR_LABELS[key]} (-${amt}).`];
          },
        },
      ],
    };
  },
};

// ---------- 3. propuesta de matrimonio ----------

const propuestaMatrimonio: GameEventDef = {
  id: 'propuesta_matrimonio',
  kind: 'dinastia',
  weight: 8,
  condition(state) {
    return otherAliveFactions(state).length > 0;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const others = otherAliveFactions(state);
    const proposerId = reuseString(payload, 'proposerId', () => rng.pick(others).id);
    const proposer = state.factions[proposerId] ?? others[0];
    const finalPayload: EventPayload = { proposerId: proposer.id };

    return {
      title: 'Propuesta de matrimonio',
      text: `Emisarios de la Casa ${proposer.dynastyName} llegan a la corte de la Casa ${faction.dynastyName} proponiendo un enlace matrimonial entre ambas casas.`,
      payload: finalPayload,
      choices: [
        {
          label: `Aceptar el enlace (+25 opinión con la Casa ${proposer.dynastyName})`,
          effect: (s, _rng, p) => {
            const other = s.factions[String(p.proposerId)];
            const rel = getRelation(s, String(p.proposerId));
            rel.opinion = clampOpinion(rel.opinion + 25);
            return [`Se sella el compromiso con la Casa ${other?.dynastyName ?? '???'}: +25 de opinión.`];
          },
        },
        {
          label: `Rechazar el enlace (-10 opinión con la Casa ${proposer.dynastyName})`,
          effect: (s, _rng, p) => {
            const other = s.factions[String(p.proposerId)];
            const rel = getRelation(s, String(p.proposerId));
            rel.opinion = clampOpinion(rel.opinion - 10);
            return [`Se rechaza el enlace propuesto por la Casa ${other?.dynastyName ?? '???'}: -10 de opinión.`];
          },
        },
      ],
    };
  },
};

// ---------- 4. traición de un general ----------

const traicionGeneral: GameEventDef = {
  id: 'traicion_general',
  kind: 'dinastia',
  weight: 7,
  condition(state) {
    return generalsOf(state).length > 0;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const generals = generalsOf(state);
    const generalId = reuseString(payload, 'generalId', () => rng.pick(generals).id);
    const general = findCharacter(state, generalId) ?? generals[0];
    const finalPayload: EventPayload = { generalId: general.id };

    return {
      title: 'Amenaza de deserción',
      text: `${general.name}, general de las huestes de la Casa ${faction.dynastyName}, amenaza con marcharse con sus hombres más leales si no se le paga.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Pagarle una bolsa de oro para retenerlo (-60 oro)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            f.gold = spend(f.gold, 60);
            const g = findCharacter(s, String(p.generalId));
            return [`${g?.name ?? 'El general'} acepta el oro y permanece fiel a la Casa ${f.dynastyName}: -60 oro.`];
          },
        },
        {
          label: 'Dejar que se marche',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const g = findCharacter(s, String(p.generalId));
            if (!g) return ['El general ya no formaba parte de la corte.'];
            g.alive = false;
            for (const army of Object.values(s.armies)) {
              if (army.generalId === g.id) army.generalId = null;
            }
            return [`${g.name} abandona la Casa ${f.dynastyName} con sus hombres más leales.`];
          },
        },
      ],
    };
  },
};

// ---------- 5. pretendiente al trono ----------

const pretendienteTrono: GameEventDef = {
  id: 'pretendiente_trono',
  kind: 'dinastia',
  weight: 6,
  condition(state) {
    const ruler = rulerOf(state);
    return !!ruler && ruler.alive;
  },
  build(state) {
    const faction = playerFaction(state);
    return {
      title: 'Un pretendiente al trono',
      text: `Un primo lejano de la Casa ${faction.dynastyName} reclama el trono para sí, alegando mejor derecho de sangre y cortejando a nobles descontentos.`,
      payload: {},
      choices: [
        {
          label: 'Ignorar el reclamo (-15 legitimidad)',
          effect: (s) => {
            const f = playerFaction(s);
            f.legitimacy = clampLegitimacy(f.legitimacy - 15);
            return [`El reclamo cala entre los nobles: la Casa ${f.dynastyName} pierde 15 de legitimidad.`];
          },
        },
        {
          label: 'Comprar su silencio y renuncia (-80 oro)',
          effect: (s) => {
            const f = playerFaction(s);
            f.gold = spend(f.gold, 80);
            return ['El pretendiente renuncia a cambio de 80 de oro y desaparece de la corte.'];
          },
        },
      ],
    };
  },
};

// ---------- 6. hambruna de invierno ----------

const hambrunaInvierno: GameEventDef = {
  id: 'hambruna_invierno',
  kind: 'mundo',
  weight: 9,
  condition(state) {
    return seasonOf(state.turn) === 3;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const amount = reuseNumber(payload, 'amount', () => rng.int(30, 60));
    const finalPayload: EventPayload = { amount };
    return {
      title: 'Hambruna de invierno',
      text: `El invierno se cierne duro sobre las tierras de la Casa ${faction.dynastyName}: los graneros no bastarán para alimentar a todos.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Racionar el grano entre el pueblo (-15 legitimidad)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            f.foodStock = Math.max(0, f.foodStock - amt);
            f.legitimacy = clampLegitimacy(f.legitimacy - 15);
            return [`El racionamiento enfurece al pueblo: -${amt} de comida, -15 legitimidad.`];
          },
        },
        {
          label: 'Comprar grano a precio de oro',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            const cost = amt * 2;
            f.gold = spend(f.gold, cost);
            return [`Las caravanas de grano llegan a tiempo: -${cost} de oro, los graneros se mantienen firmes.`];
          },
        },
      ],
    };
  },
};

// ---------- 7. plaga en una provincia ----------

const plagaProvincia: GameEventDef = {
  id: 'plaga_provincia',
  kind: 'mundo',
  weight: 7,
  condition(state) {
    return ownProvinces(state).length > 0;
  },
  build(state, rng, payload) {
    const provinces = ownProvinces(state);
    const provinceId = reuseNumber(payload, 'provinceId', () => rng.pick(provinces).id);
    const province = findProvince(state, provinceId) ?? provinces[0];
    const finalPayload: EventPayload = { provinceId: province.id };

    return {
      title: 'Plaga en la provincia',
      text: `La plaga se extiende por ${province.name}: la guarnición y las huestes allí acantonadas empiezan a caer enfermas.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Aislar la provincia y rezar (bajas severas en guarnición y tropa)',
          effect: (s, _rng, p) => {
            const pv = findProvince(s, Number(p.provinceId));
            if (!pv) return ['La provincia ya no está bajo tu corona: la plaga sigue su curso lejos de ti.'];
            const garrisonLoss = Math.floor(pv.garrison * 0.3);
            pv.garrison = Math.max(0, pv.garrison - garrisonLoss);
            let menLost = 0;
            for (const army of armiesInProvince(s, pv.id, s.playerFactionId)) {
              for (const u of army.units) {
                const loss = Math.floor(u.men * 0.15);
                u.men = Math.max(0, u.men - loss);
                menLost += loss;
              }
            }
            return [`La plaga diezma ${pv.name}: -${garrisonLoss} de guarnición y ${menLost} hombres en armas.`];
          },
        },
        {
          label: 'Pagar una cuarentena estricta (-40 oro, menos bajas)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            f.gold = spend(f.gold, 40);
            const pv = findProvince(s, Number(p.provinceId));
            if (!pv) return ['La provincia ya no está bajo tu corona, pero la cuarentena igual cuesta 40 de oro.'];
            const garrisonLoss = Math.floor(pv.garrison * 0.1);
            pv.garrison = Math.max(0, pv.garrison - garrisonLoss);
            return [`La cuarentena en ${pv.name} contiene lo peor: -40 oro, -${garrisonLoss} de guarnición.`];
          },
        },
      ],
    };
  },
};

// ---------- 8. revuelta campesina ----------

const revueltaCampesina: GameEventDef = {
  id: 'revuelta_campesina',
  kind: 'mundo',
  weight: 8,
  condition(state) {
    return playerFaction(state).legitimacy < 40 && ownProvinces(state).length > 0;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const provinces = ownProvinces(state);
    const provinceId = reuseNumber(payload, 'provinceId', () => rng.pick(provinces).id);
    const province = findProvince(state, provinceId) ?? provinces[0];
    const finalPayload: EventPayload = { provinceId: province.id };

    return {
      title: 'Revuelta campesina',
      text: `La legitimidad de la Casa ${faction.dynastyName} se desmorona: el pueblo de ${province.name} se alza en armas contra la corona.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Dejar que el pueblo se alce (pierdes la provincia)',
          effect: (s, _rng, p) => {
            const pv = findProvince(s, Number(p.provinceId));
            if (!pv) return ['La provincia ya se había perdido antes de que la revuelta cuajara.'];
            pv.ownerId = null;
            pv.garrison = 400;
            return [`${pv.name} cae en manos rebeldes y queda sin señor.`];
          },
        },
        {
          label: 'Reprimir la revuelta con las levas (-manpower)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            f.manpower = Math.max(0, f.manpower - 300);
            const pv = findProvince(s, Number(p.provinceId));
            return [`Las levas de la Casa ${f.dynastyName} aplastan la revuelta en ${pv?.name ?? 'la provincia'}: -300 de levas.`];
          },
        },
      ],
    };
  },
};

// ---------- 9. buena cosecha ----------

const buenaCosecha: GameEventDef = {
  id: 'buena_cosecha',
  kind: 'economia',
  weight: 9,
  condition(state) {
    return seasonOf(state.turn) !== 3;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const amount = reuseNumber(payload, 'amount', () => rng.int(30, 70));
    const finalPayload: EventPayload = { amount };
    return {
      title: 'Buena cosecha',
      text: `Los campos de la Casa ${faction.dynastyName} dan una cosecha excepcional este año.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Guardar el excedente en los graneros reales',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            f.foodStock += amt;
            return [`Los graneros reales se llenan: +${amt} de comida.`];
          },
        },
        {
          label: 'Vender el excedente en los mercados',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            const half = Math.floor(amt / 2);
            f.gold += amt;
            f.foodStock += half;
            return [`El excedente se vende en los mercados: +${amt} de oro, +${half} de comida.`];
          },
        },
      ],
    };
  },
};

// ---------- 10. caravana de mercaderes ----------

const caravanaMercaderes: GameEventDef = {
  id: 'caravana_mercaderes',
  kind: 'economia',
  weight: 9,
  condition(state) {
    return otherAliveFactions(state).length > 0;
  },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const others = otherAliveFactions(state);
    const partnerId = reuseString(payload, 'partnerId', () => rng.pick(others).id);
    const partner = state.factions[partnerId] ?? others[0];
    const finalPayload: EventPayload = { partnerId: partner.id };
    return {
      title: 'Caravana de mercaderes',
      text: `Una caravana de mercaderes de la Casa ${partner.dynastyName} solicita paso seguro por las tierras de la Casa ${faction.dynastyName}.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Cobrar un peaje generoso (+40 oro)',
          effect: (s) => {
            const f = playerFaction(s);
            f.gold += 40;
            return ['El peaje llena las arcas reales: +40 de oro.'];
          },
        },
        {
          label: 'Ofrecer hospitalidad sin cobrar (+15 opinión)',
          effect: (s, _rng, p) => {
            const other = s.factions[String(p.partnerId)];
            const rel = getRelation(s, String(p.partnerId));
            rel.opinion = clampOpinion(rel.opinion + 15);
            return [`La hospitalidad no pasa desapercibida en la Casa ${other?.dynastyName ?? '???'}: +15 de opinión.`];
          },
        },
      ],
    };
  },
};

// ---------- 11. reliquia de Aurelia hallada ----------

const reliquiaAurelia: GameEventDef = {
  id: 'reliquia_aurelia',
  kind: 'mundo',
  weight: 6,
  condition() { return true; },
  build(state) {
    const faction = playerFaction(state);
    return {
      title: 'Reliquia de Aurelia',
      text: `Unos peregrinos hallan, enterrada en tierras de la Casa ${faction.dynastyName}, una reliquia de la vieja Aurelia: un símbolo de legitimidad ancestral.`,
      payload: {},
      choices: [
        {
          label: 'Consagrarla en la corte (+10 legitimidad)',
          effect: (s) => {
            const f = playerFaction(s);
            f.legitimacy = clampLegitimacy(f.legitimacy + 10);
            return ['La reliquia se consagra ante la corte: +10 de legitimidad.'];
          },
        },
        {
          label: 'Venderla a coleccionistas extranjeros (+50 oro)',
          effect: (s) => {
            const f = playerFaction(s);
            f.gold += 50;
            return ['La reliquia se vende a coleccionistas extranjeros: +50 de oro.'];
          },
        },
      ],
    };
  },
};

// ---------- 12. desertores ----------

const desertores: GameEventDef = {
  id: 'desertores',
  kind: 'mundo',
  weight: 8,
  condition() { return true; },
  build(state, rng, payload) {
    const faction = playerFaction(state);
    const amount = reuseNumber(payload, 'amount', () => rng.int(100, 250));
    const finalPayload: EventPayload = { amount };
    return {
      title: 'Desertores',
      text: `Rumores de pagas atrasadas cunden entre los campamentos de la Casa ${faction.dynastyName}: decenas de reclutas desertan.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Dejarlos ir',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            f.manpower = Math.max(0, f.manpower - amt);
            return [`Los desertores se pierden en los caminos: -${amt} de levas.`];
          },
        },
        {
          label: 'Perseguir y ajusticiar a los cabecillas (-legitimidad)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Math.floor(Number(p.amount) / 2);
            f.manpower = Math.max(0, f.manpower - amt);
            f.legitimacy = clampLegitimacy(f.legitimacy - 5);
            return [`Los cabecillas cuelgan de los caminos: -${amt} de levas, -5 legitimidad.`];
          },
        },
      ],
    };
  },
};

// ---------- 13. incendio en un asentamiento ----------

const incendioAsentamiento: GameEventDef = {
  id: 'incendio_asentamiento',
  kind: 'economia',
  weight: 7,
  condition(state) {
    return ownProvinces(state).length > 0;
  },
  build(state, rng, payload) {
    const provinces = ownProvinces(state);
    const provinceId = reuseNumber(payload, 'provinceId', () => rng.pick(provinces).id);
    const province = findProvince(state, provinceId) ?? provinces[0];
    const amount = reuseNumber(payload, 'amount', () => rng.int(30, 70));
    const finalPayload: EventPayload = { provinceId: province.id, amount };
    return {
      title: 'Incendio en el asentamiento',
      text: `Un incendio arrasa parte de ${province.settlement.name}, en ${province.name}: los cofres reales tendrán que cubrir la reconstrucción.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Reconstruir con fondos reales',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            const amt = Number(p.amount);
            f.gold = spend(f.gold, amt);
            return [`La corona paga la reconstrucción: -${amt} de oro.`];
          },
        },
        {
          label: 'Dejar que los vecinos se ocupen (-legitimidad)',
          effect: (s) => {
            const f = playerFaction(s);
            f.legitimacy = clampLegitimacy(f.legitimacy - 8);
            return ['Los vecinos reconstruyen a su costa, resentidos con la corona: -8 legitimidad.'];
          },
        },
      ],
    };
  },
};

// ---------- 14. disputa de lindes con vecino ----------

const disputaLindes: GameEventDef = {
  id: 'disputa_lindes',
  kind: 'mundo',
  weight: 8,
  condition(state) {
    return otherAliveFactions(state).length > 0;
  },
  build(state, rng, payload) {
    const others = otherAliveFactions(state);
    const rivalId = reuseString(payload, 'rivalId', () => rng.pick(others).id);
    const rival = state.factions[rivalId] ?? others[0];
    const finalPayload: EventPayload = { rivalId: rival.id };
    return {
      title: 'Disputa de lindes',
      text: `Pastores de la Casa ${rival.dynastyName} y los tuyos riñen por los lindes de una aldea fronteriza.`,
      payload: finalPayload,
      choices: [
        {
          label: 'Ignorar la disputa (-15 opinión)',
          effect: (s, _rng, p) => {
            const other = s.factions[String(p.rivalId)];
            const rel = getRelation(s, String(p.rivalId));
            rel.opinion = clampOpinion(rel.opinion - 15);
            return [`La disputa envenena la relación con la Casa ${other?.dynastyName ?? '???'}: -15 de opinión.`];
          },
        },
        {
          label: 'Pagar una compensación por los lindes (-25 oro)',
          effect: (s, _rng, p) => {
            const f = playerFaction(s);
            f.gold = spend(f.gold, 25);
            const other = s.factions[String(p.rivalId)];
            return [`La Casa ${f.dynastyName} paga una compensación a la Casa ${other?.dynastyName ?? '???'}: -25 oro.`];
          },
        },
      ],
    };
  },
};

// ---------- 15. presagio del norte (capa mítica, GDD §2.5) ----------

const presagioNorte: GameEventDef = {
  id: 'presagio_norte',
  kind: 'mundo',
  weight: 5,
  condition(state) {
    return seasonOf(state.turn) === 3 && yearOf(state.turn) >= 5;
  },
  build() {
    return {
      title: 'Presagio del norte',
      text: 'Los centinelas de la Cerca hablan de nieves que no deberían caer tan al sur, de auroras pálidas y de un frío que muerde los huesos antes de tiempo. Los viejos lo llaman un presagio.',
      payload: {},
      choices: [
        {
          label: 'Enviar exploradores más allá de la Cerca',
          effect: () => ['Los exploradores parten hacia el norte; de ellos solo llegarán rumores.'],
        },
        {
          label: 'Ignorar los rumores y reforzar las plegarias',
          effect: () => ['La corte prefiere no mirar hacia el norte, por ahora.'],
        },
      ],
    };
  },
};

// ---------- registro ----------

export const EVENT_DEFS: GameEventDef[] = [
  nacimientoHeredero,
  enfermedadGobernante,
  propuestaMatrimonio,
  traicionGeneral,
  pretendienteTrono,
  hambrunaInvierno,
  plagaProvincia,
  revueltaCampesina,
  buenaCosecha,
  caravanaMercaderes,
  reliquiaAurelia,
  desertores,
  incendioAsentamiento,
  disputaLindes,
  presagioNorte,
];
