import { describe, expect, it } from 'vitest';
import { Simulator, runAutoScenario } from '../src/plc/simulation';
import { generateAWL } from '../src/plc/awl';
import { generateKOP, ladderModel } from '../src/plc/kop';
import { buildSymbolTable } from '../src/plc/addresses';
import { cleanSignals, validateSignalName } from '../src/plc/signals';
import { exampleBlocks, exampleSignals } from '../src/data/example';
import type { Rule, Signal } from '../src/types';

const S = (name: string, type: Signal['type'] = 'Sensor', extra: Partial<Signal> = {}): Signal => ({
  name,
  type,
  initial: 0,
  description: '',
  ...extra,
});

describe('Simulator', () => {
  it('dispara una regla con flanco ascendente y mantiene la salida (SET)', () => {
    const rules: Rule[] = [
      {
        id: 1,
        name: 'r',
        conditions: [{ signal: 'in', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
        actions: [{ signal: 'out', value: '1' }],
      },
    ];
    const sim = new Simulator([S('in'), S('out', 'Motor')], rules);
    sim.apply([{ signal: 'in', value: 1 }]);
    expect(sim.states.out).toBe(1);
    sim.apply([{ signal: 'in', value: 0 }]);
    expect(sim.states.out).toBe(1);
  });

  it('no dispara un flanco si la entrada ya estaba a 1', () => {
    const rules: Rule[] = [
      {
        id: 1,
        name: 'r',
        conditions: [{ signal: 'in', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
        actions: [{ signal: 'out', value: 'toggle' }],
      },
    ];
    const sim = new Simulator([S('in', 'Sensor', { initial: 1 }), S('out', 'Motor')], rules);
    sim.idle();
    expect(sim.states.out).toBe(0);
  });

  it('propaga secuencias encadenadas a través de los inductivos', () => {
    const sim = new Simulator(exampleSignals(), exampleBlocks().flatMap((b) => b.rules));
    sim.apply([{ signal: 'B1_pieza', value: 1 }]);
    sim.apply([{ signal: 'S1_marcha', value: 1 }]);
    // Secuencia completa: B sale, A sale y vuelve, B entra, cinta en marcha.
    expect(sim.states.M1_cinta).toBe(1);
    expect(sim.states.CIL_A).toBe(0);
    expect(sim.states.CIL_B).toBe(0);
    expect(sim.states.A_ret).toBe(1);
    const fired = sim.history.flatMap((h) => h.activations.map((a) => a.ruleName));
    expect(fired).toEqual(
      expect.arrayContaining(['Inicio de ciclo', 'Bloqueo listo → empujar', 'Empuje completado → retroceder', 'Liberar y evacuar']),
    );
    expect(sim.warnings).toEqual([]);
  });

  it('avisa si la lógica oscila', () => {
    const rules: Rule[] = [
      {
        id: 1,
        name: 'osc',
        conditions: [{ signal: 'en', event: '==1', delay: 0, operator: 'AND' }],
        actions: [{ signal: 'x', value: 'toggle' }],
      },
    ];
    const sim = new Simulator([S('en'), S('x', 'Virtual')], rules);
    sim.apply([{ signal: 'en', value: 1 }]);
    expect(sim.warnings.length).toBe(1);
  });

  it('el escenario automático ejercita todas las reglas del ejemplo', () => {
    const rules = exampleBlocks().flatMap((b) => b.rules);
    const sim = runAutoScenario(exampleSignals(), rules);
    const fired = new Set(sim.history.flatMap((h) => h.activations.map((a) => a.ruleName)));
    rules.forEach((r) => expect(fired.has(r.name)).toBe(true));
    expect(sim.history.length).toBeGreaterThanOrEqual(20);
  });

  it('en un bloque aislado fuerza las salidas para que se vea el efecto de cada regla', () => {
    const safety = exampleBlocks()[1].rules;
    const sim = runAutoScenario(exampleSignals(), safety, 16);
    const fired = new Set(sim.history.flatMap((h) => h.activations.map((a) => a.ruleName)));
    expect([...fired].sort()).toEqual(['Paro manual', 'Pieza retirada']);
  });
});

describe('Generación de código', () => {
  const blocks = exampleBlocks();

  it('AWL usa lógica de bits y flancos con memoria', () => {
    const awl = generateAWL(blocks, { projectName: 'Test' });
    expect(awl).toContain('ORGANIZATION_BLOCK OB 1');
    expect(awl).toContain('FP    M 100.0');
    expect(awl).toMatch(/U\s+"B1_pieza"/);
    expect(awl).toMatch(/S\s+"CIL_B"/);
    expect(awl).toMatch(/R\s+"CIL_A"/);
    expect(awl).not.toContain('==I');
    expect(awl.trim().endsWith('END_ORGANIZATION_BLOCK')).toBe(true);
  });

  it('KOP genera una network por regla con bobinas en paralelo', () => {
    const rungs = ladderModel(blocks);
    expect(rungs).toHaveLength(6);
    expect(rungs[0].contacts.map((c) => c.kind)).toEqual(['NO', 'P']);
    expect(rungs[0].coils.map((c) => c.kind)).toEqual(['S', 'S']);
    expect(generateKOP(blocks)).toContain('Network 1: Inicio de ciclo');
  });

  it('asigna direcciones E/A/M sin repetir', () => {
    const table = buildSymbolTable(exampleSignals());
    const addrs = table.map((t) => t.address);
    expect(new Set(addrs).size).toBe(addrs.length);
    expect(table.find((t) => t.symbol === 'S1_marcha')?.address).toBe('E 0.0');
    expect(table.find((t) => t.symbol === 'A_ext')?.area).toBe('E');
    expect(table.find((t) => t.symbol === 'CIL_A')?.address).toBe('A 0.0');
    expect(table.find((t) => t.symbol === 'M_ciclo')?.area).toBe('M');
  });
});

describe('Validación de señales', () => {
  it('rechaza nombres vacíos, con espacios o duplicados', () => {
    expect(validateSignalName('')).not.toBeNull();
    expect(validateSignalName('con espacio')).not.toBeNull();
    expect(validateSignalName('VI-2-SCT1')).toBeNull();
    const clean = cleanSignals([S('a'), S('a'), S(''), S('mal nombre'), S('b')]);
    expect(clean.map((s) => s.name)).toEqual(['a', 'b']);
  });
});
