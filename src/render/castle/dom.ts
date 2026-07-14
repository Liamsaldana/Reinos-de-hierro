/**
 * Helpers de DOM y formato LOCALES de la sede de poder. La vista de castillo se
 * monta en su PROPIO contenedor a pantalla completa (fuera de #ui-root), así que
 * no puede reutilizar las clases de styles.css; replica sus tokens en su hoja
 * propia (ver styles.ts) y usa estos helpers mínimos, sin dependencias.
 */

export type Child = Node | string | number | null | undefined | false;

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

/** Crea un elemento, aplica atributos (incl. listeners `onclick`) y anexa hijos. */
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
      else if (k === 'style') node.setAttribute('style', String(v));
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

/** Entero en es-ES (1234 → "1.234"). */
export function fmt(n: number): string {
  return numberFmt.format(Math.round(n));
}

/** Con signo explícito ("+12" / "-4" / "±0"). */
export function fmtSigned(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${numberFmt.format(r)}`;
  if (r < 0) return numberFmt.format(r);
  return '±0';
}
