import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rutas relativas: la app funciona servida en una subcarpeta
  // (GitHub Pages: https://<usuario>.github.io/AutoSequence-v2/) o abierta
  // desde cualquier servidor.
  base: './',
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
