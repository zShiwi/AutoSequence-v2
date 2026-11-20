import { expect, go, modalPrimary, test } from './fixtures';

test('proyecto desde cero: señales, reglas, edición y código', async ({ page }) => {
  await page.goto('/');

  // Crear proyecto vacío.
  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('.wizard [data-kind="vacio"]').click();
  await page.locator('#wiz-name').fill('Prensa hidráulica');
  await modalPrimary(page).click();
  await expect(page).toHaveURL(/\/signals$/);
  await expect(page.locator('.empty h2')).toContainText('Sin señales');

  // Señales: un pulsador y un cilindro con sus inductivos.
  await page.locator('.empty [data-act="add"]').click();
  await page.locator('tr[data-i="0"] [data-f="name"]').fill('PB_inicio');
  await page.locator('.card__foot [data-act="add"]').click();
  await page.locator('tr[data-i="1"] [data-f="name"]').fill('Y1_prensa');
  await page.locator('tr[data-i="1"] [data-f="type"]').selectOption('Cilindro');
  await page.locator('tr[data-i="1"] [data-f="inductivoActivo"]').fill('Y1_abajo');
  await page.locator('tr[data-i="1"] [data-f="inductivoReposo"]').fill('Y1_arriba');

  // Un nombre repetido se marca como error y se puede borrar.
  await page.locator('.card__foot [data-act="add"]').click();
  await page.locator('tr[data-i="2"] [data-f="name"]').fill('PB_inicio');
  await expect(page.locator('tr[data-i="2"] .cell-error')).toContainText('repetido');
  await page.locator('tr[data-i="2"] [data-f="delete"]').click();
  await expect(page.locator('tr[data-i]')).toHaveCount(2);

  // Reglas con el editor.
  await go(page, 'logic');
  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('.editor [data-c="signal"]').first().selectOption('PB_inicio');
  await page.locator('.editor [data-c="event"]').first().selectOption('Flanco ascendente');
  await page.locator('.editor [data-a="signal"]').first().selectOption('Y1_prensa');
  await modalPrimary(page).click();
  await expect(page.locator('.rule')).toHaveCount(1);

  await page.locator('.page-head [data-act="new"]').click();
  await page.locator('.editor [data-c="signal"]').first().selectOption('Y1_abajo');
  await page.locator('.editor [data-c="event"]').first().selectOption('Flanco ascendente');
  await page.locator('.editor [data-a="signal"]').first().selectOption('Y1_prensa');
  await page.locator('.editor [data-a="value"]').first().selectOption('0');
  await page.locator('#rule-name').fill('Retorno de prensa');
  await modalPrimary(page).click();
  await expect(page.locator('.rule')).toHaveCount(2);

  // El editor exige al menos una condición.
  await page.locator('.page-head [data-act="new"]').click();
  await modalPrimary(page).click();
  await expect(page.locator('.modal [data-slot="error"]')).toContainText('condición');
  await page.keyboard.press('Escape');

  // Cancelar la edición no borra la regla (fallo del prototipo original).
  await page.locator('.rule[data-i="0"] [data-r="edit"]').click();
  await page.locator('.modal [data-close]').click();
  await expect(page.locator('.rule')).toHaveCount(2);

  // El AWL generado contiene SET y RESET del cilindro.
  await go(page, 'code');
  const awl = await page.locator('pre.code').innerText();
  expect(awl).toMatch(/S\s+"Y1_prensa"/);
  expect(awl).toMatch(/R\s+"Y1_prensa"/);

  // Se conserva tras recargar (autoguardado).
  await page.reload();
  await go(page, 'logic');
  await expect(page.locator('.rule')).toHaveCount(2);
});

test('compatibilidad: un proyecto del prototipo original se abre y simula', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'autosequence_projects',
      JSON.stringify([
        {
          name: 'Proyecto antiguo',
          signals: [
            { name: 'VI-2-SCT1', type: 'Sensor', initial: '0', description: 'Torque' },
            { name: 'alarma', type: 'Virtual', initial: 0, description: '' },
          ],
          rules: [],
          blocks: [
            {
              name: 'Bloque principal',
              rules: [
                {
                  id: 1,
                  name: 'VI-2-SCT1 → alarma',
                  conditions: [{ signal: 'VI-2-SCT1', event: 'Flanco ascendente', delay: 0 }],
                  actions: [{ signal: 'alarma', value: '1' }],
                },
              ],
            },
          ],
        },
      ]),
    );
  });
  await page.reload();
  await page.locator('.link-cell', { hasText: 'Proyecto antiguo' }).click();
  await go(page, 'sim');
  await expect(page.locator('.timing-svg')).toHaveCount(1);
  await expect(page.locator('.fx-tag').first()).toBeVisible();
});
