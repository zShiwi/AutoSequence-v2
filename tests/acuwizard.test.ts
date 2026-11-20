import { describe, expect, it } from 'vitest';
import { buildAcu, clampStops, MAX_STOPS } from '../src/data/acuwizard';
import { acu4Blocks, motorBlock } from '../src/data/acu4';
import { allSignalNames, cleanSignals } from '../src/plc/signals';
import { generateAWL } from '../src/plc/awl';
import { validateLayout } from '../src/plant/layout';

describe('asistente de ACU', () => {
  it('crea el motor con sus tres señales y la secuencia de siempre', () => {
    const p = buildAcu({ kind: 'aereo', stops: 4 });
    const names = p.signals.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['M01', 'PX21', 'PX22', 'PX23', 'RESET_FALLOS', 'CYCLE_START']));
    expect(p.blocks[0].name).toBe('Seguridad motor');
    expect(p.blocks[0].rules.map((r) => r.name)).toEqual(motorBlock().rules.map((r) => r.name));
    // La plantilla ACU 4 topes sigue usando la misma secuencia.
    expect(acu4Blocks()[0].rules.map((r) => r.name)).toEqual(motorBlock().rules.map((r) => r.name));
  });

  it('crea un cilindro por tope con sus inductivos y nada más', () => {
    const p = buildAcu({ kind: 'suelo', stops: 6 });
    const cyl = p.signals.filter((s) => s.type === 'Cilindro');
    expect(cyl.map((c) => c.name)).toEqual(['C01', 'C02', 'C03', 'C04', 'C05', 'C06']);
    expect(cyl[2]).toMatchObject({ inductivoActivo: 'C03PX2', inductivoReposo: 'C03PX1' });
    // Presencia, paso de paleta y acumulación los añade el usuario.
    expect(p.signals.filter((s) => s.type === 'Sensor').map((s) => s.name)).toEqual([
      'PX21',
      'PX22',
      'PX23',
      'RESET_FALLOS',
      'CYCLE_START',
    ]);
    const all = allSignalNames(cleanSignals(p.signals));
    expect(all).toContain('C06PX1');
  });

  it('el transportador es del tipo elegido, con un tope por cilindro y sin errores', () => {
    for (const kind of ['aereo', 'suelo'] as const) {
      const p = buildAcu({ kind, stops: 5 });
      expect(p.layout.kind).toBe(kind);
      expect(p.layout.motor).toBe('M01');
      expect(p.layout.stops).toHaveLength(5);
      expect(validateLayout(p.layout, p.signals).filter((i) => i.level === 'error')).toEqual([]);
      expect(p.cajetin.installType).toBe(kind === 'suelo' ? 'De suelo' : 'Aéreo');
    }
  });

  it('genera AWL desde el primer momento', () => {
    const p = buildAcu({ kind: 'aereo', stops: 3 });
    const awl = generateAWL(p.blocks, { projectName: 'x', signals: cleanSignals(p.signals) });
    expect(awl).toContain('M01');
  });

  it('limita el número de topes', () => {
    expect(clampStops(0)).toBe(1);
    expect(clampStops(999)).toBe(MAX_STOPS);
    expect(clampStops(Number.NaN)).toBe(4);
    expect(clampStops(3.6)).toBe(4);
  });
});
