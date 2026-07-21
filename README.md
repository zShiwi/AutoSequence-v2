# AutoSequence v2

Herramienta de ingeniería de automatización industrial (PLC). Permite definir
las señales de un sistema, construir reglas de automatización `SI (condiciones)
→ ENTONCES (acciones)` agrupadas en bloques, simular el comportamiento temporal
y generar código **AWL** (STEP 7 / lista de instrucciones Siemens) y **KOP**
(diagrama de contactos / Ladder).

Esta es una reestructuración del prototipo original, que vivía en un único
`index.html` de ~10.000 líneas, hacia un proyecto **Vite + TypeScript** con
módulos separados por dominio.

## Flujo de la aplicación

1. **Selector de proyecto** — crear/abrir/borrar proyectos (persistidos en
   `localStorage`).
2. **Paso 1 · Señales** — definir señales (Sensor, Motor, Cilindro, Virtual),
   su estado inicial, descripción e inductivos para cilindros.
3. **Paso 2 · Reglas** — constructor de reglas con condiciones (flancos y
   estados) y acciones (1 / 0 / alternar), organizadas en bloques.
4. **Paso 3 · Simulación** — ejecutar la simulación temporal, ver el cronograma
   de ondas y generar el código AWL y KOP.

## Estructura

```
src/
  types.ts            Modelo de dominio tipado (Signal, Rule, Block, ...)
  state/store.ts      Estado global + persistencia en localStorage
  plc/
    simulation.ts     Motor de simulación (funciones puras)
    awl.ts            Generación de código AWL
    kop.ts            Generación de código KOP (Ladder)
  diagram/timing.ts   Cronograma temporal en SVG
  data/example.ts     Ejemplo industrial precargado
  ui/
    app.ts            Controlador y navegación
    projects.ts       Selector de proyectos
    signals.ts        Paso 1
    rules.ts          Paso 2
    simulation.ts     Paso 3
    dom.ts            Helpers de DOM
  main.ts             Punto de entrada
  styles.css          Estilos (paleta original conservada)
```

## Scripts

```bash
npm install
npm run dev        # servidor de desarrollo
npm run build      # type-check + build de producción
npm run preview    # sirve la build de producción
npm run typecheck  # solo comprobación de tipos
```

## Alcance de esta fase

Se ha migrado el **núcleo**: proyectos, señales, reglas/bloques, simulación,
cronograma temporal y generación AWL/KOP, conservando la lógica del prototipo.

Pendiente para una segunda fase (presente en el prototipo original):

- Plantilla industrial normalizada con cajetín (Page name, Designer,
  Installation `=`, Location `+`, ...).
- Editor de dibujo SVG (formas, líneas/flechas, pincel, texto, imágenes).
- Exportación a PDF multipágina.
