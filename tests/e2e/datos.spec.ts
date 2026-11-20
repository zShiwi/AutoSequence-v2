import type { Page } from '@playwright/test';
import { expect, go, modalPrimary, test } from './fixtures';

/** Integridad de los datos: almacenamiento, importación y tabla de señales. */

const sensor = (name: string) => ({ name, type: 'Sensor', initial: 0, description: '' });
const motor = (name: string) => ({ name, type: 'Motor', initial: 0, description: '' });
const rule = (id: number, name: string, signal: string, target: string, value = '1', event = 'Flanco ascendente') => ({
  id,
  name,
  conditions: [{ signal, event, delay: 0, operator: 'AND' }],
  actions: [{ signal: target, value }],
});

/** Deja en el almacenamiento lo indicado (tal cual) y recarga la portada. */
async function seed(page: Page, stored: unknown): Promise<void> {
  await page.goto('/');
  await page.evaluate((v) => localStorage.setItem('autosequence_projects', typeof v === 'string' ? v : JSON.stringify(v)), stored);
  await page.reload();
}

async function open(page: Page, name: string): Promise<void> {
  await page.locator('.link-cell', { hasText: name }).click();
  await expect(page).toHaveURL(/\/signals$/);
}

const twoSensors = () => ({
  id: 'p_ren',
  name: 'Renombrar',
  signals: [sensor('PX01'), sensor('PX02'), motor('M1')],
  rules: [],
  blocks: [{ name: 'Bloque', rules: [rule(1, 'marcha', 'PX01', 'M1'), rule(2, 'paro', 'PX02', 'M1', '0')] }],
});

test('el nombre de una regla nunca se interpreta como HTML en la ficha del cronograma', async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await seed(page, [
    { id: 'p_xss', name: 'Ficha', signals: [sensor('B1'), motor('M1')], rules: [], blocks: [{ name: 'Bloque', rules: [rule(1, evil, 'B1', 'M1')] }] },
  ]);
  await open(page, 'Ficha');
  await go(page, 'sim');
  await page.locator('.fx-tag').first().hover();
  const tip = page.locator('.fx-tip').first();
  await expect(tip).toBeVisible();
  await expect(tip.locator('strong')).toContainText(evil);
  await expect(tip.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('una entrada dañada en el almacenamiento no hace perder los demás proyectos', async ({ page }) => {
  await seed(page, [twoSensors(), null, { name: 'Raro', signals: [null], blocks: [null] }]);
  const rows = page.locator('.table--projects tbody tr');
  await expect(rows).toHaveCount(2);

  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('#prompt-input').fill('Nuevo');
  await modalPrimary(page).click();
  await expect(page).toHaveURL(/\/signals$/);
  await page.locator('.brand').click();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.link-cell', { hasText: 'Renombrar' })).toBeVisible();
});

test('importar una copia con proyectos dañados: se importan los buenos y nada se rompe', async ({ page }) => {
  await page.goto('/');
  const backup = {
    format: 'autosequence-backup',
    version: 2,
    projects: [
      twoSensors(),
      null,
      { foo: 1 },
      { name: 'Roto', signals: [{ name: 5 }, null, motor('M1')], blocks: [{ rules: [{ name: 'r' }, { name: 's', conditions: [], actions: 3 }] }] },
    ],
  };
  await page.locator('[data-act="import"]').setInputFiles({
    name: 'copia.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator('.toast').last()).toContainText('2 proyectos importados. 2 no se pudieron importar.');
  await expect(page.locator('.table--projects tbody tr')).toHaveCount(2);

  // El proyecto dañado se abre y se recorre sin errores de JavaScript.
  await open(page, 'Roto');
  for (const s of ['logic', 'sim', 'code', 'docs'] as const) await go(page, s);
});

test('renombrar con un nombre ocupado, vacío o no válido no mezcla ni pierde referencias', async ({ page }) => {
  await seed(page, [twoSensors()]);
  await open(page, 'Renombrar');
  const names = page.locator('tbody [data-f="name"]');
  const error = page.locator('tbody tr').first().locator('.cell-error');

  // Por error se escribe un nombre que ya existe y luego se corrige.
  await names.nth(0).fill('PX02');
  await names.nth(0).press('Tab');
  await expect(error).toContainText('repetido');
  await names.nth(0).fill('PX01');
  await names.nth(0).press('Tab');
  await expect(error).toBeHidden();

  // Se deja vacío, después con un nombre no válido, y al final uno bueno.
  await names.nth(0).fill('');
  await names.nth(0).press('Tab');
  await names.nth(0).fill('B 1');
  await names.nth(0).press('Tab');
  await expect(error).toContainText('sin espacios');
  await names.nth(0).fill('PX10');
  await names.nth(0).press('Tab');
  await expect(page.locator('.toast').last()).toContainText('«PX01» → «PX10»: 1 referencia');

  await go(page, 'logic');
  const rules = page.locator('.rule');
  await expect(rules).toHaveCount(2);
  await expect(rules.nth(0).locator('.rule__logic')).toContainText('PX10');
  await expect(rules.nth(1).locator('.rule__logic')).toContainText('PX02');
  await expect(page.locator('.rule--warn')).toHaveCount(0);
});

const cylinders = () => ({
  id: 'p_cil',
  name: 'Cilindros',
  signals: [
    { name: 'C01', type: 'Cilindro', initial: 0, description: '', inductivoActivo: 'C01PX2', inductivoReposo: 'C01PX1' },
    { name: 'C02', type: 'Cilindro', initial: 0, description: '', inductivoActivo: 'C02PX2', inductivoReposo: 'C02PX1' },
    motor('M1'),
  ],
  rules: [],
  blocks: [{ name: 'Bloque', rules: [rule(1, 'tope abierto', 'C01PX2', 'M1', '1', '==1')] }],
});

test('los inductivos se validan: ni repetidos entre cilindros ni con nombres no válidos', async ({ page }) => {
  await seed(page, [cylinders()]);
  await open(page, 'Cilindros');
  const row = page.locator('tbody tr').nth(1);
  const activo = row.locator('[data-f="inductivoActivo"]');

  await activo.fill('C01PX2');
  await expect(row.locator('.cell-error')).toContainText('El inductivo «C01PX2» ya es de C01');
  await expect(activo).toHaveAttribute('aria-invalid', '');
  await activo.fill('mal nombre');
  await expect(row.locator('.cell-error')).toContainText('Inductivo activo');
  await activo.fill('C02PX1');
  await expect(row.locator('.cell-error')).toContainText('no puede ser a la vez activo y de reposo');
  await activo.fill('C02PX2');
  await expect(row.locator('.cell-error')).toBeHidden();
  await expect(activo).not.toHaveAttribute('aria-invalid', '');
});

test('borrar un cilindro o cambiar su tipo avisa si las reglas usan sus inductivos', async ({ page }) => {
  await seed(page, [cylinders()]);
  await open(page, 'Cilindros');
  const rows = page.locator('tbody tr');
  const dialog = page.locator('.modal').last();

  // Las reglas usan C01PX2, no C01: antes no salía ningún aviso.
  await rows.nth(0).locator('[data-f="delete"]').click();
  await expect(dialog).toContainText('sus inductivos se usan en 1 regla');
  await expect(dialog).toContainText('tope abierto');
  await dialog.locator('.modal__foot .btn--ghost').click();
  await expect(rows).toHaveCount(3);

  const type = rows.nth(0).locator('[data-f="type"]');
  await type.selectOption('Motor');
  await expect(dialog).toContainText('pierde sus inductivos');
  await dialog.locator('.modal__foot .btn--ghost').click();
  await expect(type).toHaveValue('Cilindro');
  await expect(rows.nth(0).locator('[data-f="inductivoActivo"]')).toHaveValue('C01PX2');

  // Un cilindro cuyos inductivos no se usan se cambia sin preguntar.
  await rows.nth(1).locator('[data-f="type"]').selectOption('Motor');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(rows.nth(1).locator('[data-f="inductivoActivo"]')).toHaveCount(0);

  await rows.nth(0).locator('[data-f="delete"]').click();
  await modalPrimary(page).click();
  await expect(rows).toHaveCount(2);
});
