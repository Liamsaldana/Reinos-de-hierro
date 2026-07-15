/**
 * Conversión religiosa v1 (Fase 2, GDD §2.3): efecto inmediato, sin piedad
 * acumulada ni autoridad religiosa (eso es Fase 3, junto a herejías y
 * Pontífice/excomunión — ver GDD §2.3 "[Alcance v1]"). AGENTE P: módulo
 * nuevo, propiedad exclusiva.
 */
import type { FactionId, GameState, ProvinceId } from '../types';
import { RELIGIONS } from '../content/cultures';
import { clamp } from './economy';
import type { ActionResult } from './actions';
import { SEASON_NAMES, seasonOf, yearOf } from '../types';

const CONVERT_COST_BASE = 60;
/** con templo en la provincia (GDD §9.1: "reduce coste de convertProvince 50%"). */
const CONVERT_COST_WITH_TEMPLE = 30;
const CONVERT_LEGITIMACY_GAIN = 2;

function chronicleDateText(state: GameState): string {
  return `en el ${SEASON_NAMES[seasonOf(state.turn)].toLowerCase()} del año ${yearOf(state.turn)}`;
}

function findProvince(state: GameState, id: ProvinceId) {
  return state.provinces.find(p => p.id === id);
}

/** Coste en oro de convertir la provincia (mitad si ya tiene templo construido). */
export function convertCost(state: GameState, provinceId: ProvinceId): number {
  const province = findProvince(state, provinceId);
  if (!province) return CONVERT_COST_BASE;
  const hasTemplo = (province.buildings ?? []).includes('templo');
  return hasTemplo ? CONVERT_COST_WITH_TEMPLE : CONVERT_COST_BASE;
}

/**
 * true si la fe de la provincia difiere de la de su dueño (para avisos de
 * UI: "tensión religiosa"). Provincias sin dueño o sin fe registrada
 * (guardado viejo, v1 no serializaba `religionId`) no generan tensión.
 */
export function religionTension(state: GameState, provinceId: ProvinceId): boolean {
  const province = findProvince(state, provinceId);
  if (!province || !province.ownerId || !province.religionId) return false;
  const owner = state.factions[province.ownerId];
  if (!owner) return false;
  return province.religionId !== owner.religionId;
}

/**
 * Convierte una provincia propia a la fe de la facción: cuesta oro (menos
 * con templo), cambia `religionId` de inmediato y da +2 legitimidad. Sin
 * efecto (y rechazada) si la provincia ya profesa la fe de su dueño.
 */
export function convertProvince(
  state: GameState, factionId: FactionId, provinceId: ProvinceId,
): ActionResult {
  const faction = state.factions[factionId];
  if (!faction) return { ok: false, message: 'Facción desconocida.' };
  const province = findProvince(state, provinceId);
  if (!province) return { ok: false, message: 'Provincia desconocida.' };
  if (province.ownerId !== factionId) {
    return { ok: false, message: `No controlas ${province.name}: no puedes convertirla.` };
  }

  const currentReligion = province.religionId ?? faction.religionId;
  if (currentReligion === faction.religionId) {
    return { ok: false, message: `${province.name} ya profesa la fe de la Casa ${faction.dynastyName}.` };
  }

  const cost = convertCost(state, provinceId);
  if (faction.gold < cost) {
    return {
      ok: false,
      message: `No hay oro suficiente para convertir ${province.name}: cuesta ${cost}, tienes ${faction.gold}.`,
    };
  }

  const oldReligionName = RELIGIONS[currentReligion]?.name ?? currentReligion;
  const newReligionName = RELIGIONS[faction.religionId]?.name ?? faction.religionId;

  faction.gold -= cost;
  province.religionId = faction.religionId;
  faction.legitimacy = clamp(faction.legitimacy + CONVERT_LEGITIMACY_GAIN, 0, 100);

  state.chronicle.push({
    turn: state.turn,
    kind: 'mundo',
    text: `En ${chronicleDateText(state)}, predicadores de la Casa ${faction.dynastyName} llevaron `
      + `${newReligionName} a ${province.name}, apartándola de ${oldReligionName}.`,
  });

  return { ok: true, message: `${province.name} abraza ${newReligionName} (−${cost} de oro).` };
}
