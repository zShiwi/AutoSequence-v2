/**
 * Utilidades comunes de las pruebas de navegador.
 *
 * Cada test arranca con un contexto nuevo (localStorage vacío) y falla si la
 * página lanza cualquier error de JavaScript.
 */

import { test as base, expect, type Page } from '@playwright/test';

export type Section = 'signals' | 'logic' | 'sim' | 'code' | 'docs';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'errores de JavaScript en la página').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Crea un proyecto desde una plantilla y espera a la simulación. */
export async function fromTemplate(page: Page, id: 'acu4' | 'transfer'): Promise<void> {
  await page.goto('/');
  await page.locator(`[data-template="${id}"]`).click();
  await expect(page).toHaveURL(/\/sim$/);
}

/** Navega a una sección del proyecto abierto. */
export async function go(page: Page, section: Section): Promise<void> {
  await page.locator(`.steps a[href$="/${section}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${section}$`));
  // El paso se marca como actual después de pintar la vista.
  await expect(page.locator(`.steps a.is-current[href$="/${section}"]`)).toBeVisible();
}

/**
 * Número de reglas del bloque visible. Espera a que la lista esté pintada:
 * `count()` no espera y, justo tras navegar, la vista aún puede no existir.
 */
export async function ruleCount(page: Page): Promise<number> {
  await expect(page.locator('.rule').first()).toBeVisible();
  return page.locator('.rule').count();
}

/** Botón principal del último diálogo abierto. */
export function modalPrimary(page: Page) {
  return page.locator('.modal').last().locator('.modal__foot .btn--primary, .modal__foot .btn--danger');
}

/** Elige una opción de un <select> por su texto visible o valor. */
export async function pick(page: Page, selector: string, value: string, nth = 0): Promise<void> {
  await page.locator(selector).nth(nth).selectOption(value);
}
