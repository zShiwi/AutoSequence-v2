import { expect, fromTemplate, test } from './fixtures';

test('ACU 4 topes: transportador 3D con nombres, paletas en marcha y reglas', async ({ page }) => {
  test.setTimeout(90_000);
  await fromTemplate(page, 'acu4');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tag3d--pallet')).toHaveCount(7);
  await expect(page.locator('.tag3d--stop')).toHaveCount(4);
  await expect(page.locator('.tag3d--stop').first()).toContainText(/C0\d/);
  // Añadir paletas sin reiniciar la simulación.
  await page.locator('[data-pl="pplus"]').click();
  await page.locator('[data-pl="pplus"]').click();
  await expect(page.locator('[data-slot="npallets"]')).toHaveText('9');
  await expect(page.locator('.tag3d--pallet')).toHaveCount(9);
  await page.locator('[data-pl="pminus"]').click();
  await expect(page.locator('.tag3d--pallet')).toHaveCount(8);
  // Ocultar nombres.
  await page.locator('[data-pl-labels]').uncheck();
  await expect(page.locator('.tag3d--pallet').first()).toBeHidden();
  await page.locator('[data-speed="10"]').click();
  await expect(page.locator('.plant-log tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.plant-stats')).toContainText(/Robot de carga\s*[1-9]\d* ciclos/, { timeout: 20_000 });
  // Fallo de par: el motor se para.
  await page.locator('[data-pl-toggle="PX21"]').click();
  await expect(page.locator('.plant-stats')).toContainText('Parado');
  // Vista en plano.
  await page.locator('[data-view="plan"]').click();
  await expect(page.locator('.plant-svg')).toBeVisible();
  await expect(page.locator('.pl-pallet')).toHaveCount(8);
});

test('proyecto sin transportador: se piden las medidas y se puede deshacer', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await page.locator('[data-mode="plant"]').click();
  const form = page.locator('.plant-setup');
  await expect(form).toBeVisible();
  await form.locator('input[name="length"]').fill('8000');
  await form.locator('[data-act="create"]').click();
  await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.plant-editor input[name="length"]')).toHaveValue('8000');
  await page.locator('.plant-editor [data-group="stops"] [data-f="line"]').first().selectOption('top');
  await expect(page.locator('.plant-editor [data-group="stops"] [data-f="line"]').first()).toHaveValue('top');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.plant-setup')).toBeVisible();
});
