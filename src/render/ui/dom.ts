/**
 * Helpers de DOM a mano (sin framework). GDD §14.1: HTML/CSS puro sobre el canvas.
 */

export type Child = Node | string | number | null | undefined | false;

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

/** Crea un elemento, aplica atributos (incl. listeners `onclick`, etc.) y anexa hijos. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Child[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'className') node.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (typeof v === 'boolean') {
        if (v) node.setAttribute(k, '');
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  if (children) appendChildren(node, children);
  return node;
}

export function appendChildren(node: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replaceChildren(node: Element, children: Child[]): void {
  clear(node);
  appendChildren(node, children);
}

const numberFmt = new Intl.NumberFormat('es');

/** Formatea un entero en es-ES (p.ej. 1234 → "1.234"). */
export function fmt(n: number): string {
  return numberFmt.format(Math.round(n));
}

/** Formatea con signo explícito para deltas ("+12" / "-4" / "0"). */
export function fmtSigned(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${numberFmt.format(r)}`;
  return numberFmt.format(r);
}
