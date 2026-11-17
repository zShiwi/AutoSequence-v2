import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Fuentes e iconos se incrustan en el CSS: la app funciona sin red
    // (equipos de planta) y se puede empaquetar en un único HTML.
    assetsInlineLimit: 1024 * 1024,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
