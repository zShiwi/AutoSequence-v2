import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, fromTemplate, go, test } from './fixtures';

/** Transportador y cronograma: segunda tanda de la revisión. */

const MOBILE = { width: 390, height: 844 };

async function openPlant(page: Page): Promise<void> {
  await fromTemplate(page, 'acu4');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tag3d--pallet')).toHaveCount(7);
}

/** Cajas de las etiquetas 3D que se ven, separando las de paleta. */
const tags = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tag3d')]
      .filter((e) => e.offsetWidth > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { pallet: e.classList.contains('tag3d--pallet'), text: (e.querySelector('b') as HTMLElement).innerText.trim(), l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
  );

type Tag = Awaited<ReturnType<typeof tags>>[number];
const clash = (a: Tag, b: Tag) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

function expectPalletsClear(list: Tag[]): Tag[] {
  const pallets = list.filter((t) => t.pallet);
  pallets.forEach((p) => list.filter((o) => o !== p).forEach((o) => expect(clash(p, o), `${p.text} y ${o.text} se pisan`).toBe(false)));
  return pallets;
}

test.describe('escritorio', () => {
  test('vista 3D: los números de paleta se ven todos y ninguna etiqueta los tapa', async ({ page }) => {
    await openPlant(page);
    await page.waitForTimeout(800);
    const pallets = expectPalletsClear(await tags(page));
    expect(pallets.map((p) => p.text).sort()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    // Con las paletas en marcha siguen sin pisarse con nada.
    await page.locator('[data-speed="10"]').click();
    await page.waitForTimeout(2500);
    expect(expectPalletsClear(await tags(page)).length).toBeGreaterThanOrEqual(4);
    // Desde arriba, la que queda bajo la etiqueta de un tope se oculta en vez de montarse.
    await page.locator('[data-cam="superior"]').click();
    await page.waitForTimeout(800);
    expectPalletsClear(await tags(page));
  });

  test('cronograma: la columna de nombres queda fija al desplazar las ondas', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await fromTemplate(page, 'acu4');
    const host = page.locator('.diagram-scroll').first();
    const names = host.locator('.timing-names');
    const waves = host.locator('.timing-svg--waves');
    await expect(names).toBeVisible();
    const before = { names: (await names.boundingBox())!, waves: (await waves.boundingBox())!, host: (await host.boundingBox())! };
    // Las dos mitades miden lo mismo de alto y van a la misma altura.
    expect(before.names.height).toBe(before.waves.height);
    expect(Math.abs(before.names.y - before.waves.y)).toBeLessThan(1);
    expect(Math.abs(before.waves.x - (before.names.x + before.names.width))).toBeLessThan(1);

    await host.evaluate((e) => (e.scrollLeft = 300));
    await expect(host).toHaveClass(/has-more-left/);
    const after = { names: (await names.boundingBox())!, waves: (await waves.boundingBox())! };
    expect(Math.abs(after.names.x - before.host.x)).toBeLessThan(1.5);
    expect(before.waves.x - after.waves.x).toBeGreaterThan(280);
    await expect(names.locator('text', { hasText: /^M01$/ })).toBeInViewport();
    // La columna fija tapa las ondas que pasan por debajo y no se difumina.
    expect(await names.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await host.evaluate((e) => getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage)).toMatch(/to right|90deg|none/);

    // La ficha de una regla sigue saliendo junto a su etiqueta.
    const tag = waves.locator('.fx-tag').last();
    await tag.scrollIntoViewIfNeeded();
    await tag.hover();
    await expect(host.locator('.fx-tip')).toBeVisible();
  });

  test('cronograma: el SVG descargado es uno solo, con nombres y ondas', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-svg="0"]').click()]);
    expect(dl.suggestedFilename()).toMatch(/cronograma\.svg$/);
    const svg = await readFile((await dl.path())!, 'utf8');
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain('>M01<');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('var(--');
  });

  test('paletas que no caben: aviso junto al contador y en el campo donde se configuran', async ({ page }) => {
    await openPlant(page);
    await expect(page.locator('[data-slot="pallets-over"]')).toHaveCount(0);
    await page.locator('[data-pl="edit"]').click();
    const input = page.locator('.plant-editor input[name="pallets"]');
    await expect(page.locator('.plant-editor .field', { has: page.locator('input[name="pallets"]') }).locator('.field__hint')).toHaveText('Caben 17 como mucho');
    await input.fill('25');
    await input.blur();
    // Antes, entre 18 y 33 no se avisaba y el lazo arrancaba con menos sin decir nada.
    await expect(page.locator('.plant-issue--warn')).toContainText('Hay 25 paletas configuradas y solo caben 17');
    await expect(page.locator('[data-slot="pallets-over"]')).toHaveText('Sobran 8');
    const field = page.locator('.plant-editor .field--warn');
    await expect(field.locator('input[name="pallets"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(field.locator('.field__warn')).toContainText('Solo caben 17: sobran 8');
    // La simulación sigue en pie con las que caben.
    await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.plant-stats')).toContainText('de 17 posibles');
    // Al quitar una desde el contador, lo configurado vuelve a ser lo que hay.
    await page.locator('[data-pl="pminus"]').click();
    await expect(page.locator('[data-slot="pallets-over"]')).toHaveCount(0);
    await expect(page.locator('.plant-editor input[name="pallets"]')).toHaveValue('16');
    await expect(page.locator('.plant-editor .field--warn')).toHaveCount(0);
  });

  test('por qué no abre un tope: el aviso respeta los grupos «O»', async ({ page }) => {
    const sensor = (name: string, description = '', initial = 0) => ({ name, type: 'Sensor', initial, description });
    const cond = (signal: string, event: string, operator = 'AND') => ({ signal, event, delay: 0, operator });
    const project = {
      id: 'p_o',
      name: 'Grupos O',
      signals: [
        { name: 'C1', type: 'Cilindro', initial: 0, description: 'Tope' },
        sensor('PXP'),
        sensor('ROBOT_OK', 'Robot listo'),
        sensor('PX09', 'Liberación manual'),
        sensor('PX10', 'Zona siguiente ocupada', 1),
      ],
      rules: [],
      blocks: [
        {
          name: 'Zona',
          rules: [
            {
              id: 1,
              name: 'Abrir tope',
              conditions: [cond('PXP', '==1'), cond('ROBOT_OK', '==1'), cond('PX09', '==1', 'OR'), cond('PX10', '==0')],
              actions: [{ signal: 'C1', value: '1' }],
            },
          ],
        },
      ],
      layout: {
        length: 3000,
        radius: 300,
        direction: 'ccw',
        palletLength: 400,
        palletGap: 20,
        speed: 250,
        pallets: 1,
        stops: [{ cylinder: 'C1', presence: 'PXP', line: 'bottom', x: 1500, travelMs: 300 }],
        sensors: [],
        stations: [{ stop: 'C1', label: 'Robot', action: 'load', release: 'ROBOT_OK', okSensors: [], nokSensors: [], cycleMs: 600000 }],
      },
    };
    await page.goto('/');
    await page.evaluate((v) => localStorage.setItem('autosequence_projects', JSON.stringify(v)), [project]);
    await page.reload();
    await page.locator('.link-cell', { hasText: 'Grupos O' }).click();
    await go(page, 'sim');
    await page.locator('[data-mode="plant"]').click();
    await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });

    // El robot sigue trabajando, pero PX09 no es suyo: el grupo se muestra entero.
    const why = page.locator('.tag3d--stop [data-why]');
    await expect(why).toHaveText('espera (ROBOT_OK = 1 o PX09 = 1), PX10 = 0');
    const prod = page.locator('[data-slot="prod"]');
    await expect(prod).toContainText('C1 no abre: falta (ROBOT_OK = 1 (Robot listo) o PX09 = 1 (Liberación manual)), PX10 = 0 (Zona siguiente ocupada)');

    // Basta una alternativa: al cumplirse PX09 solo queda lo demás.
    await page.locator('[data-pl-toggle="PX09"]').click();
    await expect(why).toHaveText('espera PX10 = 0');
    await page.locator('[data-pl-toggle="PX10"]').click();
    await expect(why).toBeHidden();
    await expect(page.locator('.tag3d--stop [data-st]')).toHaveText(/abriendo|tope abierto/);
  });
});

test.describe('móvil 390 px', () => {
  test.use({ viewport: MOBILE });

  test('vista 3D: los números de paleta no se apelotonan', async ({ page }) => {
    await openPlant(page);
    await expect(page.locator('.plant3d')).toHaveClass(/plant3d--compact/);
    await page.waitForTimeout(800);
    const pallets = expectPalletsClear(await tags(page));
    // En estrecho, solo el número; con la cola de arranque caben casi todas.
    expect(pallets.length).toBeGreaterThanOrEqual(5);
    pallets.forEach((p) => expect(p.text).toMatch(/^\d+$/));
    await page.locator('[data-speed="10"]').click();
    await page.waitForTimeout(2500);
    expect(expectPalletsClear(await tags(page)).length).toBeGreaterThanOrEqual(3);
  });

  test('cronograma: los nombres siguen a la vista al desplazar los ciclos', async ({ page }) => {
    await fromTemplate(page, 'acu4');
    const host = page.locator('.diagram-scroll').first();
    const names = host.locator('.timing-names');
    const box = (await names.boundingBox())!;
    // Columna estrecha: quedan a la vista más ciclos que nombres.
    expect(box.width).toBeLessThan(160);
    await host.evaluate((e) => (e.scrollLeft = e.scrollWidth));
    const moved = (await names.boundingBox())!;
    expect(Math.abs(moved.x - (await host.boundingBox())!.x)).toBeLessThan(1.5);
    await expect(names.locator('text', { hasText: /^M01$/ })).toBeInViewport();
    expect((await host.locator('.timing-svg--waves').boundingBox())!.height).toBe(moved.height);
  });

  test('esquema: el borde avisa de que el transportador continúa', async ({ page }) => {
    await openPlant(page);
    await page.locator('[data-view="plan"]').click();
    const canvas = page.locator('.plant-canvas');
    await expect(canvas).toHaveClass(/has-more-right/);
    await canvas.evaluate((e) => (e.scrollLeft = e.scrollWidth));
    await expect(canvas).not.toHaveClass(/has-more-right/);
    await expect(canvas).toHaveClass(/has-more-left/);
  });

  test('paletas que no caben: el aviso cabe junto al contador', async ({ page }) => {
    await openPlant(page);
    await page.locator('[data-pl="edit"]').click();
    const input = page.locator('.plant-editor input[name="pallets"]');
    await input.fill('20');
    await input.blur();
    const chip = page.locator('[data-slot="pallets-over"]');
    await expect(chip).toHaveText('Sobran 3');
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toBeInViewport({ ratio: 1 });
    const warn = page.locator('.plant-editor .field__warn');
    await warn.scrollIntoViewIfNeeded();
    await expect(warn).toBeInViewport({ ratio: 1 });
  });
});
