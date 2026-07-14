/**
 * HUD DOM de la batalla (fuera de Phaser). Banda superior, cola de iniciativa,
 * tarjeta de unidad activa, botonera y log narrado, más el banner de despliegue
 * y el de fin de batalla. Estilos inline con tokens coherentes con la UI del
 * juego. No importa de render/ui: los tokens se replican en theme.ts.
 */
import type { TacticalState, TacticalSide, TacticalUnit, GeneralMod } from '../../core/tactical/types';
import {
  FORMATION_ES, FORMATION_FX, HUD, STRAT_TERRAIN_ES, weatherEs, glyphOf,
} from './theme';

export interface HudCallbacks {
  onStartBattle(): void;
  onToggleAttack(): void;
  onCycleFormation(): void;
  onGeneralAbility(): void;
  onEndActivation(): void;
  onReturnToMap(): void;
}

export interface HudFlags {
  /** el jugador puede actuar con la unidad activa ahora mismo. */
  playerActive: boolean;
  /** el botón Atacar está en modo objetivo. */
  attackMode: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, style: Partial<CSSStyleDeclaration>, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

const PANEL: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  pointerEvents: 'auto',
  background: HUD.panel,
  border: `1px solid ${HUD.hairline}`,
  borderRadius: '6px',
  color: HUD.text,
  fontFamily: HUD.font,
  boxSizing: 'border-box',
};

export class Hud {
  readonly root: HTMLElement;
  private cb: HudCallbacks;
  private colorHex: (u: TacticalUnit) => string;
  private playerSide: TacticalSide;

  private topBand: HTMLElement;
  private initRow: HTMLElement;
  private logPanel: HTMLElement;
  private logInner: HTMLElement;
  private card: HTMLElement;
  private cardName: HTMLElement;
  private cardStats: HTMLElement;
  private cardForm: HTMLElement;
  private actions: HTMLElement;
  private btnAttack: HTMLButtonElement;
  private btnForm: HTMLButtonElement;
  private btnAbility: HTMLButtonElement;
  private btnEnd: HTMLButtonElement;
  private deployBar: HTMLElement;
  private finish: HTMLElement;
  private finishBanner: HTMLElement;

  private renderedLog = 0;

  constructor(cb: HudCallbacks, colorHex: (u: TacticalUnit) => string, playerSide: TacticalSide) {
    this.cb = cb;
    this.colorHex = colorHex;
    this.playerSide = playerSide;

    this.root = el('div', {
      position: 'absolute', inset: '0', pointerEvents: 'none',
      fontFamily: HUD.font, color: HUD.text, userSelect: 'none',
    });

    // banda superior
    this.topBand = el('div', {
      ...PANEL,
      top: '10px', left: '50%', transform: 'translateX(-50%)',
      padding: '8px 18px', textAlign: 'center',
      fontSize: '15px', letterSpacing: '0.06em', maxWidth: '92%',
    });
    this.root.appendChild(this.topBand);

    // cola de iniciativa
    this.initRow = el('div', {
      position: 'absolute', pointerEvents: 'auto',
      top: '52px', left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: '5px', maxWidth: '86%',
      overflowX: 'auto', padding: '4px', alignItems: 'center',
    });
    this.root.appendChild(this.initRow);

    // log narrado (derecha-abajo)
    this.logPanel = el('div', {
      ...PANEL,
      right: '12px', bottom: '12px', width: '300px', maxWidth: '40%',
      height: '184px', display: 'flex', flexDirection: 'column',
    });
    const logTitle = el('div', {
      padding: '6px 10px', borderBottom: `1px solid ${HUD.hairline}`,
      fontSize: '11px', letterSpacing: '0.14em', color: HUD.textDim, textTransform: 'uppercase',
    }, 'Crónica de la batalla');
    this.logInner = el('div', {
      flex: '1', overflowY: 'auto', padding: '8px 10px',
      fontSize: '13px', lineHeight: '1.45', display: 'flex', flexDirection: 'column', gap: '3px',
    });
    this.logPanel.appendChild(logTitle);
    this.logPanel.appendChild(this.logInner);
    this.root.appendChild(this.logPanel);

    // tarjeta de unidad activa (izquierda-abajo)
    this.card = el('div', {
      ...PANEL,
      left: '12px', bottom: '68px', width: '284px', maxWidth: '42%', padding: '10px 12px',
    });
    this.cardName = el('div', { fontSize: '16px', fontWeight: '600', marginBottom: '4px' }, '—');
    this.cardStats = el('div', { fontSize: '13px', color: HUD.text, marginBottom: '2px' }, '');
    this.cardForm = el('div', { fontSize: '12px', color: HUD.textDim }, '');
    this.card.appendChild(this.cardName);
    this.card.appendChild(this.cardStats);
    this.card.appendChild(this.cardForm);
    this.root.appendChild(this.card);

    // botonera (izquierda, bajo la tarjeta)
    this.actions = el('div', {
      position: 'absolute', pointerEvents: 'auto',
      left: '12px', bottom: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '46%',
    });
    this.btnAttack = this.makeButton('Atacar', () => this.cb.onToggleAttack());
    this.btnForm = this.makeButton('Formación', () => this.cb.onCycleFormation());
    this.btnAbility = this.makeButton('Habilidad', () => this.cb.onGeneralAbility());
    this.btnEnd = this.makeButton('Terminar activación', () => this.cb.onEndActivation());
    this.actions.appendChild(this.btnAttack);
    this.actions.appendChild(this.btnForm);
    this.actions.appendChild(this.btnAbility);
    this.actions.appendChild(this.btnEnd);
    this.root.appendChild(this.actions);

    // banner de despliegue
    this.deployBar = el('div', {
      ...PANEL,
      bottom: '18px', left: '50%', transform: 'translateX(-50%)',
      padding: '10px 16px', display: 'flex', gap: '14px', alignItems: 'center',
    });
    const deployHint = el('div', { fontSize: '13px', color: HUD.text },
      'Arrastra o pulsa tus tropas para recolocarlas dentro de tu zona.');
    const btnStart = this.makeButton('Comenzar batalla', () => this.cb.onStartBattle(), true);
    this.deployBar.appendChild(deployHint);
    this.deployBar.appendChild(btnStart);
    this.root.appendChild(this.deployBar);

    // overlay de fin
    this.finish = el('div', {
      position: 'absolute', inset: '0', pointerEvents: 'auto', display: 'none',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '20px', background: 'rgba(10,8,7,0.55)',
    });
    this.finishBanner = el('div', {
      fontSize: '46px', letterSpacing: '0.14em', fontWeight: '700',
      textShadow: '0 2px 10px rgba(0,0,0,0.6)',
    }, '');
    const btnBack = this.makeButton('Volver al mapa', () => this.cb.onReturnToMap(), true);
    btnBack.style.fontSize = '17px';
    btnBack.style.padding = '12px 26px';
    this.finish.appendChild(this.finishBanner);
    this.finish.appendChild(btnBack);
    this.root.appendChild(this.finish);
  }

  private makeButton(label: string, onClick: () => void, accent = false): HTMLButtonElement {
    const b = el('button', {
      pointerEvents: 'auto',
      background: accent ? HUD.accent : 'rgba(237,235,222,0.06)',
      color: HUD.text,
      border: `1px solid ${accent ? HUD.accent : HUD.hairline}`,
      borderRadius: '5px',
      padding: '8px 12px',
      fontFamily: HUD.font,
      fontSize: '13px',
      cursor: 'pointer',
    }, label);
    b.addEventListener('click', (ev) => { ev.preventDefault(); onClick(); });
    b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = accent ? '#9a0c0b' : 'rgba(237,235,222,0.14)'; });
    b.addEventListener('mouseleave', () => { b.style.background = accent ? HUD.accent : 'rgba(237,235,222,0.06)'; });
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return b;
  }

  private setEnabled(b: HTMLButtonElement, on: boolean): void {
    b.disabled = !on;
    b.style.opacity = on ? '1' : '0.4';
    b.style.cursor = on ? 'pointer' : 'default';
  }

  private generalFor(ts: TacticalState, side: TacticalSide): GeneralMod | null {
    return side === 'attacker' ? ts.attackerGeneral : ts.defenderGeneral;
  }

  sync(ts: TacticalState, flags: HudFlags): void {
    // banda superior
    const terr = STRAT_TERRAIN_ES[ts.strategicTerrain] ?? String(ts.strategicTerrain);
    const roundTxt = ts.phase === 'deployment' ? 'Despliegue' : `Ronda ${ts.round}`;
    this.topBand.textContent =
      `BATALLA DE ${(ts.provinceName || '—').toUpperCase()} · ${roundTxt} · ${weatherEs(ts.weather)} · ${terr}`;

    const deploying = ts.phase === 'deployment';
    this.deployBar.style.display = deploying ? 'flex' : 'none';
    this.card.style.display = deploying ? 'none' : 'block';
    this.actions.style.display = deploying ? 'none' : 'flex';

    this.renderInitiative(ts);
    if (!deploying) this.renderCard(ts, flags);
    this.renderLog(ts);
  }

  private renderInitiative(ts: TacticalState): void {
    this.initRow.replaceChildren();
    const ids = ts.turnQueue.length > 0 ? ts.turnQueue : ts.units.map(u => u.id);
    for (const id of ids) {
      const u = ts.units.find(x => x.id === id);
      if (!u) continue;
      const active = id === ts.activeUnitId;
      const chip = el('div', {
        display: 'flex', alignItems: 'center', gap: '3px',
        padding: '3px 6px', borderRadius: '4px', flex: '0 0 auto',
        background: active ? 'rgba(129,1,0,0.35)' : HUD.panelSoft,
        border: `1px solid ${active ? HUD.accent : HUD.hairline}`,
        opacity: u.routed ? '0.4' : '1',
      });
      const dot = el('span', {
        width: '10px', height: '10px', borderRadius: '50%',
        background: this.colorHex(u), border: `1px solid ${HUD.hairline}`, display: 'inline-block',
      });
      const gl = el('span', { fontSize: '12px', color: HUD.text }, glyphOf(u));
      chip.appendChild(dot);
      chip.appendChild(gl);
      chip.title = `${u.name} · ${u.men} hombres`;
      this.initRow.appendChild(chip);
    }
  }

  private renderCard(ts: TacticalState, flags: HudFlags): void {
    const active = ts.activeUnitId ? ts.units.find(u => u.id === ts.activeUnitId) ?? null : null;
    if (!active) {
      this.cardName.textContent = '—';
      this.cardStats.textContent = '';
      this.cardForm.textContent = '';
      this.setEnabled(this.btnAttack, false);
      this.setEnabled(this.btnForm, false);
      this.setEnabled(this.btnAbility, false);
      this.setEnabled(this.btnEnd, false);
      return;
    }

    this.cardName.textContent = active.name;
    this.cardStats.textContent = `Hombres ${active.men}/${active.menMax}   ·   Moral ${Math.round(active.morale)}/${active.moraleMax}`;
    this.cardForm.textContent = `Formación: ${FORMATION_ES[active.formation]}`;

    const gen = this.generalFor(ts, active.side);
    const charges = gen ? gen.abilityCharges : 0;
    this.btnAbility.textContent = `Habilidad (${charges})`;
    this.btnForm.title = Object.values(FORMATION_FX).join('\n');

    const canAct = flags.playerActive && active.side === this.playerSide && !active.routed;
    this.setEnabled(this.btnAttack, canAct);
    this.setEnabled(this.btnForm, canAct);
    this.setEnabled(this.btnAbility, canAct && charges > 0);
    this.setEnabled(this.btnEnd, canAct);

    // reflejo visual del modo Atacar
    const on = canAct && flags.attackMode;
    this.btnAttack.style.background = on ? HUD.accent : 'rgba(237,235,222,0.06)';
    this.btnAttack.style.borderColor = on ? HUD.accent : HUD.hairline;
  }

  private renderLog(ts: TacticalState): void {
    if (ts.log.length < this.renderedLog) {
      this.logInner.replaceChildren();
      this.renderedLog = 0;
    }
    for (let i = this.renderedLog; i < ts.log.length; i++) {
      const line = el('div', { color: HUD.text }, ts.log[i]);
      this.logInner.appendChild(line);
    }
    this.renderedLog = ts.log.length;
    this.logInner.scrollTop = this.logInner.scrollHeight;
  }

  showFinish(win: boolean): void {
    this.finish.style.display = 'flex';
    this.finishBanner.textContent = win ? 'VICTORIA' : 'DERROTA';
    this.finishBanner.style.color = win ? HUD.parchment : HUD.accent;
    this.deployBar.style.display = 'none';
  }

  /** aviso transitorio (p.ej. acción no disponible). */
  toast(msg: string): void {
    const t = el('div', {
      ...PANEL,
      bottom: '150px', left: '50%', transform: 'translateX(-50%)',
      padding: '8px 14px', fontSize: '13px', background: HUD.panel, opacity: '1',
      transition: 'opacity 0.4s ease',
    }, msg);
    this.root.appendChild(t);
    window.setTimeout(() => { t.style.opacity = '0'; }, 1400);
    window.setTimeout(() => { t.remove(); }, 1900);
  }
}
