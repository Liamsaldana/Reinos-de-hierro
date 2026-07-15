/**
 * Reinos de Hierro — iconografía del juego (Agente J).
 * Set semántico (recursos, categorías de unidad, estados, acciones de UI).
 * Cero dependencias, cero DOM: icon() solo arma un string SVG inline.
 *
 * Origen de cada archivo en src/assets/icons/: ver src/assets/ATTRIBUTION.md
 * (5 vienen del kit gravity-ui/icons de Vanguard Atelier, MIT; el resto son
 * dibujos originales del proyecto).
 */
import ajustes from '../assets/icons/ajustes.svg?raw';
import alimento from '../assets/icons/alimento.svg?raw';
import arco from '../assets/icons/arco.svg?raw';
import asedio from '../assets/icons/asedio.svg?raw';
import caballeria from '../assets/icons/caballeria.svg?raw';
import caballos from '../assets/icons/caballos.svg?raw';
import cargar from '../assets/icons/cargar.svg?raw';
import cronica from '../assets/icons/cronica.svg?raw';
import exportar from '../assets/icons/exportar.svg?raw';
import guardar from '../assets/icons/guardar.svg?raw';
import guerra from '../assets/icons/guerra.svg?raw';
import hierro from '../assets/icons/hierro.svg?raw';
import infanteria from '../assets/icons/infanteria.svg?raw';
import lanceros from '../assets/icons/lanceros.svg?raw';
import legitimidad from '../assets/icons/legitimidad.svg?raw';
import levas from '../assets/icons/levas.svg?raw';
import moral from '../assets/icons/moral.svg?raw';
import movimiento from '../assets/icons/movimiento.svg?raw';
import oro from '../assets/icons/oro.svg?raw';
import paz from '../assets/icons/paz.svg?raw';

export type IconName =
  | 'oro'
  | 'alimento'
  | 'levas'
  | 'hierro'
  | 'caballos'
  | 'legitimidad'
  | 'guerra'
  | 'paz'
  | 'cronica'
  | 'guardar'
  | 'cargar'
  | 'exportar'
  | 'ajustes'
  | 'infanteria'
  | 'lanceros'
  | 'arco'
  | 'caballeria'
  | 'asedio'
  | 'moral'
  | 'movimiento';

const RAW: Record<IconName, string> = {
  oro,
  alimento,
  levas,
  hierro,
  caballos,
  legitimidad,
  guerra,
  paz,
  cronica,
  guardar,
  cargar,
  exportar,
  ajustes,
  infanteria,
  lanceros,
  arco,
  caballeria,
  asedio,
  moral,
  movimiento,
};

const OPEN_TAG_RE = /<svg([^>]*)>/;

/**
 * Reescribe el `<svg ...>` de entrada con el width/height pedidos y
 * aria-hidden="true" (son glifos decorativos; el texto accesible lo pone
 * quien llama, vía aria-label en el contenedor). Elimina cualquier
 * width/height/aria-hidden que ya trajera el SVG original para no duplicar
 * atributos.
 */
function withSize(svg: string, size: number): string {
  return svg.replace(OPEN_TAG_RE, (_match, attrs: string) => {
    const cleaned = attrs
      .replace(/\s+width="[^"]*"/, '')
      .replace(/\s+height="[^"]*"/, '')
      .replace(/\s+aria-hidden="[^"]*"/, '');
    return `<svg width="${size}" height="${size}" aria-hidden="true"${cleaned}>`;
  });
}

/**
 * Devuelve el markup SVG inline del icono pedido, listo para insertar como
 * innerHTML (p.ej. `el('span', {}, []); span.innerHTML = icon('oro')`).
 * `size` son px de lado (por defecto 16, el tamaño de chip habitual del HUD).
 */
export function icon(name: IconName, size = 16): string {
  return withSize(RAW[name], size);
}
