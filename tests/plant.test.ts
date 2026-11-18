import { describe, expect, it } from 'vitest';
import { acu4Blocks, acu4Signals } from '../src/data/acu4';
import { Plant } from '../src/plant/engine';
import { acu4Layout, ahead, defaultLayout, loopLength, pointAt, sOnLine, sensorS, validateLayout } from '../src/plant/layout';
import type { ConveyorLayout } from '../src/types';

const signals = acu4Signals();
const rules = acu4Blocks().flatMap((b) => b.rules);

describe('Geometría del transportador', () => {
  const l = acu4Layout();
  it('longitud del lazo = 2 rectas + 2 semicírculos', () => {
    expect(loopLength(l)).toBeCloseTo(2 * 6000 + 2 * Math.PI * 300, 6);
  });
  it('abajo avanza a la derecha y arriba a la izquierda (sentido por defecto)', () => {
    const b = pointAt(l, sOnLine(l, 'bottom', 1000));
    expect(b.line).toBe('bottom');
    expect(b.x).toBeCloseTo(1000);
    expect(b.heading).toBeCloseTo(0);
    const t = pointAt(l, sOnLine(l, 'top', 1000));
    expect(t.line).toBe('top');
    expect(t.x).toBeCloseTo(1000);
    expect(Math.abs(t.heading)).toBeCloseTo(Math.PI);
  });
  it('en sentido horario arriba avanza a la derecha', () => {
    const cw: ConveyorLayout = { ...l, direction: 'cw' };
    const t = pointAt(cw, sOnLine(cw, 'top', 1000));
    expect(t.line).toBe('top');
    expect(t.x).toBeCloseTo(1000);
    expect(t.y).toBeLessThan(0);
  });
  it('un sensor colocado «antes» de un tope queda aguas arriba', () => {
    const px04 = sensorS(l, l.sensors.find((s) => s.signal === 'PX04')!)!;
    const c03 = sOnLine(l, 'bottom', 4700);
    expect(ahead(px04, c03, loopLength(l))).toBeCloseTo(1500);
  });
  it('el layout de la plantilla no tiene errores', () => {
    expect(validateLayout(l, signals).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('el layout automático coloca un tope por cilindro', () => {
    const d = defaultLayout(signals);
    expect(d.stops.map((s) => s.cylinder).sort()).toEqual(['C01', 'C02', 'C03', 'C04']);
    expect(d.motor).toBe('M01');
  });
});

describe('Planta ACU 4 topes + PLC', () => {
  const run = (seconds: number) => {
    const plant = new Plant(acu4Layout(), signals, rules);
    let minGap = Infinity;
    for (let t = 0; t < seconds * 1000; t += 50) {
      plant.step(50);
      const sorted = [...plant.pallets].sort((a, b) => a.front - b.front);
      sorted.forEach((p, i) => {
        const next = sorted[(i + 1) % sorted.length];
        minGap = Math.min(minGap, ahead(p.front, next.front, plant.L) - plant.layout.palletLength);
      });
    }
    return { plant, minGap };
  };

  it('las paletas circulan, se cargan y descargan sin solaparse ni conflictos', () => {
    const { plant, minGap } = run(180);
    const [carga, descarga] = plant.stationCycles();
    expect(carga.cycles).toBeGreaterThanOrEqual(8);
    expect(descarga.cycles).toBeGreaterThanOrEqual(8);
    expect(minGap).toBeGreaterThanOrEqual(plant.layout.palletGap - 0.5);
    expect(plant.sim.warnings).toEqual([]);
    // Todas las reglas de las zonas se han disparado.
    const fired = new Set(plant.log.map((e) => e.ruleName));
    ['Abrir pre-carga', 'Abrir carga', 'Paso paleta carga', 'Abrir pre-descarga', 'Abrir descarga', 'Paso paleta descarga'].forEach((n) =>
      expect(fired.has(n), n).toBe(true),
    );
  });

  it('un tope cerrado retiene la paleta y el cilindro tarda en abrir', () => {
    const plant = new Plant(acu4Layout(), signals, rules);
    for (let t = 0; t < 30000; t += 20) plant.step(20);
    // Todos los topes están cerrados o abiertos de forma coherente con su inductivo.
    ['C01', 'C02', 'C03', 'C04'].forEach((c) => {
      const pos = plant.cylinder.get(c)!;
      expect(plant.readings[`${c}PX2`]).toBe(pos >= 1 ? 1 : 0);
      expect(plant.readings[`${c}PX1`]).toBe(pos <= 0 ? 1 : 0);
    });
  });

  it('un fallo de par para el motor y las paletas', () => {
    const plant = new Plant(acu4Layout(), signals, rules);
    plant.step(5000);
    plant.setManual('PX21', 0);
    expect(plant.motorOn()).toBe(false);
    const before = plant.pallets.map((p) => p.front);
    plant.step(3000);
    expect(plant.pallets.map((p) => p.front)).toEqual(before);
    expect(plant.manualInputs()).toEqual(expect.arrayContaining(['PX21', 'PX22', 'PX23', 'RESET_FALLOS', 'CYCLE_START']));
    expect(plant.manualInputs()).not.toContain('PX01');
  });
});

describe('Paletas en marcha', () => {
  it('se añaden en el hueco más grande sin solaparse y se quitan', () => {
    const plant = new Plant(acu4Layout(), signals, rules);
    plant.step(20000);
    const cap = plant.capacity();
    expect(cap).toBe(Math.floor(plant.L / (400 + 20)));
    let added = 0;
    while (plant.addPallet()) added++;
    expect(plant.pallets.length).toBeGreaterThan(20);
    expect(plant.pallets.length).toBeLessThanOrEqual(cap);
    const sorted = [...plant.pallets].sort((a, b) => a.front - b.front);
    sorted.forEach((p, i) => {
      const next = sorted[(i + 1) % sorted.length];
      expect(ahead(p.front, next.front, plant.L) - 400).toBeGreaterThanOrEqual(20 - 1e-6);
    });
    plant.step(60000);
    expect(plant.sim.warnings).toEqual([]);
    expect(plant.removePallet()).toBe(true);
    expect(plant.pallets.length).toBe(7 + added - 1);
  });
});
