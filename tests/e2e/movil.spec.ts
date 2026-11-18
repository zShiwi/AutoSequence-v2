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
  await page.goto('/');
  const home = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(home, 'desbordamiento en Proyectos').toBeLessThanOrEqual(0);
});
