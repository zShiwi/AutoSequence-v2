import type { Page } from '@playwright/test';
import { expect, fromTemplate, go, modalPrimary, test, type Section } from './fixtures';

/** UX general: atajos, importar y exportar, señales, avisos, ayudas, foco y tema oscuro. */

const MOBILE = { width: 390, height: 844 };
const SECTIONS: Section[] = ['signals', 'logic', 'sim', 'code', 'docs'];

const backupFile = (projects: unknown[]) => ({
  name: 'copia-taller.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ format: 'autosequence-backup', version: 2, projects })),
});

const projectNames = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('autosequence_projects') ?? '[]') as { name: string }[]).map((p) => p.name));

/** Espera a que no quede ningún aviso (los de crear el proyecto, etc.). */
async function noToasts(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('.toast').forEach((t) => t.click()));
  await expect(page.locator('.toast')).toHaveCount(0);
}

test.describe('atajos de teclado', () => {
  test('«?» y el botón de la barra abren el panel con todos los atajos; Esc lo cierra', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    const panel = page.locator('.modal--shortcuts');
    await page.keyboard.press('?');
    await expect(panel).toBeVisible();
    for (const text of ['Buscar', 'Guardar ahora', 'Deshacer', 'Rehacer', 'Ir a Señales', 'Ir a Documentación', 'Cerrar el diálogo']) {
      await expect(panel).toContainText(text);
    }
    await expect(panel.locator('kbd', { hasText: /^Alt$/ })).toHaveCount(5);
    // «?» otra vez lo cierra, sin abrir otro encima.
    await page.keyboard.press('?');
    await expect(panel).toHaveCount(0);

    const btn = page.locator('.topbar [data-act="help"]');
    await expect(btn).toHaveAttribute('title', 'Atajos de teclado (?)');
    await btn.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // También en la pantalla de proyectos.
    await page.locator('.brand').click();
    await page.keyboard.press('?');
    await expect(panel).toBeVisible();
  });

  test('escribiendo en un campo, «?» y «/» se escriben y no disparan nada', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await go(page, 'signals');
    const search = page.locator('.searchbox__input');
    await search.click();
    await page.keyboard.type('a?/');
    await expect(search).toHaveValue('a?/');
    await expect(page.locator('.modal')).toHaveCount(0);
    await search.fill('');
    const name = page.locator('[data-f="name"]').first();
    await name.click();
    await page.keyboard.press('?');
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('Ctrl+K y «/» llevan al buscador de la pantalla', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    // Simulación no tiene buscador: va a Señales y lo enfoca.
    await page.keyboard.press('Control+k');
    await expect(page).toHaveURL(/\/signals$/);
    await expect(page.locator('[data-f="q"]')).toBeFocused();
    await go(page, 'logic');
    await page.keyboard.press('/');
    await expect(page.locator('[data-f="rq"]')).toBeFocused();
    await expect(page.locator('[data-f="rq"]')).toHaveValue('');
    // Ctrl+K también vale desde otro campo.
    await go(page, 'signals');
    await page.locator('[data-f="name"]').first().click();
    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-f="q"]')).toBeFocused();
  });

  test('proyectos: Ctrl+K enfoca el buscador, que filtra por nombre sin tildes', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await page.locator('.brand').click();
    await fromTemplate(page, 'acu4');
    await page.locator('.brand').click();
    const rows = page.locator('.table--projects tbody tr:visible');
    await expect(rows).toHaveCount(2);
    await page.keyboard.press('Control+k');
    const search = page.locator('[data-f="pq"]');
    await expect(search).toBeFocused();
    await page.keyboard.type('estacion');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Estación de transferencia');
    await expect(page.locator('[data-slot="pcount"]')).toHaveText('Mostrando 1 de 2');
    await search.fill('zzz');
    await expect(page.locator('[data-slot="pempty"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rows).toHaveCount(2);
  });

  test('Alt+1…5 va a cada paso, también desde un campo', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    for (const [i, s] of SECTIONS.entries()) {
      await page.keyboard.press(`Alt+${i + 1}`);
      await expect(page).toHaveURL(new RegExp(`/${s}$`));
      await expect(page.locator(`.steps a.is-current[href$="/${s}"]`)).toBeVisible();
    }
    await expect(page.locator('.steps a').nth(2)).toHaveAttribute('title', 'Simulación (Alt+3)');
    await page.keyboard.press('Alt+1');
    await page.locator('[data-f="name"]').first().click();
    await page.keyboard.press('Alt+2');
    await expect(page).toHaveURL(/\/logic$/);
  });

  test('Ctrl+S guarda al momento y muestra «Guardado»', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await go(page, 'signals');
    await noToasts(page);
    const desc = page.locator('[data-f="description"]').first();
    await desc.fill('Descripción guardada con el atajo');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast', { hasText: /^Guardado$/ })).toBeVisible();
    // Ya está en el almacenamiento, sin esperar al autoguardado.
    expect(await page.evaluate(() => localStorage.getItem('autosequence_projects'))).toContain('Descripción guardada con el atajo');
    await expect(page.locator('.save-state')).toContainText('Guardado');
    // En la pantalla de proyectos no hay nada pendiente: lo dice.
    await page.locator('.brand').click();
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast').last()).toContainText('se guardan solos');
  });

  test('Esc cierra solo el diálogo de arriba y el foco no sale del diálogo', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await page.locator('[data-act="versions"]').click();
    await page.locator('.modal [data-act="save"]').click();
    await expect(page.locator('.modal')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(1);
    await expect(page.locator('.modal h2')).toContainText('Versiones');
    // Tab da la vuelta dentro del diálogo.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.modal'))).toBe(true);
    }
    // Con el diálogo abierto no se navega ni se deshace.
    await page.keyboard.press('Alt+2');
    await expect(page).toHaveURL(/\/sim$/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
  });
});

test.describe('importar y exportar', () => {
  test('importar pide confirmación con lo que entra, lo que se renombra y lo que se descarta', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await page.locator('.brand').click();
    const existing = (await projectNames(page))[0];
    const file = backupFile([
      { name: existing, signals: [{ name: 'S1', type: 'Sensor', initial: 0, description: '' }], blocks: [{ name: 'B', rules: [] }] },
      { name: 'Prensa nueva', signals: [] },
      { name: 'Rota', signals: 'no' },
      null,
    ]);

    // Cancelar no importa nada.
    await page.locator('[data-act="import"]').setInputFiles(file);
    const dialog = page.locator('.modal', { has: page.locator('.import-preview') });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('copia-taller.json');
    const incoming = dialog.locator('[data-group="in"] li');
    await expect(incoming).toHaveCount(2);
    await expect(incoming.nth(0)).toHaveClass(/is-renamed/);
    await expect(incoming.nth(0)).toContainText(`${existing} (2)`);
    await expect(incoming.nth(0)).toContainText('Se renombra porque ya existe');
    await expect(incoming.nth(1)).toContainText('Prensa nueva');
    await expect(incoming.nth(1)).not.toHaveClass(/is-renamed/);
    const out = dialog.locator('[data-group="out"] li');
    await expect(out).toHaveCount(2);
    await expect(out.nth(0)).toContainText('Rota');
    await expect(out.nth(1)).toContainText('Elemento 4');
    await expect(modalPrimary(page)).toHaveText('Importar 2 proyectos');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    expect(await projectNames(page)).toEqual([existing]);

    // Confirmar importa exactamente lo anunciado. El mismo archivo se puede elegir otra vez.
    await page.locator('[data-act="import"]').setInputFiles(file);
    await modalPrimary(page).click();
    await expect(page.locator('.toast').last()).toContainText('2 proyectos importados. 2 no se pudieron importar.');
    expect(await projectNames(page)).toEqual([existing, `${existing} (2)`, 'Prensa nueva']);
    await expect(page.locator('.table--projects tbody tr')).toHaveCount(3);
  });

  test('un archivo que no vale no abre el diálogo: avisa del error', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-act="import"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
    await expect(page.locator('.toast').last()).toContainText('no parece un proyecto');
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('exportar: el nombre del archivo lleva el proyecto y la fecha, con caracteres válidos en Windows', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-act="new"]').click();
    await page.locator('.wizard [data-kind="vacio"]').click();
    await page.locator('#wiz-name').fill('Línea 3: prensa <A/B>?');
    await modalPrimary(page).click();
    await expect(page).toHaveURL(/\/signals$/);
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const [fromBar] = await Promise.all([page.waitForEvent('download'), page.locator('.topbar [data-act="export"]').click()]);
    expect(fromBar.suggestedFilename()).toBe(`Línea 3 prensa A B · ${today}.json`);
    await page.locator('.brand').click();
    const [fromList] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="exp"]').first().click()]);
    expect(fromList.suggestedFilename()).toBe(`Línea 3 prensa A B · ${today}.json`);
  });
});

test.describe('señales', () => {
  test('la descripción se ve entera: el campo crece, lleva el texto en la ayuda y no admite saltos', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await go(page, 'signals');
    const desc = page.locator('textarea[data-f="description"]').first();
    const short = (await desc.boundingBox())!.height;
    expect(short).toBeLessThan(40);
    const long = 'Detecta la paleta parada en el tope de entrada de la estación de carga, habilita el robot y bloquea el avance del transportador hasta que termina el ciclo completo de la estación';
    await desc.fill(long);
    const info = await desc.evaluate((e: HTMLTextAreaElement) => ({ h: e.getBoundingClientRect().height, scroll: e.scrollHeight, client: e.clientHeight, title: e.title }));
    expect(info.h).toBeGreaterThan(short + 15);
    // Nada queda cortado ni hace falta desplazar dentro del campo.
    expect(info.scroll).toBeLessThanOrEqual(info.client + 1);
    expect(info.title).toBe(long);
    // Intro no parte la descripción (va a comentarios del AWL y al CSV).
    await desc.press('End');
    await desc.press('Enter');
    await expect(desc).toHaveValue(long);
    // Al volver a la sección sigue viéndose entera.
    await go(page, 'logic');
    await go(page, 'signals');
    const again = page.locator('textarea[data-f="description"]').first();
    await expect(again).toHaveValue(long);
    expect((await again.boundingBox())!.height).toBeGreaterThan(short + 15);
    await again.fill('Corta');
    expect((await again.boundingBox())!.height).toBeLessThan(40);
  });

  test('escritorio: la columna de inductivos es estrecha y la descripción se lleva el sitio', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fromTemplate(page, 'acu4');
    await go(page, 'signals');
    const w = async (sel: string) => (await page.locator(sel).boundingBox())!.width;
    const ind = await w('.table--signals th.col-ind');
    const desc = await w('.table--signals th:nth-child(4)');
    // 200 px: cada inductivo lleva al lado su campo de dirección.
    expect(ind).toBeLessThanOrEqual(204);
    // Ningún nombre de señal queda cortado en su campo.
    const names = await page.locator('.table--signals [data-f="name"]').evaluateAll((els) =>
      (els as HTMLInputElement[]).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.value),
    );
    expect(names).toEqual([]);
    expect(desc).toBeGreaterThan(ind * 1.5);
    // Los inductivos siguen cabiendo en sus campos.
    const cut = await page.locator('.table--signals [data-f="inductivoActivo"]').evaluateAll((els) =>
      (els as HTMLInputElement[]).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.value),
    );
    expect(cut).toEqual([]);
  });
});

test.describe('avisos emergentes', () => {
  test('se cierran al tocarlos, no se repiten y como mucho hay tres', async ({ page }) => {
    await fromTemplate(page, 'transfer');
    await noToasts(page);
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+s');
    // El mismo aviso no se apila.
    await expect(page.locator('.toast')).toHaveCount(1);
    await page.locator('.toast').click();
    await expect(page.locator('.toast')).toHaveCount(0);
    // Cuatro avisos distintos seguidos: quedan los tres últimos.
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+k');
    await expect(page.locator('.toast.is-in')).toHaveCount(3);
    await expect(page.locator('.toast', { hasText: /^Guardado$/ })).toHaveCount(0);
  });

  test.describe('móvil 390 px', () => {
    test.use({ viewport: MOBILE, hasTouch: true });

    test('no tapan el pie: respetan la zona segura, dejan hueco al final y se cierran al tocarlos', async ({ page }) => {
      await fromTemplate(page, 'transfer');
      await go(page, 'signals');
      await noToasts(page);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--toast-space').trim())).toBe('0px');
      await page.keyboard.press('Control+s');
      await page.keyboard.press('Control+z');
      const toasts = page.locator('.toast');
      await expect(toasts).toHaveCount(2);
      // La regla de posición cuenta con la zona segura del dispositivo.
      const rule = await page.evaluate(() => {
        for (const sheet of [...document.styleSheets]) {
          for (const r of [...sheet.cssRules]) {
            if (r instanceof CSSMediaRule) {
              for (const inner of [...r.cssRules]) {
                if (inner instanceof CSSStyleRule && inner.selectorText === '.toasts' && inner.style.bottom.includes('safe-area-inset-bottom')) return inner.style.bottom;
              }
            }
          }
        }
        return '';
      });
      expect(rule).toContain('env(safe-area-inset-bottom');
      // Con la página al final, el botón del pie queda por encima de los avisos.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const next = (await page.locator('.page-foot [data-act="next"]').boundingBox())!;
      const top = Math.min(...(await toasts.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))));
      expect(next.y + next.height).toBeLessThanOrEqual(top);
      // No se pisan entre sí y caben en la pantalla.
      const boxes = await toasts.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ t: r.top, b: r.bottom, l: r.left, r: r.right })));
      expect(boxes[0].b).toBeLessThanOrEqual(boxes[1].t);
      boxes.forEach((b) => {
        expect(b.l).toBeGreaterThanOrEqual(0);
        expect(b.r).toBeLessThanOrEqual(MOBILE.width);
        expect(b.b).toBeLessThanOrEqual(MOBILE.height);
      });
      // Tocar un aviso lo cierra.
      await toasts.first().tap();
      await expect(toasts).toHaveCount(1);
      await toasts.first().tap();
      await expect(toasts).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--toast-space').trim())).toBe('0px');
    });

    test('con un diálogo abierto van arriba, sin tapar sus botones', async ({ page }) => {
      await fromTemplate(page, 'transfer');
      await noToasts(page);
      await page.locator('[data-act="versions"]').click();
      await page.keyboard.press('Control+s');
      const toast = (await page.locator('.toast').boundingBox())!;
      const foot = (await page.locator('.modal__foot').boundingBox())!;
      expect(toast.y + toast.height).toBeLessThanOrEqual(foot.y);
    });
  });
});

/** Botones sin texto visible a los que les falta la ayuda o el nombre accesible. */
const unlabelled = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, [role="button"], a.icon-btn')]
      .filter((b) => b.getClientRects().length > 0 && !b.textContent?.trim())
      .filter((b) => !b.getAttribute('title')?.trim() || !b.getAttribute('aria-label')?.trim())
      .map((b) => b.outerHTML.slice(0, 140)),
  );

test('todos los botones de solo icono tienen ayuda emergente y nombre accesible', async ({ page }) => {
  await fromTemplate(page, 'acu4');
  for (const s of SECTIONS) {
    await go(page, s);
    expect(await unlabelled(page), `botones sin ayuda en ${s}`).toEqual([]);
  }
  // Barra superior: cada icono dice qué hace.
  for (const act of ['undo', 'redo', 'versions', 'help', 'theme']) {
    await expect(page.locator(`.topbar [data-act="${act}"]`)).toHaveAttribute('title', /.+/);
    await expect(page.locator(`.topbar [data-act="${act}"]`)).toHaveAttribute('aria-label', /.+/);
  }
  // Editor de reglas y transportador con su editor.
  await go(page, 'logic');
  await page.locator('[data-act="new"], [data-act="add-rule"]').first().click();
  await expect(page.locator('.modal')).toBeVisible();
  expect(await unlabelled(page), 'botones sin ayuda en el editor de reglas').toEqual([]);
  await expect(page.locator('.modal [data-close]')).toHaveAttribute('title', 'Cerrar (Esc)');
  await page.keyboard.press('Escape');
  await go(page, 'sim');
  await page.locator('[data-mode="plant"]').click();
  await expect(page.locator('.plant3d canvas')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-pl="edit"]').click();
  await expect(page.locator('.plant-editor')).toBeVisible();
  expect(await unlabelled(page), 'botones sin ayuda en el transportador').toEqual([]);
  // Proyectos y papelera.
  await page.locator('.brand').click();
  await expect(page.locator('.table--projects')).toBeVisible();
  expect(await unlabelled(page), 'botones sin ayuda en Proyectos').toEqual([]);
  await page.locator('[data-act="del"]').first().click();
  await modalPrimary(page).click();
  await page.locator('[data-act="trash"]').click();
  await expect(page.locator('.modal [data-purge]')).toBeVisible();
  expect(await unlabelled(page), 'botones sin ayuda en la papelera').toEqual([]);
});

test('foco visible: el mismo anillo en todos los controles al recorrerlos con el teclado', async ({ page }) => {
  await fromTemplate(page, 'transfer');
  for (const s of ['signals', 'logic', 'code'] as Section[]) {
    await go(page, s);
    await noToasts(page);
    const bad: string[] = [];
    let ring = 0;
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const field = el.matches('.input, .searchbox__input');
        const box = el.closest('.searchbox') ?? el;
        return {
          tag: el.outerHTML.slice(0, 90),
          field,
          outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
          color: cs.outlineColor,
          halo: getComputedStyle(box).boxShadow !== 'none',
          dark: !!el.closest('.topbar'),
        };
      });
      if (!r) continue;
      if (r.field) {
        if (!r.halo) bad.push(`campo sin halo: ${r.tag}`);
        continue;
      }
      ring++;
      if (r.outline !== 'solid 2px') bad.push(`sin anillo (${r.outline}): ${r.tag}`);
      // Sobre la barra oscura el anillo es claro; en el resto, el azul del tema.
      const want = r.dark ? 'rgb(156, 198, 238)' : 'rgb(31, 78, 121)';
      if (r.color !== want) bad.push(`color ${r.color}: ${r.tag}`);
    }
    expect(bad, `foco en ${s}`).toEqual([]);
    expect(ring).toBeGreaterThan(10);
  }
});

// ---- Tema oscuro -----------------------------------------------------------

/**
 * Textos visibles con poco contraste sobre su fondo real (se componen los
 * fondos translúcidos de los ancestros). Mínimo WCAG AA: 4.5, o 3 en texto grande.
 */
const lowContrast = (page: Page) =>
  page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA | null => {
      let m = /^rgba?\(([^)]+)\)$/.exec(c);
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p[3] ?? 1];
      }
      m = /^color\(srgb ([^)]+)\)$/.exec(c);
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
      }
      return null;
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (!a) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const background = (el: Element): RGBA | null => {
      let acc: RGBA = [0, 0, 0, 0];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        // Un degradado o una imagen no se pueden evaluar: se toma su color de fondo.
        const bg = parse(cs.backgroundColor);
        if (!bg) return null;
        acc = over(acc, bg);
        if (acc[3] >= 0.999) return acc;
      }
      return over(acc, parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1]);
    };
    const skip = '.plant3d, .plant-plan, [class*="tag3d"], svg, canvas, .sheet-card__preview, [disabled], [hidden], .sr-only, option';
    const out: string[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      const el = node.parentElement!;
      if (el.closest(skip) || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      if (opacity < 0.95) continue;
      const fg = parse(cs.color);
      const bg = background(el);
      if (!fg || !bg) continue;
      const text = over(fg, bg);
      const [a, b] = [lum(text), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        const key = `${el.className}|${cs.color}|${bg.map(Math.round).join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(`${ratio.toFixed(2)} «${node.nodeValue.trim().slice(0, 30)}» <${el.tagName.toLowerCase()} class="${el.className}"> ${cs.color} sobre rgb(${bg.slice(0, 3).map(Math.round).join(',')})`);
      }
    }
    return out;
  });

for (const [label, viewport] of [
  ['escritorio', { width: 1440, height: 900 }],
  ['móvil', MOBILE],
] as const) {
  test(`tema oscuro (${label}): el texto de todas las secciones contrasta con su fondo`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('autosequence_theme', 'dark'));
    await fromTemplate(page, 'acu4');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 21, 27)');
    await noToasts(page);
    const problems: string[] = [];
    const check = async (where: string) => problems.push(...(await lowContrast(page)).map((x) => `${where}: ${x}`));
    for (const s of SECTIONS) {
      await go(page, s);
      await check(s);
    }
    // Pestañas de Código y modos de Simulación.
    await go(page, 'code');
    for (const i of [1, 2]) {
      await page.locator('[data-tab]').nth(i).click();
      await check(`Código, pestaña ${i + 1}`);
    }
    await go(page, 'sim');
    await page.locator('[data-mode="manual"]').click();
    await check('el panel manual');
    // Diálogos: atajos, versiones y alta rápida.
    await go(page, 'signals');
    await page.keyboard.press('?');
    await expect(page.locator('.modal--shortcuts')).toBeVisible();
    await check('Atajos');
    await page.keyboard.press('Escape');
    await page.locator('[data-act="versions"]').click();
    await check('Versiones');
    await page.keyboard.press('Escape');
    await page.locator('[data-quick]').first().click();
    await expect(page.locator('.modal')).toBeVisible();
    await check('el alta rápida');
    await page.keyboard.press('Escape');
    // Avisos y pantalla de proyectos con la confirmación de importar.
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast.is-in')).toBeVisible();
    await check('los avisos');
    await page.locator('.brand').click();
    await expect(page.locator('.table--projects')).toBeVisible();
    await check('Proyectos');
    // Botón de peligro de la confirmación de borrado.
    await page.locator('[data-act="del"]').first().click();
    await expect(page.locator('.modal .btn--danger')).toBeVisible();
    await check('Eliminar proyecto');
    await page.keyboard.press('Escape');
    await page.locator('[data-act="import"]').setInputFiles(
      backupFile([{ name: 'ACU 4 topes', signals: [] }, { name: 'Rota', signals: 'no' }]),
    );
    await expect(page.locator('.import-preview')).toBeVisible();
    await check('Importar');
    expect(problems).toEqual([]);
  });
}
