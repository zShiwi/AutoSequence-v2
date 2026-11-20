import { describe, expect, it } from 'vitest';
import { acu4Blocks, acu4Signals } from '../src/data/acu4';
import { Plant, waitText, waitsOnOthers, type WaitGroup } from '../src/plant/engine';
import { acu4Layout, layoutCapacity, loopLength, validateLayout } from '../src/plant/layout';
import { placeTags, type TagBox } from '../src/plant/view3d';
import { renderTimingDiagram, renderTimingSplit } from '../src/diagram/timing';
import type { Condition, ConveyorLayout, Rule, Signal, SimStep } from '../src/types';

describe('Por qué no abre un tope: grupos «O»', () => {
  const sensor = (name: string, initial: 0 | 1 = 0): Signal => ({ name, type: 'Sensor', initial, description: '' });
  const signals: Signal[] = [
    { name: 'C1', type: 'Cilindro', initial: 0, description: 'Tope' },
    sensor('PXP'),
    sensor('ROBOT_OK'),
    sensor('PX09'),
    sensor('PX10', 1),
  ];
  const c = (signal: string, event: Condition['event'], operator: Condition['operator'] = 'AND'): Condition => ({ signal, event, delay: 0, operator });
  // SI PXP = 1 Y (ROBOT_OK = 1 O PX09 = 1) Y PX10 = 0 ENTONCES abre C1.
  const rules: Rule[] = [
    {
      id: 1,
      name: 'Abrir tope',
      conditions: [c('PXP', '==1'), c('ROBOT_OK', '==1'), c('PX09', '==1', 'OR'), c('PX10', '==0')],
      actions: [{ signal: 'C1', value: '1' }],
    },
  ];
  const layout = (): ConveyorLayout => ({
    length: 3000,
    radius: 300,
    direction: 'ccw',
    palletLength: 400,
    palletGap: 20,
    speed: 250,
    pallets: 1,
    stops: [{ cylinder: 'C1', presence: 'PXP', line: 'bottom', x: 1500, travelMs: 300 }],
    sensors: [],
    stations: [{ stop: 'C1', label: 'Robot', action: 'load', release: 'ROBOT_OK', okSensors: [], nokSensors: [], cycleMs: 3000 }],
  });

  it('waitingStops devuelve las condiciones agrupadas, no un texto', () => {
    const plant = new Plant(layout(), signals, rules);
    plant.step(200);
    const [w] = plant.waitingStops();
    expect(w.cylinder).toBe('C1');
    expect(w.missing).toEqual([
      [
        { signal: 'ROBOT_OK', value: 1 },
        { signal: 'PX09', value: 1 },
      ],
      [{ signal: 'PX10', value: 0 }],
    ]);
    expect(waitText(w.missing)).toBe('(ROBOT_OK = 1 o PX09 = 1), PX10 = 0');
  });

  it('mientras el robot trabaja, un grupo «O» con una señal ajena no se oculta', () => {
    const plant = new Plant(layout(), signals, rules);
    plant.step(200);
    expect(plant.stationProgress('C1')!.progress).toBeLessThan(1);
    const own = plant.stationSignals('C1');
    expect([...own]).toEqual(['ROBOT_OK']);
    // PX09 no es del robot: el grupo entero sigue contando como espera.
    expect(waitText(waitsOnOthers(plant.waitingStops()[0].missing, own))).toBe('(ROBOT_OK = 1 o PX09 = 1), PX10 = 0');
    // Lo que depende solo del robot sí se calla mientras trabaja.
    const soloRobot: WaitGroup[] = [[{ signal: 'ROBOT_OK', value: 1 }], [{ signal: 'PX10', value: 0 }]];
    expect(waitText(waitsOnOthers(soloRobot, own))).toBe('PX10 = 0');
  });

  it('una alternativa cumplida basta: el grupo deja de faltar y el tope abre al cumplirse el resto', () => {
    const plant = new Plant(layout(), signals, rules);
    plant.step(200);
    plant.setManual('PX09', 1);
    expect(waitText(plant.waitingStops()[0].missing)).toBe('PX10 = 0');
    plant.setManual('PX10', 0);
    expect(plant.waitingStops()).toEqual([]);
    expect(plant.sim.states.C1).toBe(1);
  });

  it('un grupo «O» solo no lleva paréntesis', () => {
    expect(
      waitText([
        [
          { signal: 'A', value: 1 },
          { signal: 'B', value: 0 },
        ],
      ]),
    ).toBe('A = 1 o B = 0');
  });
});

describe('Capacidad de paletas: la misma al validar y al simular', () => {
  const signals = acu4Signals();
  const rules = acu4Blocks().flatMap((b) => b.rules);
  const pallets = (l: ConveyorLayout) => validateLayout(l, signals).filter((i) => i.field === 'pallets');

  it('validateLayout usa la capacidad de la planta, no la del lazo entero', () => {
    const l = acu4Layout();
    const cap = new Plant(l, signals, rules).capacity();
    expect(layoutCapacity(l)).toBe(cap);
    const whole = Math.floor(loopLength(l) / (l.palletLength + l.palletGap));
    expect(cap).toBeLessThan(whole);
    expect(pallets({ ...l, pallets: cap })).toEqual([]);
    // Entre las dos capacidades antes no se avisaba y la planta arrancaba con menos.
    const over = pallets({ ...l, pallets: cap + 3 });
    expect(over).toHaveLength(1);
    expect(over[0].level).toBe('warn');
    expect(over[0].text).toContain(`Hay ${cap + 3} paletas configuradas y solo caben ${cap}`);
    expect(over[0].text).toContain('Las 3 que sobran no entrarán');
  });

  it('con más paletas de las que caben la planta arranca con las que caben', () => {
    const l = { ...acu4Layout(), pallets: 25 };
    expect(validateLayout(l, signals).filter((i) => i.level === 'error')).toEqual([]);
    const plant = new Plant(l, signals, rules);
    expect(plant.pallets.length + plant.pending).toBe(plant.capacity());
  });

  it('sin topes la capacidad es la del lazo entero y el aviso lo dice', () => {
    const l: ConveyorLayout = { ...acu4Layout(), stops: [], sensors: [], stations: [] };
    const cap = Math.floor(loopLength(l) / 420);
    expect(layoutCapacity(l)).toBe(cap);
    const [over] = pallets({ ...l, pallets: cap + 1 });
    expect(over.text).toContain(`solo caben ${cap} en ${Math.round(loopLength(l))} mm de lazo`);
    expect(over.text).toContain('La que sobra no entrará');
  });
});

describe('Vista 3D: etiquetas de paleta', () => {
  const box = (x: number, y: number, w = 120, h = 40): TagBox => ({ x, y, w, h, dx: 0, dy: 0, visible: true });
  const pallet = (x: number, y: number): TagBox => ({ ...box(x, y, 22, 14), optional: true });

  it('una etiqueta de paleta bajo la de un tope se oculta en vez de quedar tapada; el tope no se mueve', () => {
    const stop = box(300, 200);
    const under = pallet(310, 205);
    const clear = pallet(500, 205);
    placeTags([stop, under, clear], 1000, 600);
    expect([stop.dx, stop.dy]).toEqual([0, 0]);
    expect(under.crowded).toBe(true);
    expect(clear.crowded).toBe(false);
    expect([clear.dx, clear.dy]).toEqual([0, 0]);
  });

  it('en una cola apretada (móvil) solo se muestran las que caben, sin pisarse', () => {
    // Siete paletas cada 19 px con etiquetas de 22 px.
    const queue = Array.from({ length: 7 }, (_, i) => pallet(100 + i * 19, 300));
    placeTags(queue, 390, 600);
    const shown = queue.filter((b) => !b.crowded);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThan(7);
    shown.forEach((a, i) => shown.slice(i + 1).forEach((b) => expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(22)));
    // Con sitio de sobra (escritorio) salen todas.
    const wide = Array.from({ length: 7 }, (_, i) => pallet(100 + i * 58, 300));
    placeTags(wide, 1000, 600);
    expect(wide.every((b) => b.crowded === false)).toBe(true);
  });

  it('no parpadea: la que se ve sigue viéndose mientras no la pisen', () => {
    const a = pallet(100, 300);
    const b = pallet(124, 300); // 2 px de hueco: no basta para aparecer…
    placeTags([a, b], 390, 600);
    expect(b.crowded).toBe(true);
    b.x = 126;
    placeTags([a, b], 390, 600);
    expect(b.crowded).toBe(false);
    b.x = 123; // …pero sí para seguir, mientras no se toquen.
    placeTags([a, b], 390, 600);
    expect(b.crowded).toBe(false);
    b.x = 118;
    placeTags([a, b], 390, 600);
    expect(b.crowded).toBe(true);
  });
});

describe('Cronograma con la columna de nombres fija', () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ time: i, states: { M01: i % 2, PX21: 1 }, previousStates: {}, events: [], activations: [] })) as unknown as SimStep[];
  const rows = [
    { name: 'M01', kind: 'out' as const },
    { name: 'PX21', kind: 'in' as const },
  ];
  const svgs = (html: string) =>
    [...html.matchAll(/<svg class="([^"]+)"[^>]*? width="(\d+)" height="(\d+)"[\s\S]*?<\/svg>/g)].map((m) => ({ cls: m[1], w: Number(m[2]), h: Number(m[3]), html: m[0] }));

  it('se parte en dos SVG de la misma altura: nombres y ondas', () => {
    const [names, waves] = svgs(renderTimingSplit(rows, history, { stepW: 40 }));
    expect(names.cls).toBe('timing-names');
    expect(waves.cls).toContain('timing-svg--waves');
    expect(names.h).toBe(waves.h);
    expect(names.w).toBe(188);
    expect(waves.w).toBeGreaterThanOrEqual(30 * 40);
    // Cada mitad lleva solo lo suyo.
    expect(names.html).toContain('>M01<');
    expect(names.html).toContain('>PX21<');
    expect(names.html).not.toContain('<path');
    expect(waves.html).toContain('<path');
    expect(waves.html).not.toContain('SEÑAL');
    expect(waves.html).not.toContain('>M01<');
  });

  it('en compacto la columna fija es estrecha y el ancho se publica para el CSS', () => {
    const html = renderTimingSplit(rows, history, { stepW: 40, compact: true });
    const [names] = svgs(html);
    expect(names.w).toBeLessThan(110);
    expect(html).toContain(`--td-names-w:${names.w}px`);
    expect(html).toContain('timing--compact');
  });

  it('la descarga sigue siendo un único SVG con nombres y ondas', () => {
    const whole = svgs(renderTimingDiagram(rows, history, { stepW: 40 }));
    expect(whole).toHaveLength(1);
    expect(whole[0].html).toContain('>M01<');
    expect(whole[0].html).toContain('<path');
    const [names, waves] = svgs(renderTimingSplit(rows, history, { stepW: 40 }));
    expect(whole[0].h).toBe(names.h);
    expect(whole[0].w).toBe(names.w + waves.w - 8);
  });
});
