import { expect, go, modalPrimary, test } from './fixtures';

test('asistente: ACU de suelo con 6 topes crea motor, secuencia y topes', async ({ page }) => {
  await page.goto('/');
  await page.locator('.page-head [data-act="new"]').click();
  const wiz = page.locator('.wizard');
  await expect(wiz.locator('[data-kind="aereo"]')).toHaveAttribute('aria-checked', 'true');
  await wiz.locator('[data-kind="suelo"]').click();
  await wiz.locator('[data-step="1"]').click();
  await wiz.locator('[data-step="1"]').click();
  await expect(page.locator('#wiz-stops')).toHaveValue('6');
  // Nombre propuesto mientras no se escriba otro.
  await expect(page.locator('#wiz-name')).toHaveValue('ACU de suelo 6 topes');
  await expect(wiz.locator('[data-slot="summary"]')).toContainText('C01–C06');
  await modalPrimary(page).click();

  await expect(page).toHaveURL(/\/signals$/);
  await expect(page.locator('[data-f="name"]').first()).toBeVisible();
  const names = await page.locator('[data-f="name"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toEqual(expect.arrayContaining(['M01', 'PX21', 'PX22', 'PX23', 'C01', 'C06']));
  expect(names).not.toContain('C07');

  // Se añade a mano la presencia de C01 y el transportador la recoge.
  const c01 = names.indexOf('C01');
  await page.locator('.card__foot [data-act="add"]').click();
  await page.locator(`tr[data-i="${names.length}"] [data-f="name"]`).fill('PX01');
  await page.locator(`tr[data-i="${names.length}"] [data-f="name"]`).blur();
  await page.locator(`tr[data-i="${c01}"] [data-f="presence"]`).selectOption('PX01');

  await go(page, 'logic');
  await expect(page.locator('.rule')).toHaveCount(7);

  await go(page, 'sim');
  await page.locator('[data-mode="plant"]').click();
  // Un solo aviso agrupado con los cinco topes que faltan.
  await expect(page.getByText('5 topes sin sensor de presencia: C02, C03, C04, C05, C06.')).toBeVisible();
});

test('asistente: el número de topes no pasa de los límites y Vacío no crea nada', async ({ page }) => {
  await page.goto('/');
  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('#wiz-stops').fill('500');
  await page.locator('#wiz-stops').blur();
  await expect(page.locator('#wiz-stops')).toHaveValue('20');
  await page.locator('.wizard [data-kind="vacio"]').click();
  await expect(page.locator('.wizard [data-slot="stops"]')).toBeHidden();
  await expect(page.locator('#wiz-name')).toHaveValue('');
  await modalPrimary(page).click();
  await expect(page.locator('.wizard .field__error')).toContainText('nombre');
  await page.locator('#wiz-name').fill('Vacío de prueba');
  await page.locator('#wiz-name').press('Enter');
  await expect(page).toHaveURL(/\/signals$/);
  await expect(page.locator('.empty h2')).toContainText('Sin señales');
});
