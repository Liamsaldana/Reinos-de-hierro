/**
 * Piel de la sede de poder. La vista vive a pantalla completa FUERA de #ui-root,
 * así que replica aquí los tokens de la dirección "lujo oscuro × crimson-noir"
 * (styles.css es autoridad: mismo HEX, elevación solo por hairline, --blood como
 * único acento de cromo, sin glow chillón en la UI). Se inyecta una sola vez.
 */

export const CASTLE_STYLE_ID = 'rdh-castle-style';

export const CASTLE_CSS = `
.rdh-castle {
  --ink: #1B1716;
  --ink-2: #221E1B;
  --parchment: #EDEBDE;
  --blood: #810100;
  --burgundy: #630102;
  --hairline: rgba(237, 235, 222, 0.14);
  --hairline-strong: rgba(237, 235, 222, 0.24);
  position: fixed;
  inset: 0;
  z-index: 90;
  overflow: hidden;
  background: var(--ink);
  color: var(--parchment);
  font-family: 'Alegreya', Georgia, serif;
  font-size: 15px;
  line-height: 1.45;
}
.rdh-castle *, .rdh-castle *::before, .rdh-castle *::after { box-sizing: border-box; }

.rdh-castle canvas { display: block; width: 100%; height: 100%; }

.rdh-castle h1, .rdh-castle h2, .rdh-castle h3, .rdh-castle h4 {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.5em 0;
  font-weight: 600;
}
.rdh-castle p { margin: 0 0 0.6em 0; }
.rdh-castle button {
  font-family: 'Alegreya', Georgia, serif;
  color: var(--parchment);
  background: transparent;
  cursor: pointer;
}
.rdh-castle :focus-visible {
  outline: 2px solid var(--parchment);
  outline-offset: 2px;
}

/* ---------- rótulo superior ---------- */
.rdh-castle__titlebar {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 4;
  display: flex;
  align-items: baseline;
  gap: 0.9em;
  padding: 18px 24px;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(20,17,15,0.82) 0%, rgba(20,17,15,0) 100%);
}
.rdh-castle__title {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: clamp(1.05em, 2.4vw, 1.7em);
  font-weight: 700;
  margin: 0;
}
.rdh-castle__subtitle {
  font-style: italic;
  opacity: 0.78;
  font-size: 0.9em;
}

.rdh-castle__exit {
  position: absolute;
  top: 16px; right: 18px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.78em;
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  padding: 0.5em 0.9em;
  pointer-events: auto;
  transition: border-color 0.12s ease;
}
.rdh-castle__exit:hover { border-color: var(--hairline-strong); }

.rdh-castle__hint {
  position: absolute;
  left: 24px; bottom: 18px;
  z-index: 4;
  font-size: 0.8em;
  font-style: italic;
  opacity: 0.6;
  pointer-events: none;
}

/* ---------- capa de hotspots ---------- */
.rdh-hotspots {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
.rdh-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35em;
  pointer-events: auto;
  background: transparent;
  border: none;
  padding: 0;
  transition: opacity 0.14s ease;
}
.rdh-hotspot[hidden] { display: none; }
.rdh-hotspot__disc {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(27, 23, 22, 0.9);
  border: 1px solid var(--hairline-strong);
  font-size: 1.15em;
  line-height: 1;
  box-shadow: 0 1px 6px rgba(0,0,0,0.45);
  transition: border-color 0.12s ease, background-color 0.12s ease, transform 0.12s ease;
}
.rdh-hotspot__label {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 0.66em;
  padding: 0.18em 0.55em;
  background: rgba(27, 23, 22, 0.88);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  white-space: nowrap;
}
.rdh-hotspot:hover .rdh-hotspot__disc,
.rdh-hotspot.is-active .rdh-hotspot__disc {
  border-color: var(--parchment);
  transform: scale(1.06);
}
.rdh-hotspot--exit .rdh-hotspot__disc { border-color: var(--blood); }
.rdh-hotspot--exit:hover .rdh-hotspot__disc { border-color: var(--burgundy); }

/* ---------- panel lateral ---------- */
.rdh-panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: min(380px, 92vw);
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: rgba(27, 23, 22, 0.97);
  border-left: 1px solid var(--hairline);
  transform: translateX(100%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.rdh-panel.is-open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.rdh-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  padding: 1.1em 1.2em 0.7em;
  border-bottom: 1px solid var(--hairline);
}
.rdh-panel__title { font-size: 1.15em; margin: 0; }
.rdh-panel__close {
  font-size: 1.4em;
  line-height: 1;
  padding: 0.1em 0.35em;
  opacity: 0.75;
}
.rdh-panel__close:hover { opacity: 1; }
.rdh-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 1.1em 1.2em 1.4em;
}

/* ---------- primitivas de contenido ---------- */
.rdh-panel .rdh-subtitle {
  font-family: 'Cinzel', Georgia, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.82em;
  opacity: 0.9;
  margin: 1.1em 0 0.5em;
}
.rdh-panel .rdh-subtitle:first-child { margin-top: 0; }

.rdh-stat-list { margin: 0 0 0.6em 0; }
.rdh-stat-row {
  display: flex;
  justify-content: space-between;
  gap: 1em;
  padding: 0.22em 0;
  border-bottom: 1px solid var(--hairline);
  font-size: 0.92em;
}
.rdh-stat-row dt { opacity: 0.7; margin: 0; }
.rdh-stat-row dd { margin: 0; text-align: right; }

.rdh-note {
  font-style: italic;
  opacity: 0.75;
  font-size: 0.88em;
  padding: 0.6em 0.8em;
  border: 1px dashed var(--hairline);
  border-radius: 2px;
  margin: 0.4em 0;
}
.rdh-lead { font-size: 0.92em; opacity: 0.86; }

.rdh-attr-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5em;
  margin: 0.2em 0 0.6em;
}
.rdh-attr {
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  padding: 0.45em 0.6em;
}
.rdh-attr__label { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }
.rdh-attr__value { font-family: 'Cinzel', Georgia, serif; font-size: 1.15em; }

.rdh-tags { display: flex; flex-wrap: wrap; gap: 0.4em; margin: 0.2em 0 0.4em; }
.rdh-tag {
  font-size: 0.8em;
  padding: 0.2em 0.6em;
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 999px;
}

.rdh-meter {
  position: relative;
  height: 8px;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  background: var(--ink);
  overflow: hidden;
  margin: 0.3em 0;
}
.rdh-meter__fill { display: block; height: 100%; background: var(--parchment); opacity: 0.5; }

.rdh-recruit-list { display: flex; flex-direction: column; gap: 0.5em; }
.rdh-recruit-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.4em 0.6em;
  padding: 0.5em 0.6em;
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  font-size: 0.86em;
}
.rdh-recruit-row__name { font-weight: 500; }
.rdh-recruit-row__meta { grid-column: 1 / -1; font-size: 0.86em; opacity: 0.72; }

.rdh-btn {
  font-family: 'Alegreya', Georgia, serif;
  font-weight: 500;
  color: var(--parchment);
  background: var(--ink-2);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  padding: 0.4em 0.85em;
  pointer-events: auto;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
.rdh-btn:hover:not(:disabled) { border-color: var(--hairline-strong); }
.rdh-btn:disabled { opacity: 0.42; cursor: not-allowed; }
.rdh-btn--primary { background: var(--blood); border-color: var(--blood); }
.rdh-btn--primary:hover:not(:disabled) { background: var(--burgundy); border-color: var(--burgundy); }

.rdh-result {
  font-size: 0.86em;
  padding: 0.5em 0.7em;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  margin: 0.6em 0 0;
}
.rdh-result--warn { border-color: var(--blood); }

.rdh-econ-row {
  display: flex;
  justify-content: space-between;
  gap: 1em;
  padding: 0.28em 0;
  border-bottom: 1px solid var(--hairline);
  font-size: 0.9em;
}
.rdh-econ-row--total { border-bottom: none; border-top: 1px solid var(--hairline-strong); font-weight: 600; padding-top: 0.4em; }
.rdh-econ-row__sub { opacity: 0.62; font-size: 0.82em; }
.rdh-econ-row dd { margin: 0; text-align: right; }

.rdh-chron-entry {
  display: flex;
  gap: 0.6em;
  padding: 0.5em 0;
  border-bottom: 1px solid var(--hairline);
}
.rdh-chron-entry:last-child { border-bottom: none; }
.rdh-chron-entry__icon { opacity: 0.85; flex: 0 0 auto; }
.rdh-chron-entry__date {
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.05em;
  opacity: 0.6; margin: 0 0 0.2em;
}
.rdh-chron-entry__text { font-size: 0.9em; margin: 0; }

@media (prefers-reduced-motion: reduce) {
  .rdh-castle *, .rdh-castle *::before, .rdh-castle *::after {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Inyecta la hoja una sola vez en <head>. */
export function ensureCastleStyle(): void {
  if (document.getElementById(CASTLE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CASTLE_STYLE_ID;
  style.textContent = CASTLE_CSS;
  document.head.appendChild(style);
}
