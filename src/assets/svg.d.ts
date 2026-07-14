/**
 * Shim de tipos para importar SVG como texto crudo vía el sufijo `?raw` de
 * Vite (usado por src/render/icons.ts). Sin esto, tsc no reconoce el módulo
 * virtual y el import falla la verificación de tipos.
 */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}
