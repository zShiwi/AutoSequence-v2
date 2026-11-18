import { expect, fromTemplate, test } from './fixtures';

test('ACU 4 topes: el transportador anima paletas y dispara reglas', async ({ page }) => {
  await fromTemplate(page, 'acu4');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant-svg')).toBeVisible();
  await expect(page.locator('.pl-pallet')).toHaveCount(7);
  await expect(page.locator('.pl-stop')).toHaveCount(4);
  await page.locator('[data-speed="10"]').click();
  // Con el tiempo acelerado, los robots completan ciclos y el PLC abre topes.
  await expect(page.locator('.plant-log tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.plant-stats')).toContainText(/Robot de carga\s*[1-9]\d* ciclos/, { timeout: 20_000 });
  // Fallo de par: el motor se para.
  await page.locator('[data-pl-toggle="PX21"]').click();
  await expect(page.locator('.plant-stats')).toContainText('Parado');
});

test('proyecto sin transportador: se piden las medidas y se puede deshacer', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await page.locator('[data-mode="plant"]').click();
  const form = page.locator('.plant-setup');
  await expect(form).toBeVisible();
  await form.locator('input[name="length"]').fill('8000');
  await form.locator('[data-act="create"]').click();
  await expect(page.locator('.plant-svg')).toBeVisible();
  await expect(page.locator('.plant-editor input[name="length"]')).toHaveValue('8000');
  // Mover un tope a la línea de arriba.
  await page.locator('.plant-editor [data-group="stops"] [data-f="line"]').first().selectOption('top');
  await expect(page.locator('.plant-editor [data-group="stops"] [data-f="line"]').first()).toHaveValue('top');
  // Deshacer dos veces vuelve al formulario inicial.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.plant-setup')).toBeVisible();
});
