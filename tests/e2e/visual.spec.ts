import { expect, fromTemplate, go, test } from './fixtures';
import type { Page } from '@playwright/test';

const MOBILE = { width: 390, height: 844 };

async function openPlant(page: Page): Promise<void> {
  await fromTemplate(page, 'acu4');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tag3d--stop')).toHaveCount(4);
}

/** Cajas en pantalla de las etiquetas 3D visibles (sin las de paleta). */
const tagRects = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('.plant3d')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.tag3d:not(.tag3d--pallet)')]
      .filter((e) => e.offsetWidth > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { name: e.querySelector('b')!.textContent, l: r.left - host.left, r: r.right - host.left, t: r.top - host.top, b: r.bottom - host.top, w: host.width, h: host.height };
      });
  });

test.describe('escritorio', () => {
  test('esquema: los números de paleta se leen derechos en todo el lazo', async ({ page }) => {
    await openPlant(page);
    await page.locator('[data-view="plan"]').click();
    await expect(page.locator('.pl-pallet')).toHaveCount(7);
    // Con la matriz en pantalla: sin giro (b = 0) y sin volteo (a > 0).
    const ctms = await page.locator('.pl-pallet__id').evaluateAll((els) =>
      els.map((e) => {
        const m = (e as SVGTextElement).getScreenCTM()!;
        return { a: m.a, b: m.b };
      }),
    );
    expect(ctms.length).toBe(7);
    ctms.forEach((m) => {
      expect(m.a).toBeGreaterThan(0);
      expect(Math.abs(m.b)).toBeLessThan(0.02);
    });
  });

  test('vista 3D: las etiquetas no se pisan, no se salen y quedan bajo los avisos', async ({ page }) => {
    await openPlant(page);
    await page.waitForTimeout(800);
    const rects = await tagRects(page);
    expect(rects.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      expect(a.l, `${a.name} dentro por la izquierda`).toBeGreaterThanOrEqual(0);
      expect(a.r, `${a.name} dentro por la derecha`).toBeLessThanOrEqual(a.w);
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        const clash = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(clash, `${a.name} pisa a ${b.name}`).toBe(false);
      }
    }
    // Las etiquetas llevan z-index propio: la vista lo contiene.
    expect(await page.locator('.plant3d').evaluate((e) => getComputedStyle(e).isolation)).toBe('isolate');
    // La ayuda va sobre fondo propio, por encima del dibujo.
    const hint = await page.locator('.plant3d__hint').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(hint).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('«Medidas y posiciones» lleva el editor a la vista, avisa de la pausa y reanuda al cerrar', async ({ page }) => {
    await openPlant(page);
    const run = page.locator('[data-pl="run"]');
    await expect(run).toContainText('Pausa');
    await page.locator('[data-pl="edit"]').click();
    await expect(page.locator('.plant-editor')).toBeInViewport();
    await expect(page.locator('.toast', { hasText: 'en pausa mientras editas' })).toBeVisible();
    await expect(run).toContainText('Iniciar');
    await page.locator('[data-pl="edit"]').click();
    await expect(page.locator('.plant-editor')).toHaveCount(0);
    await expect(run).toContainText('Pausa');
  });

  test('estado del PLC: los cilindros muestran una píldora Abre/Cierra', async ({ page }) => {
    await openPlant(page);
    const pills = page.locator('[data-slot="state"] .io__pill');
    await expect(pills).toHaveCount(4);
    await expect(pills.first()).toHaveText(/Abre|Cierra/);
  });

  test('cronograma más ancho que su tarjeta: el borde derecho avisa de que continúa', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await fromTemplate(page, 'acu4');
    const d = page.locator('.diagram-scroll').first();
    await expect(d).toHaveClass(/has-more-right/);
    await d.evaluate((e) => (e.scrollLeft = e.scrollWidth));
    await expect(d).not.toHaveClass(/has-more-right/);
    await expect(d).toHaveClass(/has-more-left/);
  });

  test('avisos emergentes: centrados abajo y sin franja que sobresalga', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible();
    const info = await toast.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { border: getComputedStyle(e).borderLeftWidth, center: r.left + r.width / 2, vw: window.innerWidth };
    });
    expect(info.border).toBe('0px');
    expect(Math.abs(info.center - info.vw / 2)).toBeLessThan(4);
  });

  test('versiones: «Guardar versión ahora» es la acción principal del pie', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await page.locator('[data-act="versions"]').click();
    const dialog = page.locator('.modal').last();
    await expect(dialog.locator('.modal__foot .btn--primary')).toHaveText(/Guardar versión ahora/);
    await expect(dialog.locator('.versions__empty')).toContainText('Todavía no hay versiones');
  });

  test('proyectos: las cabeceras numéricas se alinean con sus cifras', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await page.locator('.brand').click();
    const th = page.locator('.table--projects th.num').first();
    await expect(th).toBeVisible();
    expect(await th.evaluate((e) => getComputedStyle(e).textAlign)).toBe('right');
  });
});

test.describe('móvil 390 px', () => {
  test.use({ viewport: MOBILE });

  test('señales: cada fila es una tarjeta con el nombre legible', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    await go(page, 'signals');
    const name = page.locator('tr[data-i="0"] [data-f="name"]');
    await expect(name).toBeVisible();
    expect((await name.boundingBox())!.width).toBeGreaterThan(200);
    expect((await page.locator('tr[data-i="0"] [data-f="type"]').boundingBox())!.width).toBeGreaterThan(120);
    expect((await page.locator('tr[data-i="0"] [data-f="description"]').boundingBox())!.width).toBeGreaterThan(280);
    // Los filtros siguen ocultando filas.
    await page.locator('.fchip[data-type="Motor"]').click();
    await expect(page.locator('tr[data-i]:visible')).toHaveCount(1);
  });

  test('código: las tres pestañas caben y se ve cuál está activa', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    await go(page, 'code');
    for (const id of ['awl', 'kop', 'symbols']) {
      await page.locator(`[data-tab="${id}"]`).click();
      const tab = page.locator(`[data-tab="${id}"]`);
      await expect(tab).toHaveClass(/is-active/);
      // La pestaña solapa 1 px con la línea inferior de la barra.
      await expect(tab).toBeInViewport({ ratio: 0.95 });
    }
    await expect(page.locator('[data-tab="kop"] .lbl-short')).toBeVisible();
    await expect(page.locator('[data-tab="kop"] .lbl-long')).toBeHidden();
    // Las herramientas van en su propia fila, debajo de las pestañas.
    const tabs = (await page.locator('.tabs-bar--card .tabs').boundingBox())!;
    const tools = (await page.locator('.tabs-bar__tools').boundingBox())!;
    expect(tools.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
  });

  test('simulación: el selector de modo cabe en una línea', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    const heights = await page.locator('[data-mode]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    heights.forEach((hh) => expect(hh).toBeLessThanOrEqual(32));
    await expect(page.locator('[data-mode="auto"]')).toHaveAccessibleName('Escenario automático');
    // El cronograma deja a la vista más ciclos que nombres.
    const svg = page.locator('.timing-svg').first();
    await expect(svg.locator('text', { hasText: /^SAL$/ })).toHaveCount(0);
  });

  test('lógica: cada regla conserva su número', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    await go(page, 'logic');
    await expect(page.locator('.rule__num').first()).toBeVisible();
    await expect(page.locator('.rule__num').first()).toHaveText(/^R\d+$/);
  });

  test('transportador: etiquetas compactas dentro de la vista y editor en tarjetas', async ({ page }) => {
    await openPlant(page);
    await expect(page.locator('.plant3d')).toHaveClass(/plant3d--compact/);
    await page.waitForTimeout(800);
    const rects = await tagRects(page);
    expect(rects.length).toBeGreaterThanOrEqual(10);
    rects.forEach((a) => {
      expect(a.l, `${a.name} dentro por la izquierda`).toBeGreaterThanOrEqual(0);
      expect(a.r, `${a.name} dentro por la derecha`).toBeLessThanOrEqual(a.w);
    });
    // Solo el código; el detalle aparece al tocar la etiqueta.
    const stop = page.locator('.tag3d--stop').first();
    await expect(stop.locator('[data-st]')).toBeHidden();
    await stop.click();
    await expect(stop.locator('[data-st]')).toBeVisible();

    await page.locator('[data-pl="edit"]').click();
    const cell = page.locator('.plant-editor [data-group="stops"] tr').first().locator('td[data-label="Tiempo cilindro"]');
    await expect(cell).toBeVisible();
    await cell.scrollIntoViewIfNeeded();
    await expect(cell).toBeInViewport({ ratio: 1 });
    expect(await cell.evaluate((e) => getComputedStyle(e, '::before').content)).toContain('Tiempo cilindro');
  });
});
