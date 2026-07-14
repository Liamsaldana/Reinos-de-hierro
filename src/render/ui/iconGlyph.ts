/**
 * Puente opcional al banco de iconos de src/render/icons.ts (Agente J, en
 * paralelo). Carga dinámica envuelta en try/catch: si el módulo no existe
 * todavía, o el nombre pedido no está en su catálogo, todo el HUD sigue
 * funcionando con los glifos unicode de siempre. NUNCA importamos
 * '../icons' de forma estática — así no acoplamos esta propiedad (UI) a que
 * ese archivo exista o tenga una forma concreta.
 */

type IconModule = { icon(name: string, size?: number): string };

let mod: IconModule | null = null;
let settled = false;
const waiters: Array<() => void> = [];

async function load(): Promise<void> {
  try {
    // Import dinámico: si el archivo no existe o su ejecución lanza, cae al catch.
    mod = (await import('../icons')) as unknown as IconModule;
  } catch {
    mod = null;
  } finally {
    settled = true;
    for (const cb of waiters.splice(0)) cb();
  }
}
void load();

/** Se dispara una vez, cuando termina el intento de carga del banco. */
export function onIconsReady(cb: () => void): void {
  if (settled) cb();
  else waiters.push(cb);
}

/**
 * Markup HTML listo para `span.innerHTML = ...`: el SVG del banco si está
 * disponible y conoce `name`, si no el glifo unicode de reserva.
 */
export function glyphHtml(name: string, fallback: string, size = 16): string {
  if (mod) {
    try {
      return mod.icon(name, size);
    } catch {
      /* nombre fuera del catálogo del banco: cae a unicode, sin romper nada */
    }
  }
  return `<span aria-hidden="true">${fallback}</span>`;
}
