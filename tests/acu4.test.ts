import { describe, expect, it } from 'vitest';
import { acu4Blocks, acu4Signals } from '../src/data/acu4';
import { Simulator, runAutoScenario } from '../src/plc/simulation';
import { allSignalNames, cleanSignals } from '../src/plc/signals';
import type { SignalLevel } from '../src/types';

const signals = acu4Signals();
const blocks = acu4Blocks();
const rules = blocks.flatMap((b) => b.rules);

const set = (sim: Simulator, pairs: Record<string, SignalLevel>) =>
  sim.apply(Object.entries(pairs).map(([signal, value]) => ({ signal, value })));

describe('Plantilla ACU 4 topes', () => {
  it('todas las señales son válidas y todas las reglas usan señales existentes', () => {
    expect(cleanSignals(signals)).toHaveLength(signals.length);
    const known = new Set(allSignalNames(signals));
    rules.forEach((r) => {
      r.conditions.forEach((c) => expect(known.has(c.signal), `${r.name}: ${c.signal}`).toBe(true));
      r.actions.forEach((a) => expect(known.has(a.signal), `${r.name}: ${a.signal}`).toBe(true));
    });
    expect(blocks.map((b) => b.name)).toEqual(['Seguridad motor', 'Zona de carga', 'Zona de descarga']);
  });

  it('cada tope depende de que el siguiente esté en reposo (lazo cerrado)', () => {
    const open = (n: string) => rules.find((r) => r.name === n)!.conditions.map((c) => c.signal);
    expect(open('Abrir pre-carga')).toContain('C02PX1');
    expect(open('Abrir carga')).toContain('C03PX1');
    expect(open('Abrir pre-descarga')).toContain('C04PX1');
    expect(open('Abrir descarga')).toContain('C01PX1');
  });

  it('el escenario automático de cada bloque ejercita todas sus reglas sin conflictos', () => {
    blocks.forEach((b) => {
      const sim = runAutoScenario(signals, b.rules, 16);
      const fired = new Set(sim.history.flatMap((h) => h.activations.map((a) => a.ruleName)));
      b.rules.forEach((r) => expect(fired.has(r.name), `${b.name}: ${r.name}`).toBe(true));
      expect(sim.warnings, b.name).toEqual([]);
    });
  });

  it('ciclo completo de carga: pre-carga → carga → paso paleta', () => {
    const sim = new Simulator(signals, rules);
    set(sim, { PX01: 1 });
    expect(sim.states.C01).toBe(1); // abre pre-carga
    expect(sim.states.SM_C01).toBe(1); // tránsito activo
    set(sim, { PX01: 0 });
    expect(sim.states.C01).toBe(0); // la paleta sale: cierra
    set(sim, { PX01: 1 });
    expect(sim.states.C01).toBe(0); // segunda paleta retenida por el tránsito
    set(sim, { PX02: 1, PPE01: 1, ROBOT_CARGA_OK: 1 });
    expect(sim.states.C02).toBe(1); // abre carga
    set(sim, { PX02: 0 });
    expect(sim.states.C02).toBe(0);
    const steps = set(sim, { PX03: 1 });
    // El paso de paleta reinicia ambos tránsitos…
    const reset = steps[0].activations.filter((a) => a.ruleName === 'Paso paleta carga');
    expect(reset.map((a) => `${a.targetSignal}=${a.toValue}`).sort()).toEqual(['SM_C01=0', 'SM_C02=0']);
    expect(sim.states.SM_C02).toBe(0);
    // …y la segunda paleta, que esperaba en PX01, se libera en el ciclo siguiente.
    expect(sim.states.C01).toBe(1);
    expect(sim.states.SM_C01).toBe(1);
  });

  it('con máxima acumulación el tope de carga no abre', () => {
    const sim = new Simulator(signals, rules);
    set(sim, { PX04: 1, PX02: 1, PPE01: 1, ROBOT_CARGA_OK: 1 });
    expect(sim.states.C02).toBe(0);
    set(sim, { PX04: 0 });
    expect(sim.states.C02).toBe(1);
  });

  it('sin pieza correcta o sin robot el tope de carga no abre', () => {
    const sim = new Simulator(signals, rules);
    set(sim, { PX02: 1, PPE01: 1, PPE02: 1, ROBOT_CARGA_OK: 1 });
    expect(sim.states.C02).toBe(0);
    set(sim, { PPE02: 0, ROBOT_CARGA_OK: 0 });
    expect(sim.states.C02).toBe(0);
    set(sim, { ROBOT_CARGA_OK: 1 });
    expect(sim.states.C02).toBe(1);
  });

  it('fallo de par para el motor; reset y Cycle Start lo rearrancan', () => {
    const sim = new Simulator(signals, rules);
    expect(sim.states.M01).toBe(1);
    set(sim, { PX21: 0 });
    expect(sim.states.M01).toBe(0);
    expect(sim.states.AL_PAR).toBe(1);
    set(sim, { CYCLE_START: 1 });
    expect(sim.states.M01).toBe(0); // no arranca con la alarma activa
    set(sim, { CYCLE_START: 0, PX21: 1 });
    set(sim, { RESET_FALLOS: 1 });
    expect(sim.states.AL_PAR).toBe(0);
    set(sim, { CYCLE_START: 1 });
    expect(sim.states.M01).toBe(1);
  });

  it('la cadena alargada solo avisa: el motor sigue', () => {
    const sim = new Simulator(signals, rules);
    set(sim, { PX23: 1 });
    expect(sim.states.AL_LONG_CADENA).toBe(1);
    expect(sim.states.M01).toBe(1);
  });
});

describe('Filas del cronograma por zona', () => {
  it('las condiciones de otra zona van al final', async () => {
    const { buildRows } = await import('../src/diagram/timing');
    const { signalsUsedBy } = await import('../src/plc/signals');
    const descarga = blocks[2].rules;
    const rows = buildRows(signals, rules, signalsUsedBy(descarga)).map((r) => r.name);
    expect(rows[rows.length - 1]).toBe('C01PX1');
    expect(rows[0]).toBe('PX05');
  });
});
