/**
 * AGENTE I — harness de simulación: verifica que el mundo VIVE sin jugador.
 *
 * Corre partidas completas turno a turno usando SOLO `endTurn` (nunca
 * acciones de jugador) y comprueba que:
 *   1. nunca lanza y las invariantes del estado se mantienen,
 *   2. la IA realmente actúa (guerras / conquistas), no solo "no crashea",
 *   3. el motor es determinista de punta a punta,
 * y al final escribe `evidence/sim_report.md` con métricas por semilla.
 *
 * GUARD: `newGame`/`endTurn` son implementados EN PARALELO por los agentes
 * B/A/D. Si hoy todavía lanzan el stub `'pendiente'`, toda la suite se
 * marca como skip (`ctx.skip()`) con un mensaje claro — verde hoy, muerde
 * en cuanto aterricen.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame } from '../src/core/content/newGame';
import { endTurn } from '../src/core/systems/turn';
import { Rng } from '../src/core/state/rng';
import type { GameState } from '../src/core/types';
import {
  advanceTurn, emptyMetrics, isPendingError, snapshotOwners, type SimMetrics,
} from './helpers/simMetrics';

const VALID_OUTCOMES = ['ongoing', 'victory_conquest', 'defeat_extinction', 'defeat_conquered'];

const SHORT_SEEDS = [11, 23, 47];
const SHORT_TURNS = 30;
const LIFE_SEED = 11;
const LIFE_TURNS = 40;
const DETERMINISM_SEED = 11;
const DETERMINISM_TURNS = 30;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(__dirname, '../evidence/sim_report.md');

// ---------- GUARD ('pendiente' hasta que B/A/D aterricen) ----------

interface Guard { pending: boolean; message: string }

function probeGuard(): Guard {
  try {
    const state = newGame(11);
    const rng = new Rng(state.rngState);
    endTurn(state, rng);
    return { pending: false, message: '' };
  } catch (err) {
    if (isPendingError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        pending: true,
        message: `newGame(11)/endTurn siguen lanzando 'pendiente' (agentes B/A/D aún no aterrizan): ${msg}`,
      };
    }
    // Error real (no el stub esperado): no lo escondemos aquí. Las pruebas
    // reales de abajo lo van a hacer explícito al fallar por su cuenta.
    return { pending: false, message: '' };
  }
}

const GUARD = probeGuard();

/** Forma mínima del contexto de test que necesitamos (evita depender del tipo
 * exacto exportado por vitest: la propiedad `skip` vive en el contexto
 * runtime real que recibe cada `it(...)`, aunque no aparezca en `TestContext`). */
interface SkippableContext { skip: () => void }

function guardOrSkip(ctx: SkippableContext): void {
  if (GUARD.pending) {
    // eslint-disable-next-line no-console
    console.warn(`[simulation.test] SKIP — ${GUARD.message}`);
    ctx.skip();
  }
}

// ---------- invariantes del mundo ----------

function assertWorldInvariants(state: GameState, where: string): void {
  const provinceIds = new Set(state.provinces.map(p => p.id));

  for (const [factionId, faction] of Object.entries(state.factions)) {
    expect(faction.gold, `${where}: oro negativo en ${factionId}`).toBeGreaterThanOrEqual(0);
    expect(faction.manpower, `${where}: levas negativas en ${factionId}`).toBeGreaterThanOrEqual(0);
    expect(faction.foodStock, `${where}: comida negativa en ${factionId}`).toBeGreaterThanOrEqual(0);
  }

  for (const [armyId, army] of Object.entries(state.armies)) {
    expect(
      provinceIds.has(army.provinceId),
      `${where}: ejército ${armyId} apunta a provincia inexistente ${army.provinceId}`,
    ).toBe(true);

    const owner = state.factions[army.factionId];
    expect(
      !!owner && owner.alive,
      `${where}: ejército ${armyId} pertenece a facción muerta/inexistente (${army.factionId})`,
    ).toBe(true);

    for (const u of army.units) {
      expect(u.men, `${where}: unidad ${u.typeId} del ejército ${armyId} tiene men<=0`).toBeGreaterThan(0);
    }
  }

  for (const p of state.provinces) {
    if (p.ownerId !== null) {
      const owner = state.factions[p.ownerId];
      expect(
        !!owner && owner.alive,
        `${where}: provincia ${p.id} pertenece a una facción muerta (${p.ownerId})`,
      ).toBe(true);
    }
  }

  expect(VALID_OUTCOMES, `${where}: outcome inválido '${state.outcome}'`).toContain(state.outcome);
}

// ---------- filas del reporte final ----------

interface ReportRow {
  seed: number;
  turns: number;
  warsDeclared: number;
  battles: number;
  ownerChanges: number;
  aliveFactions: number;
  avgGold: number;
  durationMs: number;
}

const reportRows: ReportRow[] = [];

describe('Harness de simulación — el mundo vive sin jugador (AGENTE I)', () => {
  describe('Simulación corta: 3 semillas x 30 turnos, sin acciones del jugador', () => {
    for (const seed of SHORT_SEEDS) {
      it(`semilla ${seed}: nunca lanza, invariantes intactos, turn===${SHORT_TURNS} al final`, (ctx) => {
        guardOrSkip(ctx);

        const start = Date.now();
        const state = newGame(seed);
        assertWorldInvariants(state, `seed ${seed} turno 0`);

        const metrics: SimMetrics = emptyMetrics();
        let prevOwners = snapshotOwners(state);
        let prevChronicleLen = state.chronicle.length;

        for (let t = 0; t < SHORT_TURNS; t++) {
          prevOwners = advanceTurn(state, metrics, prevOwners);

          expect(
            state.chronicle.length,
            `seed ${seed} turno ${t + 1}: la crónica encogió (debe solo crecer)`,
          ).toBeGreaterThanOrEqual(prevChronicleLen);
          prevChronicleLen = state.chronicle.length;

          assertWorldInvariants(state, `seed ${seed} turno ${t + 1}`);
        }

        expect(state.turn).toBe(SHORT_TURNS);

        const aliveFactions = Object.values(state.factions).filter(f => f.alive);
        const avgGold = aliveFactions.length
          ? aliveFactions.reduce((sum, f) => sum + f.gold, 0) / aliveFactions.length
          : 0;

        reportRows.push({
          seed,
          turns: SHORT_TURNS,
          warsDeclared: metrics.warsDeclared,
          battles: metrics.battles,
          ownerChanges: metrics.ownerChanges,
          aliveFactions: aliveFactions.length,
          avgGold: Math.round(avgGold),
          durationMs: Date.now() - start,
        });
      });
    }
  });

  describe('Vida del mundo: la IA actúa de verdad sin jugador', () => {
    it(`semilla ${LIFE_SEED}: en ${LIFE_TURNS} turnos hay >=1 guerra declarada o >=3 cambios de dueño de provincia`, (ctx) => {
      guardOrSkip(ctx);

      const state = newGame(LIFE_SEED);
      const metrics = emptyMetrics();
      let prevOwners = snapshotOwners(state);

      for (let t = 0; t < LIFE_TURNS; t++) {
        prevOwners = advanceTurn(state, metrics, prevOwners);
      }

      const worldLives = metrics.warsDeclared >= 1 || metrics.ownerChanges >= 3;
      expect(
        worldLives,
        `la IA no vive: ${metrics.warsDeclared} guerra(s) declarada(s) y solo `
          + `${metrics.ownerChanges} cambio(s) de dueño de provincia en ${LIFE_TURNS} turnos (semilla ${LIFE_SEED})`,
      ).toBe(true);
    });
  });

  describe('Determinismo end-to-end', () => {
    it(`dos corridas completas de ${DETERMINISM_TURNS} turnos (semilla ${DETERMINISM_SEED}) producen el mismo JSON final`, (ctx) => {
      guardOrSkip(ctx);

      const runFull = (): GameState => {
        const state = newGame(DETERMINISM_SEED);
        for (let t = 0; t < DETERMINISM_TURNS; t++) {
          const rng = new Rng(state.rngState);
          endTurn(state, rng);
        }
        return state;
      };

      const a = runFull();
      const b = runFull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  afterAll(() => {
    writeReport();
  });
});

// ---------- reporte en evidence/sim_report.md ----------

function writeReport(): void {
  const fecha = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push('# Reporte de simulación — Reinos de Hierro');
  lines.push('');
  lines.push(`Generado automáticamente por \`tests/simulation.test.ts\` (AGENTE I, harness de simulación) — ${fecha}.`);
  lines.push('');

  if (GUARD.pending) {
    lines.push('## Estado: PENDIENTE');
    lines.push('');
    lines.push('La suite se saltó (`ctx.skip()`) porque `newGame`/`endTurn` todavía lanzan el stub `\'pendiente\'`:');
    lines.push('');
    lines.push(`> ${GUARD.message}`);
    lines.push('');
    lines.push('Vuelve a ejecutar `npx vitest run tests/simulation.test.ts` cuando los agentes B/A/D terminen su parte.');
  } else if (reportRows.length === 0) {
    lines.push('## Sin datos');
    lines.push('');
    lines.push('La suite corrió (no está pendiente) pero no se registró ninguna fila de métricas: '
      + 'probablemente la simulación corta falló antes de completarse. Revisa la salida de vitest.');
  } else {
    lines.push('## Simulación corta (30 turnos, sin acciones del jugador)');
    lines.push('');
    lines.push('| Semilla | Guerras declaradas | Batallas | Provincias que cambiaron de dueño | Facciones vivas | Oro medio | Duración (ms) |');
    lines.push('|---:|---:|---:|---:|---:|---:|---:|');
    for (const row of reportRows) {
      lines.push(
        `| ${row.seed} | ${row.warsDeclared} | ${row.battles} | ${row.ownerChanges} | `
          + `${row.aliveFactions} | ${row.avgGold} | ${row.durationMs} |`,
      );
    }
    lines.push('');
    const totalWars = reportRows.reduce((s, r) => s + r.warsDeclared, 0);
    const totalBattles = reportRows.reduce((s, r) => s + r.battles, 0);
    const totalOwnerChanges = reportRows.reduce((s, r) => s + r.ownerChanges, 0);
    lines.push(
      `Actividad de IA acumulada en las ${reportRows.length} semillas: ${totalWars} guerra(s) declarada(s), `
        + `${totalBattles} batalla(s), ${totalOwnerChanges} cambio(s) de dueño de provincia.`,
    );
  }

  lines.push('');
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
}
