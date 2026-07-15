/**
 * Pantalla de menú principal: elegir facción + semilla → forjar partida,
 * o cargar una guardada. Overlay total sobre #ui-root.
 */
import type { GameStore } from '../../core/state/store';
import type { FactionId } from '../../core/types';
import { PLAYABLE_FACTIONS, newGame, type PlayableFactionDef } from '../../core/content/newGame';
import { listSaves, loadGame } from '../../core/state/persistence';
import { el, replaceChildren } from './dom';
import { CULTURE_ES_FALLBACK } from './format';
import type { ToastStack } from './toast';

export interface MainMenu {
  show(): void;
  hide(): void;
}

/** Compatibilidad hacia delante: si el banco de contenido ya trae color de
 * estandarte lo usamos; si no (contrato actual de PlayableFactionDef no lo
 * incluye), caemos a una franja neutra en vez de inventar un HEX no autorizado. */
type MaybeColoredFaction = PlayableFactionDef & { colorPrimary?: string };

export function createMainMenu(root: HTMLElement, store: GameStore, toast: ToastStack): MainMenu {
  const overlay = el('div', { className: 'menu-overlay', 'aria-hidden': 'true' });
  root.append(overlay);

  let selectedFactionId: FactionId | null = PLAYABLE_FACTIONS[0]?.id ?? null;

  function factionCard(f: PlayableFactionDef): HTMLElement {
    const isSelected = f.id === selectedFactionId;
    const color = (f as MaybeColoredFaction).colorPrimary;
    const swatch = el('div', {
      className: 'faction-card__swatch',
      style: color ? `background:${color};` : undefined,
    }, [color ? null : f.dynastyName.slice(0, 1)]);

    const card = el('button', {
      type: 'button',
      className: `faction-card${isSelected ? ' is-selected' : ''}`,
      'aria-pressed': isSelected ? 'true' : 'false',
      onclick: () => {
        selectedFactionId = f.id;
        renderFactions();
      },
    }, [
      swatch,
      el('div', { className: 'faction-card__body' }, [
        el('h3', { className: 'faction-card__name' }, [f.name]),
        el('p', { className: 'faction-card__dynasty' }, [
          `${f.dynastyName} · cultura ${CULTURE_ES_FALLBACK[f.cultureId] ?? f.cultureId}`,
        ]),
        el('p', { className: 'faction-card__blurb' }, [f.blurb]),
      ]),
    ]);
    return card;
  }

  const factionsGrid = el('div', { className: 'factions-grid' });

  function renderFactions(): void {
    if (PLAYABLE_FACTIONS.length === 0) {
      replaceChildren(factionsGrid, [
        el('p', { className: 'notice notice--pending' }, [
          'Contenido pendiente: aún no hay facciones jugables disponibles.',
        ]),
      ]);
      forgeBtn.setAttribute('disabled', '');
      return;
    }
    replaceChildren(factionsGrid, PLAYABLE_FACTIONS.map(factionCard));
    forgeBtn.removeAttribute('disabled');
  }

  const seedInput = el('input', {
    type: 'number',
    className: 'seed-input',
    value: '1337',
    'aria-label': 'Semilla del mundo',
  }) as HTMLInputElement;

  const forgeBtn = el('button', {
    type: 'button',
    className: 'btn btn--primary',
    onclick: () => {
      if (!selectedFactionId) {
        toast.show('Elige una casa antes de forjar el reino.', 'warn');
        return;
      }
      const seed = Number.parseInt(seedInput.value, 10) || 1337;
      try {
        const state = newGame(seed, selectedFactionId);
        store.replaceState(state);
      } catch (err) {
        toast.show(err instanceof Error ? err.message : String(err), 'warn');
      }
    },
  }, ['Forjar el reino']);

  const savesList = el('div', { className: 'saves-list' });

  function renderSaves(): void {
    const saves = listSaves();
    if (saves.length === 0) {
      replaceChildren(savesList, [el('p', { className: 'notice' }, ['No hay partidas guardadas.'])]);
      return;
    }
    replaceChildren(savesList, saves.map(meta => el('button', {
      type: 'button',
      className: 'save-entry',
      onclick: () => {
        try {
          const state = loadGame(meta.slot);
          if (!state) { toast.show('No se pudo cargar la partida.', 'warn'); return; }
          store.replaceState(state);
        } catch (err) {
          toast.show(err instanceof Error ? err.message : String(err), 'warn');
        }
      },
    }, [
      el('span', { className: 'save-entry__label' }, [meta.label]),
      el('span', { className: 'save-entry__date' }, [
        new Date(meta.savedAt).toLocaleString('es'),
      ]),
    ])));
  }

  overlay.append(
    el('div', { className: 'menu-panel' }, [
      el('div', { className: 'menu-titleblock' }, [
        el('h1', { className: 'menu-title' }, ['Reinos de Hierro']),
        el('p', { className: 'menu-subtitle' }, [
          'La corona de Valdemar espera un puño de hierro',
        ]),
      ]),
      el('section', { className: 'menu-section' }, [
        el('h2', { className: 'menu-section__title' }, ['Elige tu casa']),
        factionsGrid,
      ]),
      el('section', { className: 'menu-section menu-section--inline' }, [
        el('label', { className: 'seed-label' }, [
          'Semilla',
          seedInput,
        ]),
        forgeBtn,
      ]),
      el('section', { className: 'menu-section' }, [
        el('h2', { className: 'menu-section__title' }, ['Cargar partida']),
        savesList,
      ]),
    ]),
  );

  renderFactions();

  return {
    show(): void {
      renderSaves();
      overlay.classList.add('is-visible');
      overlay.setAttribute('aria-hidden', 'false');
    },
    hide(): void {
      overlay.classList.remove('is-visible');
      overlay.setAttribute('aria-hidden', 'true');
    },
  };
}
