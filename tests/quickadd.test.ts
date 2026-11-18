import { describe, expect, it } from 'vitest';
import { acu4Signals } from '../src/data/acu4';
import { defaultLayout } from '../src/plant/layout';
import {
  buildStop,
  derivedSignals,
  nextFreeName,
  presenceOwner,
  proposeStop,
  stopDraftErrors,
  takenNames,
} from '../src/plc/signals';
import type { Signal } from '../src/types';

describe('Alta rápida de topes', () => {
  const acu = acu4Signals();

  it('propone el primer cilindro y la primera presencia libres', () => {
    const d = proposeStop(acu);
    expect(d.name).toBe('C05');
    expect(d.activo).toBe('C05PX2');
    expect(d.reposo).toBe('C05PX1');
    expect(d.presence).toBe('PX09');
    expect(d.presenceDescription).toBe('Paleta en tope C05');
    expect(stopDraftErrors(d, acu)).toEqual({});
  });

  it('en un proyecto vacío empieza por C01 y PX01', () => {
    const d = proposeStop([]);
    expect([d.name, d.presence]).toEqual(['C01', 'PX01']);
  });

  it('crea el cilindro con sus inductivos y el sensor de presencia enlazado', () => {
    const made = buildStop({ ...proposeStop(acu), description: 'Tope de inspección' });
    expect(made).toHaveLength(2);
    const [px, cyl] = made;
    expect(px).toEqual({ name: 'PX09', type: 'Sensor', initial: 0, description: 'Paleta en tope C05' });
    expect(cyl).toMatchObject({
      name: 'C05',
      type: 'Cilindro',
      description: 'Tope de inspección',
      inductivoActivo: 'C05PX2',
      inductivoReposo: 'C05PX1',
      presence: 'PX09',
    });
    const all = [...acu, ...made];
    expect(derivedSignals(all).map((d) => d.name)).toEqual(expect.arrayContaining(['C05PX2', 'C05PX1']));
    expect(presenceOwner(all, 'PX09')?.name).toBe('C05');
  });

  it('sin presencia solo crea el cilindro', () => {
    const made = buildStop({ ...proposeStop(acu), presence: '' });
    expect(made).toHaveLength(1);
    expect(made[0].presence).toBeUndefined();
  });

  it('detecta nombres repetidos, inductivos ocupados e inválidos', () => {
    const d = { ...proposeStop(acu), name: 'C01', activo: 'C02PX1', presence: 'PX 9' };
    const e = stopDraftErrors(d, acu);
    expect(e.name).toMatch(/ya existe/);
    expect(e.activo).toMatch(/ya existe/);
    expect(e.presence).toMatch(/sin espacios/);
    const dup = stopDraftErrors({ ...proposeStop(acu), presence: 'C05' }, acu);
    expect(dup.presence).toMatch(/se repite/);
  });

  it('nextFreeName rellena huecos y cuenta los inductivos como ocupados', () => {
    const taken = takenNames([{ name: 'C01', type: 'Cilindro', initial: 0, description: '', inductivoActivo: 'PX01' }]);
    expect(nextFreeName('C', taken)).toBe('C02');
    expect(nextFreeName('PX', taken)).toBe('PX02');
  });
});

describe('Transportador automático con la presencia enlazada', () => {
  it('cada tope de la plantilla ACU lleva su presencia', () => {
    const stops = defaultLayout(acu4Signals()).stops;
    expect(Object.fromEntries(stops.map((s) => [s.cylinder, s.presence]))).toEqual({
      C01: 'PX01',
      C02: 'PX02',
      C03: 'PX05',
      C04: 'PX06',
    });
  });

  it('una presencia que no es un sensor existente se ignora', () => {
    const signals: Signal[] = [{ name: 'C01', type: 'Cilindro', initial: 0, description: '', presence: 'NOPE' }];
    expect(defaultLayout(signals).stops[0].presence).toBeUndefined();
  });
});
