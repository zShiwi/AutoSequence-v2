import { readFile } from 'node:fs/promises';
import { expect, fromTemplate, go, modalPrimary, ruleCount, test } from './fixtures';

test('papelera: un proyecto borrado se recupera', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await page.locator('.brand').click();
  const rows = page.locator('.table--projects tbody tr');
  await expect(rows).toHaveCount(1);

  await rows.first().locator('[data-act="del"]').click();
  await modalPrimary(page).click();
  await expect(rows).toHaveCount(0);

  await page.locator('[data-act="trash"]').click();
  const dialog = page.locator('.modal').last();
  await expect(dialog.locator('.versions__list li')).toHaveCount(1);
  await dialog.locator('[data-restore]').click();
  await expect(dialog.locator('.versions__empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(1);
});

test('copia de seguridad completa: descarga e importación', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await page.locator('.brand').click();
  await fromTemplate(page, 'acu4');
  await page.locator('.brand').click();
  const rows = page.locator('.table--projects tbody tr');
  await expect(rows).toHaveCount(2);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.page-head [data-act="backup"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^autosequence-copia-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup.format).toBe('autosequence-backup');
  expect(backup.projects).toHaveLength(2);

  // Importar la copia añade de nuevo los dos proyectos (con nombres únicos).
  await page.locator('[data-act="import"]').setInputFiles(file);
  await expect(page.locator('.toast').last()).toContainText('2 proyectos importados');
  await expect(rows).toHaveCount(4);
});

test('versiones: guardar una versión con nombre y restaurar otra anterior', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  await go(page, 'logic');
  const rules = page.locator('.rule');
  const n = await ruleCount(page);

  const deleteFirst = async (expected: number) => {
    await page.locator('.rule[data-i="0"] [data-r="del"]').click();
    await modalPrimary(page).click();
    await expect(rules).toHaveCount(expected);
  };

  // Primer cambio: se guarda automáticamente la primera versión.
  await deleteFirst(n - 1);
  await expect(page.locator('.save-state--saved')).toBeVisible();
  // Segundo cambio y versión con nombre.
  await deleteFirst(n - 2);
  await expect(page.locator('.save-state--saved')).toBeVisible();

  await page.locator('[data-act="versions"]').click();
  const dialog = page.locator('.modal').last();
  await expect(dialog.locator('.versions__list li')).toHaveCount(1);
  await dialog.locator('[data-act="save"]').click();
  await page.locator('#prompt-input').fill('Antes de revisar');
  await modalPrimary(page).click();
  const versions = page.locator('.modal').first().locator('.versions__list li');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('Antes de revisar');

  // Restaurar la más antigua (con una regla más).
  await versions.last().locator('[data-restore]').click();
  await modalPrimary(page).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(rules).toHaveCount(n - 1);

  // Restaurar se puede deshacer.
  await page.locator('[data-act="undo"]').click();
  await expect(rules).toHaveCount(n - 2);
});
