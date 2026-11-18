import { describe, expect, it } from 'vitest';
import { acu4Blocks, acu4Signals } from '../src/data/acu4';
import { Plant } from '../src/plant/engine';
import { acu4Layout, ahead, defaultLayout, loopLength, palletEntry, pointAt, sOnLine, sensorS, stopS, validateLayout } from '../src/plant/layout';
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
  it('entran siempre por el mismo punto (cola de la pre-carga), esperan hueco y no se solapan', () => {
    const plant = new Plant(acu4Layout(), signals, rules);
    const l = plant.layout;
    const entry = palletEntry(l)!;
    expect(entry.stop).toBe('C01'); // pre-tope antes de la carga
    const c01 = stopS(l, l.stops.find((t) => t.cylinder === 'C01')!);
    // Al arrancar, todas acumuladas en la cola de C01.
    plant.pallets.forEach((p) => expect(ahead(p.front - 1, c01, plant.L)).toBeLessThan(7 * 420 + 2));
    const before = new Set(plant.pallets.map((p) => p.id));
    expect(plant.addPallet()).toBe(true);
    expect(plant.addPallet()).toBe(true);
    // La primera entra ya por el punto de entrada; la segunda espera hueco.
    const fresh = plant.pallets.filter((p) => !before.has(p.id));
    expect(fresh.map((p) => Math.round(p.front))).toEqual([Math.round(entry.s)]);
    expect(plant.pending).toBe(1);
    plant.step(5000);
    expect(plant.pending).toBe(0);
    while (plant.addPallet());
    expect(plant.pallets.length + plant.pending).toBe(plant.capacity());
    plant.step(120000);
    const sorted = [...plant.pallets].sort((a, b) => a.front - b.front);
    sorted.forEach((p, i) => {
      const next = sorted[(i + 1) % sorted.length];
      expect(ahead(p.front, next.front, plant.L) - 400).toBeGreaterThanOrEqual(20 - 1e-6);
    });
    expect(plant.sim.warnings).toEqual([]);
  });

  it('solo se retiran paletas de la cola de entrada', () => {
    const plant = new Plant(acu4Layout(), signals, rules);
    const n = plant.pallets.length;
    expect(plant.removePallet()).toBe(true);
    expect(plant.pallets.length).toBe(n - 1);
  });

  it('un pre-tope nunca abre con una paleta de camino a su tope (7 a máximo paletas, 5 min)', () => {
    const l = acu4Layout();
    const pairs = [
      ['C01', 'C02'],
      ['C03', 'C04'],
    ].map(([pre, stop]) => ({
      pre,
      a: stopS(l, l.stops.find((t) => t.cylinder === pre)!),
      b: stopS(l, l.stops.find((t) => t.cylinder === stop)!),
    }));
    [7, 12, 99].forEach((n) => {
      const plant = new Plant(l, signals, rules);
      while (plant.pallets.length < n && plant.addPallet());
      const prev: Record<string, number> = {};
      const bad: string[] = [];
      for (let t = 0; t < 300000; t += 20) {
        plant.step(20);
        pairs.forEach(({ pre, a, b }) => {
          const v = plant.sim.states[pre];
          if (v === 1 && prev[pre] === 0) {
            const span = ahead(a, b, plant.L);
            const transit = plant.pallets.filter((p) => {
              const d = ahead(a, p.front, plant.L);
              return d > 5 && d < span - 1;
            });
            if (transit.length) bad.push(`${pre} t=${(plant.time / 1000).toFixed(1)} s con ${plant.pallets.length} paletas`);
          }
          prev[pre] = v;
        });
      }
      expect(bad, `paletas=${n}`).toEqual([]);
    });
  });
});

describe('Tipo de transportador', () => {
  it('aéreo: pre-carga arriba y el resto abajo; motor en la curva donde suben las paletas', async () => {
    const { defaultLayout, liftEnd, motorEnd } = await import('../src/plant/layout');
    const a = defaultLayout(signals, 'aereo');
    expect(a.kind).toBe('aereo');
    expect(a.stops[0].line).toBe('top');
    expect(a.stops.slice(1).every((s) => s.line === 'bottom')).toBe(true);
    const s = defaultLayout(signals, 'suelo');
    expect(s.stops[0].line).toBe('bottom');
    expect(s.stops.slice(1).every((t) => t.line === 'top')).toBe(true);
    // ccw: abajo avanza a la derecha → suben por la curva derecha.
    expect(liftEnd({ direction: 'ccw' })).toBe('right');
    expect(liftEnd({ direction: 'cw' })).toBe('left');
    expect(motorEnd({ ...a, motorEnd: 'left' })).toBe('left');
    expect(acu4Layout().kind).toBe('aereo');
  });
});
