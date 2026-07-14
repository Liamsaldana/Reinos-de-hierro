/**
 * Acceso a la Sede de Poder (integrador): botón fijo que abre la vista de
 * castillo de la capital del jugador (módulo castle, carga perezosa).
 */
import type { GameStore } from '../core/state/store';

const HAIRLINE = 'rgba(237,235,222,.14)';

export function initCastleFlow(store: GameStore): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '🏰 Sede de poder';
  btn.setAttribute('aria-label', 'Abrir la sede de poder de tu casa');
  Object.assign(btn.style, {
    position: 'fixed', left: '14px', bottom: '58px', zIndex: '30',
    background: '#1B1716', color: '#EDEBDE', border: `1px solid ${HAIRLINE}`,
    borderRadius: '2px', padding: '8px 14px', cursor: 'pointer',
    font: '500 14px Alegreya, Georgia, serif', pointerEvents: 'auto',
    display: 'none',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'rgba(237,235,222,.4)'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = HAIRLINE; });

  let open = false;
  btn.addEventListener('click', () => {
    if (open || !store.hasGame) return;
    open = true;
    void (async () => {
      const { openCastleView } = await import('../render/castle/castleView');
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '98', background: '#14110f', pointerEvents: 'auto',
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(overlay);
      const handle = openCastleView({
        container: overlay,
        store,
        factionId: store.state.playerFactionId,
        onClose: () => {
          handle.destroy();
          overlay.remove();
          open = false;
        },
      });
    })();
  });

  document.body.appendChild(btn);
  store.subscribe(() => {
    btn.style.display = store.hasGame ? 'block' : 'none';
  });
}
