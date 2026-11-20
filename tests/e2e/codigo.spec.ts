import { expect, fromTemplate, go, test } from './fixtures';

test.describe('Código PLC', () => {
  test('la tabla de símbolos incluye las marcas auxiliares que usa el AWL', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await go(page, 'code');

    // El aviso dice qué marcas reserva de verdad este programa.
    await expect(page.locator('.callout')).toContainText('M100–M109 memorias de flanco');
    await expect(page.locator('.callout')).toContainText('reglas activas');

    const awl = (await page.locator('pre.code').innerText()).replace(/ /g, ' ');
    const memory = awl.match(/F[PN]\s+(M \d+\.\d)/)?.[1];
    const flag = awl.match(/=\s+(M \d+\.\d)\s+\/\/ regla activa/)?.[1];
    expect(memory).toBeTruthy();
    expect(flag).toBeTruthy();

    await page.locator('[data-tab="symbols"]').click();
    const rows = page.locator('table.table tbody tr');
    await expect(rows.filter({ hasText: 'FL_MEM_001' })).toContainText(memory!);
    await expect(rows.filter({ hasText: 'FL_MEM_001' })).toContainText('Memoria de flanco');
    await expect(rows.filter({ hasText: 'REGLA_001' })).toContainText(flag!);
    // La pestaña cuenta todas las filas que se listan.
    const count = await rows.count();
    await expect(page.locator('[data-tab="symbols"]')).toContainText(`· ${count}`);
  });

  test('el esquema de contactos numera cada network con su regla', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await go(page, 'code');
    await page.locator('[data-tab="kop"]').click();
    await expect(page.locator('.ladder-svg')).toContainText('Network 1');
    await page.locator('[data-act="kop-text"]').check();
    await expect(page.locator('pre.code')).toContainText('Network 1:');
  });
});
