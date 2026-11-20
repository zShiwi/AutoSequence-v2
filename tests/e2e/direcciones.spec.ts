import type { Page } from '@playwright/test';
import { expect, go, modalPrimary, test } from './fixtures';

/** Direcciones E/A/M estables: se guardan en cada señal y no se recalculan. */

const sensor = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'Sensor', initial: 0, description: '', ...extra });
const motor = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'Motor', initial: 0, description: '', ...extra });
const rule = (id: number, name: string, signal: string, target: string) => ({
  id,
  name,
  conditions: [{ signal, event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
  actions: [{ signal: target, value: '1' }],
});

/** Proyecto como los de antes: sin ninguna dirección guardada. */
const old = () => ({
  id: 'p_dir',
  name: 'Antiguo',
  signals: [
    sensor('PX01'),
    sensor('PX02'),
    { name: 'C01', type: 'Cilindro', initial: 0, description: 'Tope', inductivoActivo: 'C01A', inductivoReposo: 'C01R' },
    motor('M1'),
    { name: 'V1', type: 'Virtual', initial: 0, description: '' },
  ],
  rules: [],
  blocks: [{ name: 'Bloque', rules: [rule(1, 'marcha', 'PX01', 'M1'), rule(2, 'tope', 'C01A', 'C01')] }],
});

async function seed(page: Page, stored: unknown): Promise<void> {
  await page.goto('/');
  await page.evaluate((v) => localStorage.setItem('autosequence_projects', JSON.stringify(v)), stored);
  await page.reload();
}

async function open(page: Page, name: string): Promise<void> {
  await page.locator('.link-cell', { hasText: name }).click();
  await expect(page).toHaveURL(/\/signals$/);
}

const addr = (page: Page, row: number, slot = 'address') => page.locator(`tr[data-i="${row}"] input[data-addr="${slot}"]`);

/** Tabla de símbolos de Código, como «símbolo → dirección». */
async function symbols(page: Page): Promise<Record<string, string>> {
  await go(page, 'code');
  await page.locator('[data-tab="symbols"]').click();
  const rows = page.locator('.table tbody tr');
  await expect(rows.first()).toBeVisible();
  return Object.fromEntries(
    await rows.evaluateAll((trs) => trs.map((tr) => [tr.children[0].textContent!.trim(), tr.children[1].textContent!.trim()])),
  );
}

test('un proyecto sin direcciones se abre con las de siempre y añadir señales ya no las desplaza', async ({ page }) => {
  await seed(page, [old()]);
  await open(page, 'Antiguo');
  await expect(addr(page, 0)).toHaveValue('E 0.0');
  await expect(addr(page, 1)).toHaveValue('E 0.1');
  await expect(addr(page, 2, 'inductivoActivoAddress')).toHaveValue('E 0.2');
  await expect(addr(page, 2, 'inductivoReposoAddress')).toHaveValue('E 0.3');
  await expect(addr(page, 2)).toHaveValue('A 0.0');
  await expect(addr(page, 3)).toHaveValue('A 0.1');
  await expect(addr(page, 4)).toHaveValue('M 0.0');

  // Un sensor nuevo: antes desplazaba los inductivos; ahora ocupa el hueco libre.
  await page.locator('.card__foot [data-act="add"]').click();
  await expect(addr(page, 5)).toHaveValue('E 0.4');
  await page.locator('tr[data-i="5"] [data-f="name"]').fill('PX03');
  await expect(addr(page, 2, 'inductivoActivoAddress')).toHaveValue('E 0.2');

  // Al borrar una señal su dirección queda libre y la recibe la siguiente.
  await page.locator('tr[data-i="1"] [data-f="delete"]').click();
  await expect(page.locator('tbody tr[data-i]')).toHaveCount(5);
  await page.locator('.card__foot [data-act="add"]').click();
  await expect(addr(page, 5)).toHaveValue('E 0.1');
  await page.locator('tr[data-i="5"] [data-f="name"]').fill('PX04');

  const table = await symbols(page);
  expect(table).toMatchObject({ PX01: 'E 0.0', PX04: 'E 0.1', C01A: 'E 0.2', C01R: 'E 0.3', PX03: 'E 0.4', C01: 'A 0.0', M1: 'A 0.1', V1: 'M 0.0' });

  // Sigue igual después de recargar: está guardado.
  await page.reload();
  await go(page, 'signals');
  await expect(addr(page, 4)).toHaveValue('E 0.4');
  await expect(addr(page, 1, 'inductivoActivoAddress')).toHaveValue('E 0.2');
});

test('la dirección se edita a mano con validación y llega a símbolos, KOP y documentación', async ({ page }) => {
  await seed(page, [old()]);
  await open(page, 'Antiguo');
  const first = addr(page, 0);
  const error = page.locator('tr[data-i="0"] [data-slot="addr-error"]');

  for (const [text, why] of [
    ['E 0.9', 'El bit va de 0 a 7'],
    ['X 1.0', 'Formato'],
    ['A 4.0', 'entradas (E)'],
    ['E 0.1', 'ya la usa PX02'],
    ['E 0.2', 'ya la usa C01A'],
  ]) {
    await first.fill(text);
    await expect(error).toContainText(why);
    await expect(first).toHaveAttribute('aria-invalid', '');
    await first.blur();
  }
  // Nada de lo rechazado se ha guardado; Escape vuelve a la guardada.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('autosequence_projects')!)[0].signals[0].address)).toBe('E 0.0');
  await first.focus();
  await first.press('Escape');
  await expect(first).toHaveValue('E 0.0');
  await expect(error).toBeHidden();

  // Una válida se normaliza y se guarda; también la de un inductivo.
  await first.fill('e12.3');
  await first.blur();
  await expect(first).toHaveValue('E 12.3');
  await expect(first).not.toHaveAttribute('aria-invalid', '');
  const ind = addr(page, 2, 'inductivoActivoAddress');
  await ind.fill('A 1.0');
  await expect(page.locator('tr[data-i="2"] [data-slot="addr-error"]')).toContainText('Un inductivo va en entradas (E)');
  await ind.fill('E 20.0');
  await ind.blur();
  await expect(ind).toHaveValue('E 20.0');
  // Una marca no puede entrar en las reservadas para el programa.
  await addr(page, 4).fill('M 100.0');
  await expect(page.locator('tr[data-i="4"] [data-slot="addr-error"]')).toContainText('reservadas');
  await addr(page, 4).fill('M 7.7');
  await addr(page, 4).blur();

  const table = await symbols(page);
  expect(table).toMatchObject({ PX01: 'E 12.3', C01A: 'E 20.0', V1: 'M 7.7', PX02: 'E 0.1' });
  await page.locator('[data-tab="kop"]').click();
  await expect(page.locator('.diagram-scroll--ladder svg')).toContainText('E 12.3');
  await expect(page.locator('.diagram-scroll--ladder svg')).toContainText('E 20.0');

  // Documentación: la hoja del bloque y la tabla de símbolos, con las marcas auxiliares.
  await go(page, 'docs');
  const sheets = page.locator('.sheet-card');
  await expect(sheets).toHaveCount(3);
  await expect(sheets.nth(1).locator('.sheet-svg')).toContainText('E 12.3');
  await expect(sheets.nth(2)).toContainText('Tabla de símbolos');
  const doc = sheets.nth(2).locator('.sheet-svg');
  await expect(doc).toContainText('E 20.0');
  await expect(doc).toContainText('M 7.7');
  await expect(doc).toContainText('Marcas auxiliares del programa'.toUpperCase());
  await expect(doc).toContainText('FL_MEM_001');
  await expect(doc).toContainText('M 100.0');
  await expect(doc).toContainText('REGLA_002');
});

test('cambiar el tipo reasigna la dirección en el área que toca', async ({ page }) => {
  await seed(page, [old()]);
  await open(page, 'Antiguo');
  await page.locator('tr[data-i="1"] [data-f="type"]').selectOption('Motor');
  await expect(addr(page, 1)).toHaveValue('A 0.2');
  await page.locator('tr[data-i="1"] [data-f="type"]').selectOption('Virtual');
  await expect(addr(page, 1)).toHaveValue('M 0.1');
  await page.locator('tr[data-i="1"] [data-f="type"]').selectOption('Cilindro');
  await expect(addr(page, 1)).toHaveValue('A 0.2');
  // Los inductivos no tienen dirección hasta que se escriben.
  const ind = addr(page, 1, 'inductivoActivoAddress');
  await expect(ind).toBeDisabled();
  await page.locator('tr[data-i="1"] [data-f="inductivoActivo"]').fill('PX02A');
  await expect(ind).toBeEnabled();
  await expect(ind).toHaveValue('E 0.1');
  // Los demás no se han movido.
  await expect(addr(page, 0)).toHaveValue('E 0.0');
  await expect(addr(page, 3)).toHaveValue('A 0.1');
});

test('«Renumerar todo» pide confirmación y deja las direcciones seguidas', async ({ page }) => {
  await seed(page, [old()]);
  await open(page, 'Antiguo');
  await addr(page, 0).fill('E 9.1');
  await addr(page, 0).blur();
  await addr(page, 3).fill('A 5.5');
  await addr(page, 3).blur();

  await page.locator('[data-act="renumber"]').click();
  await expect(page.locator('.modal')).toContainText('Renumerar todas las direcciones');
  await page.locator('.modal__foot .btn', { hasText: 'Cancelar' }).click();
  await expect(addr(page, 0)).toHaveValue('E 9.1');

  await page.locator('[data-act="renumber"]').click();
  await modalPrimary(page).click();
  await expect(addr(page, 0)).toHaveValue('E 0.0');
  await expect(addr(page, 3)).toHaveValue('A 0.1');
  await expect(page.locator('.toast').last()).toContainText('2 han cambiado');
  // Se puede deshacer.
  await page.locator('[data-act="undo"]').click();
  await expect(addr(page, 0)).toHaveValue('E 9.1');
});

test('importar conserva las direcciones y corrige las repetidas o no válidas avisando', async ({ page }) => {
  const file = {
    format: 'autosequence',
    version: 2,
    name: 'Importado',
    signals: [
      sensor('PX01', { address: 'E 3.3' }),
      sensor('PX02', { address: 'E 3.3' }),
      sensor('PX03', { address: 'Q 1.0' }),
      motor('M1', { address: 'A 2.2' }),
    ],
    blocks: [{ name: 'Bloque', rules: [rule(1, 'marcha', 'PX01', 'M1')] }],
  };
  await page.goto('/');
  await page.locator('[data-act="import"]').setInputFiles({
    name: 'importado.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  const warn = page.locator('.toast--warn');
  await expect(warn).toContainText('2 direcciones no eran válidas o estaban repetidas');
  await expect(warn).toContainText('PX02 pasa de «E 3.3» a E 0.0');
  await open(page, 'Importado');
  await expect(addr(page, 0)).toHaveValue('E 3.3');
  await expect(addr(page, 1)).toHaveValue('E 0.0');
  await expect(addr(page, 2)).toHaveValue('E 0.1');
  await expect(addr(page, 3)).toHaveValue('A 2.2');

  // Exportar lleva las direcciones tal cual están.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export"]').click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { signals: { name: string; address: string }[] };
  expect(exported.signals.map((s) => [s.name, s.address])).toEqual([
    ['PX01', 'E 3.3'],
    ['PX02', 'E 0.0'],
    ['PX03', 'E 0.1'],
    ['M1', 'A 2.2'],
  ]);
});

test.describe('móvil 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la dirección tiene su línea en la tarjeta y no desborda', async ({ page }) => {
    await seed(page, [old()]);
    await open(page, 'Antiguo');
    const box = (await addr(page, 0).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(80);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const ind = (await addr(page, 2, 'inductivoReposoAddress').boundingBox())!;
    expect(ind.width).toBeGreaterThanOrEqual(64);
    expect(ind.x + ind.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
