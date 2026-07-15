// Evidencia runtime: capturas del juego real en Chromium headless.
// Uso: node shoot.mjs <url> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = process.argv[3] || 'evidence/screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/01_menu.png` });

// elegir facción (primera tarjeta) y forjar el reino
const card = page.locator('[data-faction], .faction-card, .faccion').first();
if (await card.count()) await card.click({ timeout: 3000 }).catch(() => {});
const forjar = page.getByText('Forjar el reino', { exact: false }).first();
if (await forjar.count()) {
  await forjar.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/02_mapa_valdemar.png` });

  // seleccionar una provincia (click al centro del canvas)
  await page.mouse.click(760, 470);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/03_seleccion_provincia.png` });

  // terminar turno x2
  const fin = page.getByText('Terminar turno', { exact: false }).first();
  if (await fin.count()) {
    await fin.click().catch(() => {});
    await page.waitForTimeout(1800);
    await fin.click().catch(() => {});
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${outDir}/04_tras_dos_turnos.png` });
  }
}
console.log(JSON.stringify({ consoleErrors: errors }, null, 2));
await browser.close();
