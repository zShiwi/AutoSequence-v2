# AutoSequence v2

Herramienta de ingeniería de automatización industrial. Define las señales de
una máquina y sus reglas `SI … ENTONCES …`, simula la secuencia ciclo a ciclo y
genera el programa PLC (**AWL** y **KOP**, STEP 7) y la **documentación A3**
con cajetín normalizado.

Reestructuración del prototipo original (un único `index.html` de ~10.000
líneas) a **Vite + TypeScript** modular, con diseño corporativo, tema claro y
oscuro, y funcionamiento sin conexión (las fuentes van incluidas).

## Flujo de trabajo

| Paso | Sección | Qué hace |
| --- | --- | --- |
| 1 | **Señales** | Sensores, motores, cilindros (con inductivos de posición) y marcas. Validación de nombres en línea; al renombrar una señal se actualizan las reglas que la usan. |
| 2 | **Lógica** | Reglas agrupadas en bloques. Condiciones por nivel (=1 / =0) o flanco (↑ / ↓); acciones SET, RESET o alternar. Reordenar, duplicar, avisos de señales inexistentes. |
| 3 | **Simulación** | Escenario automático, **panel manual** o **transportador** animado. Cronogramas por bloque con la regla que provoca cada cambio. Detecta lógica que oscila. |
| 4 | **Código PLC** | AWL con resaltado, esquema de contactos gráfico y tabla de símbolos (E/A/M). Copiar y descargar `.awl`, `.svg`, `.csv`. |
| 5 | **Documentación** | Portada con índice y una hoja A3 por bloque (tabla de señales, cronograma, cajetín). Imprimir / guardar en PDF o descargar SVG. |

Los proyectos se **guardan automáticamente** en el navegador y se pueden
exportar/importar como `.json`. Los proyectos creados con el prototipo original
siguen apareciendo y se abren sin cambios.

## Modelo de simulación

Replica un ciclo de PLC y es equivalente al AWL generado:

1. Los flancos se detectan al **inicio del ciclo** (memoria de flanco).
2. Las reglas se evalúan en orden; las condiciones de nivel leen el valor vivo.
3. Las acciones son enclavadas (SET/RESET) o alternan.
4. Los inductivos de los cilindros se actualizan al **final del ciclo**
   (activo = cilindro, reposo = inverso), lo que encadena secuencias.

Tras cada cambio externo se ejecutan ciclos hasta que el sistema se estabiliza.

### Transportador

`src/plant/` simula la planta y la acopla al PLC simulado. El lazo son dos
rectas de la longitud indicada y dos curvas; los topes se colocan por línea
(arriba/abajo) y distancia al extremo izquierdo, con sus inductivos y su
presencia en el propio tope, y los sensores de paso de paleta o acumulación
máxima por su distancia a un tope. Las paletas avanzan si el motor está en
marcha, se detienen ante un tope que no esté abierto del todo y se acumulan;
los cilindros tardan su tiempo en abrir; las estaciones (robots) trabajan su
tiempo de ciclo y activan su señal de liberación. Los sensores se calculan de
la posición real y el PLC reacciona con sus reglas.

El transportador es un **lazo vertical**: las paletas van por el ramal de
arriba, bajan por una curva y vuelven colgadas por el de abajo. **Aéreo** (va
alto, se carga por abajo: pre-carga arriba; carga y descarga abajo) o **de
suelo** (va bajo, se carga por arriba). El motor va por defecto en la curva
donde suben las paletas.

La vista 3D (three.js, `src/plant/view3d.ts`, se carga solo al abrirla) muestra
los perfiles con las dos cadenas en movimiento, las ruedas de las curvas, el
motorreductor, las paletas (de pie arriba, colgando abajo), los topes que salen
y se recogen (rojo cerrado, verde abierto) y los sensores con su LED, todos con
su nombre. Las paletas se añaden o quitan en marcha para probar acumulaciones.
Sin tarjeta gráfica arranca en modo ligero y baja la calidad sola si va lenta.

## Correcciones respecto al prototipo

- **AWL**: la lógica estaba invertida (saltaba a «no cumple» cuando la
  condición sí se cumplía) y los flancos no estaban implementados. Ahora se
  genera lógica de bits (`U`/`UN`, `FP`/`FN`, `S`/`R`) con memorias de flanco.
- **Inductivos**: nunca tenían valor en la simulación; ahora siguen al cilindro.
- **Reacciones en cadena**: una acción que provocaba un flanco no se detectaba.
- **Editar regla**: cancelar la edición borraba la regla.
- **Seguridad**: los nombres se insertaban como HTML sin escapar.
- Diálogos nativos (`alert`, `confirm`, `prompt`) sustituidos por avisos y
  ventanas integradas; guardado manual sustituido por autoguardado.

## Estructura

```
src/
  types.ts              Modelo de dominio
  state/store.ts        Estado, autoguardado, import/export
  plc/
    signals.ts          Inductivos derivados, validación, entradas libres
    simulation.ts       Motor por ciclos y escenario automático
    awl.ts              Generador AWL
    kop.ts              Modelo de escalera y KOP en texto
    addresses.ts        Tabla de símbolos y direcciones
  diagram/
    wave.ts             Dibujo de ondas y flechas (común)
    timing.ts           Cronograma en pantalla
    ladder.ts           Esquema de contactos en SVG
    sheet.ts            Hojas A3 con cajetín y portada
  ui/                   Armazón, componentes y una vista por paso
  data/example.ts       Proyecto de ejemplo (estación de transferencia)
  styles.css, fonts.css Sistema de diseño (IBM Plex, tema claro/oscuro)
tests/                  Tests de simulación, código y persistencia
```

## Scripts

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # tests (Vitest)
npm run build      # type-check + build de producción
npm run preview    # sirve la build
```

## Tests

```bash
npm test           # unitarios (Vitest): simulación, AWL/KOP, plantillas, persistencia
npm run test:e2e   # de navegador (Playwright): flujos completos en Chromium
```

Los tests de navegador están en `tests/e2e/*.spec.ts`; compilan la app y la
sirven con `vite preview` (puerto 4173, o `E2E_PORT`). La primera vez hay que
instalar el navegador con `npx playwright install chromium`; si ya hay un
Chromium instalado, se puede usar con `PW_CHROMIUM=/ruta/al/chrome`.

En GitHub, cada push ejecuta los unitarios, la compilación y los tests de
navegador; solo si todo pasa se publica en GitHub Pages. Si fallan los de
navegador, el informe queda como artefacto del workflow.

## Pendiente

- Editor de dibujo libre sobre las hojas (presente en el prototipo).
- Temporizadores (TON/TOF) en las reglas (p. ej. rotura de cadena con t > 2 s).
