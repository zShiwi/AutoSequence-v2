import { expect, fromTemplate, go, test, type Section } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('móvil 390 px: ninguna sección se desborda en horizontal', async ({ page }) => {
  await fromTemplate(page, 'acu4');
  const sections: Section[] = ['signals', 'logic', 'sim', 'code', 'docs'];
  for (const s of sections) {
    await go(page, s);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `desbordamiento en ${s}`).toBeLessThanOrEqual(0);
  }
  await go(page, 'sim');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant-svg')).toBeVisible();
  const plant = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(plant, 'desbordamiento en el transportador').toBeLessThanOrEqual(0);
  await page.locator('[data-pl="edit"]').click();
  await expect(page.locator('.plant-editor')).toBeVisible();
  const editor = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(editor, 'desbordamiento en el editor del transportador').toBeLessThanOrEqual(0);
  await page.goto('/');
  const home = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(home, 'desbordamiento en Proyectos').toBeLessThanOrEqual(0);
});
