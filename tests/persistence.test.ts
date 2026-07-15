import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/content/newGame';
import { exportSave, importSave, listSaves } from '../src/core/state/persistence';

describe('persistence', () => {
  it('listSaves no crashea sin localStorage (entorno node)', () => {
    expect(listSaves()).toEqual([]);
  });

  it('exportSave/importSave hacen un viaje de ida y vuelta sin pérdida (deep equal)', () => {
    const state = newGame(7);
    const json = exportSave(state);
    const imported = importSave(json);
    expect(imported).toEqual(state);
  });

  it('importSave rechaza datos basura con un mensaje claro', () => {
    expect(() => importSave('basura')).toThrow(
      'El archivo no es una partida válida de Reinos de Hierro',
    );
  });

  it('importSave acepta un JSON válido de partida', () => {
    const state = newGame(7);
    const json = exportSave(state);
    expect(() => importSave(json)).not.toThrow();
  });
});
