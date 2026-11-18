import { expect, modalPrimary, test } from './fixtures';

/** Proyecto nuevo y vacío, abierto en Señales. */
async function blankProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('#prompt-input').fill('Prueba topes');
  await modalPrimary(page).click();
  await expect(page).toHaveURL(/\/signals$/);
}

test('alta rápida de un tope: cilindro, inductivos y presencia en un paso', async ({ page }) => {
  await blankProject(page);
  await page.locator('.empty [data-quick="stop"]').click();
  const form = page.locator('.qa-form');
  await expect(form.locator('input[name="name"]')).toHaveValue('C01');
  await form.locator('input[name="name"]').fill('C07');
  // Los inductivos y la descripción de la presencia siguen al nombre.
  await expect(form.locator('input[name="activo"]')).toHaveValue('C07PX2');
  await expect(form.locator('input[name="reposo"]')).toHaveValue('C07PX1');
  await expect(form.locator('input[name="presence"]')).toHaveValue('PX01');
  await expect(form.locator('.qa-preview')).toContainText('C07PX2');
  await form.locator('input[name="description"]').fill('Tope de carga');
  await form.locator('input[name="description"]').press('Enter');
  await expect(page.locator('.qa-form')).toHaveCount(0);

  const names = page.locator('tbody [data-f="name"]');
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveValue('PX01');
  await expect(names.nth(1)).toHaveValue('C07');
  const cyl = page.locator('tr.row--stop');
  await expect(cyl.locator('[data-f="inductivoActivo"]')).toHaveValue('C07PX2');
  await expect(cyl.locator('[data-f="inductivoReposo"]')).toHaveValue('C07PX1');
  await expect(cyl.locator('[data-f="presence"]')).toHaveValue('PX01');
  await expect(page.locator('tr.row--presence')).toContainText('Presencia del tope C07');

  // Un nombre repetido no se puede crear.
  await page.locator('[data-quick="stop"]').first().click();
  await page.locator('.qa-form input[name="name"]').fill('C07');
  await expect(page.locator('.qa-form [data-err="name"]')).toContainText('ya existe');
  await page.locator('.qa-form input[name="name"]').fill('C08');
  await expect(page.locator('.qa-form input[name="presence"]')).toHaveValue('PX02');
  await page.locator('.modal__foot .btn--primary').click();
  await expect(names).toHaveCount(4);

  // Renombrar el sensor de presencia mantiene el enlace.
  await names.nth(0).fill('PX10');
  await names.nth(0).press('Tab');
  await expect(page.locator('tr.row--stop').first().locator('[data-f="presence"]')).toHaveValue('PX10');

  // Se deshace con Ctrl+Z.
  await page.locator('.page-head h1').click();
  // Se deshace con Ctrl+Z: primero el cambio de nombre y después el segundo tope.
  await page.keyboard.press('Control+z');
  await expect(names.nth(0)).toHaveValue('PX01');
  await expect(names).toHaveCount(4);
  await page.keyboard.press('Control+z');
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveValue('PX01');
});

test('alta rápida de sensor, motor y marca', async ({ page }) => {
  await blankProject(page);
  for (const [kind, expected] of [
    ['Sensor', 'PX01'],
    ['Motor', 'M01'],
    ['Virtual', 'SM_01'],
  ] as const) {
    await page.locator(`.quickadd [data-quick="${kind}"]`).click();
    await expect(page.locator('.qa-form input[name="name"]')).toHaveValue(expected);
    await page.locator('.qa-form input[name="name"]').press('Enter');
    await expect(page.locator('.qa-form')).toHaveCount(0);
  }
  await expect(page.locator('tbody [data-f="type"]')).toHaveCount(3);
  await expect(page.locator('tbody [data-f="type"]').nth(1)).toHaveValue('Motor');
});

test('con transportador, el tope nuevo se añade al lazo', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-template="acu4"]').click();
  await page.locator('.steps a[href$="/signals"]').click();
  await page.locator('.quickadd [data-quick="stop"]').click();
  await expect(page.locator('.qa-note')).toContainText('transportador');
  await page.locator('.modal__foot .btn--primary').click();
  // El guardado es diferido: se espera a que llegue al almacenamiento.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ps = JSON.parse(localStorage.getItem('autosequence_projects') ?? '[]');
        const p = ps.find((x: { signals: { name: string }[] }) => x.signals.some((s) => s.name === 'C05'));
        return p?.layout?.stops.map((s: { cylinder: string; presence?: string }) => `${s.cylinder}:${s.presence}`) ?? [];
      }),
    )
    .toContain('C05:PX09');
});
