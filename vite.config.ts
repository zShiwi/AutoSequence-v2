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
    // SINGLE_FILE=1: un único JS (incluida la vista 3D) para empaquetar en un HTML.
    ...(process.env.SINGLE_FILE ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
