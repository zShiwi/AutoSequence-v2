import { expect, fromTemplate, go, modalPrimary, ruleCount, test } from './fixtures';

test('plantilla ACU: cronogramas separados por bloque y ficha de cada regla', async ({ page }) => {
  await fromTemplate(page, 'acu4');
  await expect(page.locator('.sim-view')).toHaveCount(3);
  await expect(page.locator('.sim-view h2')).toHaveText(['Seguridad motor', 'Zona de carga', 'Zona de descarga']);
  await expect(page.locator('.callout--warn')).toHaveCount(0);

  const tag = page.locator('.sim-view').nth(1).locator('.fx-tag').first();
  await tag.hover();
  const tip = page.locator('.fx-tip:not([hidden])');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/R\d+ · /);
  await expect(tip).toContainText('→');
});

test('condiciones «O»: grupo en paralelo en Lógica y U( en el AWL', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await go(page, 'logic');
  const before = await ruleCount(page);

  await page.locator('.page-head [data-act="new"]').click();
  const editor = page.locator('.editor');
  await editor.locator('[data-c="signal"]').first().selectOption('S1_marcha');
  await editor.locator('[data-act="add-cond"]').click();
  await editor.locator('select[data-c="op"]').first().selectOption('OR');
  await editor.locator('[data-c="signal"]').nth(1).selectOption('S2_paro');
  await editor.locator('[data-a="signal"]').first().selectOption('M1_cinta');
  await expect(page.locator('.editor__preview .or-group')).toHaveCount(1);
  await page.locator('#rule-name').fill('Marcha por cualquiera');
  await modalPrimary(page).click();

  await expect(page.locator('.rule')).toHaveCount(before + 1);
  const rule = page.locator('.rule', { hasText: 'Marcha por cualquiera' });
  await expect(rule.locator('.or-group')).toHaveCount(1);
  await expect(rule.locator('.or-group .kw--or')).toHaveText('O');

  await go(page, 'code');
  const awl = await page.locator('pre.code').innerText();
  expect(awl).toContain('U(');
  expect(awl).toMatch(/O\s+"S1_marcha"/);
  expect(awl).toMatch(/O\s+"S2_paro"/);

  // KOP gráfico: la regla nueva tiene un contacto más en el esquema.
  await page.locator('[data-tab="kop"]').click();
  await expect(page.locator('.ladder-svg')).toBeVisible();
});

test('deshacer y rehacer: Ctrl+Z, botón y Ctrl+Y', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await go(page, 'logic');
  const rules = page.locator('.rule');
  const n = await ruleCount(page);
  const undoBtn = page.locator('[data-act="undo"]');
  await expect(undoBtn).toBeDisabled();

  const deleteFirst = async () => {
    await page.locator('.rule[data-i="0"] [data-r="del"]').click();
    await modalPrimary(page).click();
    await expect(rules).toHaveCount(n - 1);
  };

  // Ctrl+Z fuera de un campo de texto.
  await deleteFirst();
  await page.locator('.page-head h1').click();
  await page.keyboard.press('Control+z');
  await expect(rules).toHaveCount(n);

  // Botón de la barra superior.
  await deleteFirst();
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await expect(rules).toHaveCount(n);

  // Rehacer con Ctrl+Y.
  await page.locator('.page-head h1').click();
  await page.keyboard.press('Control+y');
  await expect(rules).toHaveCount(n - 1);
});
