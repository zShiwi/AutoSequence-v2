/**
 * Arreglos de la revisión del motor PLC: cadenas largas, oscilación real,
 * marcas auxiliares, etiquetas de salto, reglas incompletas e inductivos.
 */

import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/plc/simulation';
import { generateAWL, jumpLabel } from '../src/plc/awl';
import { generateKOP, ladderModel } from '../src/plc/kop';
import { auxiliarySymbols, buildSymbolTable, markerPlan } from '../src/plc/addresses';
import { cleanSignals, inductivoProblems } from '../src/plc/signals';
import { ruleLogicText } from '../src/plc/rules';
import { standaloneSvg } from '../src/diagram/ladder';
import { Plant } from '../src/plant/engine';
import { defaultLayout } from '../src/plant/layout';
import type { Block, Condition, Rule, Signal } from '../src/types';

const S = (name: string, type: Signal['type'] = 'Sensor', extra: Partial<Signal> = {}): Signal => ({
  name,
  type,
  initial: 0,
  description: '',
  ...extra,
});
const C = (signal: string, event: Condition['event'] = '==1', operator: Condition['operator'] = 'AND'): Condition => ({
  signal,
  event,
  delay: 0,
  operator,
});
const R = (id: number, conditions: Condition[], actions: Rule['actions'], name = `r${id}`): Rule => ({
  id,
  name,
  conditions,
  actions,
});
const up = (signal: string) => C(signal, 'Flanco ascendente');

/** n cilindros: START↑ saca el primero y cada inductivo saca el siguiente. */
function chain(n: number): { signals: Signal[]; rules: Rule[] } {
  const signals: Signal[] = [S('START')];
  const rules: Rule[] = [];
  for (let i = 0; i < n; i++) {
    signals.push(S(`C${i}`, 'Cilindro', { inductivoActivo: `C${i}A` }));
    rules.push(R(i + 1, [up(i === 0 ? 'START' : `C${i - 1}A`)], [{ signal: `C${i}`, value: '1' }]));
  }
  return { signals, rules };
}

describe('Secuencias largas y oscilación', () => {
  it('una cadena de 40 cilindros se propaga entera y sin aviso', () => {
    const { signals, rules } = chain(40);
    const sim = new Simulator(signals, rules);
    sim.apply([{ signal: 'START', value: 1 }]);
    for (let i = 0; i < 40; i++) expect(sim.states[`C${i}`], `C${i}`).toBe(1);
    expect(sim.warnings).toEqual([]);
  });

  it('una secuencia de ida y vuelta de 8 cilindros termina sin aviso', () => {
    const n = 8;
    const { signals, rules } = chain(n);
    // Al salir el último, vuelven todos uno detrás de otro.
    for (let i = n - 1; i >= 0; i--) {
      const trigger = i === n - 1 ? up(`C${i}A`) : C(`C${i + 1}A`, 'Flanco descendente');
      rules.push(R(100 + i, [trigger], [{ signal: `C${i}`, value: '0' }]));
    }
    const sim = new Simulator(signals, rules);
    sim.apply([{ signal: 'START', value: 1 }]);
    for (let i = 0; i < n; i++) expect(sim.states[`C${i}`], `C${i}`).toBe(0);
    expect(sim.warnings).toEqual([]);
  });

  it('una regla que alterna por nivel sí avisa de oscilación, y se corta pronto', () => {
    const sim = new Simulator([S('en'), S('x', 'Virtual')], [R(1, [C('en')], [{ signal: 'x', value: 'toggle' }])]);
    const steps = sim.apply([{ signal: 'en', value: 1 }]);
    expect(sim.warnings.join(' ')).toContain('no se estabiliza');
    expect(steps.length).toBeLessThan(10);
  });

  it('un cilindro que sale y vuelve sin parar también se detecta como oscilación', () => {
    const rules = [
      R(1, [C('en'), C('CA', '==0')], [{ signal: 'CIL', value: '1' }]),
      R(2, [C('CA')], [{ signal: 'CIL', value: '0' }]),
    ];
    const sim = new Simulator([S('en'), S('CIL', 'Cilindro', { inductivoActivo: 'CA' })], rules);
    const steps = sim.apply([{ signal: 'en', value: 1 }]);
    expect(sim.warnings.join(' ')).toContain('no se estabiliza');
    expect(steps.length).toBeLessThan(10);
  });
});

describe('Marcas auxiliares del AWL', () => {
  const edgeBlocks = (n: number): Block[] => [
    { name: 'B', rules: Array.from({ length: n }, (_, i) => R(i + 1, [up(`S${i}`)], [{ signal: 'Y', value: '1' }])) },
  ];
  /** Todas las direcciones M que aparecen en el programa, por uso. */
  const used = (awl: string) => {
    const of = (re: RegExp) => [...awl.matchAll(re)].map((m) => m[1]);
    return {
      memories: of(/^\s+F[PN]\s+(M \d+\.\d)/gm),
      pulses: of(/^\s+=\s+(M \d+\.\d)\s+\/\/ pulso/gm),
      flags: of(/^\s+=\s+(M \d+\.\d)\s+\/\/ regla activa/gm),
    };
  };

  it('con pocos flancos conserva M100, M110 y M120', () => {
    const awl = generateAWL(edgeBlocks(3));
    expect(awl).toContain('FP    M 100.0');
    expect(awl).toMatch(/=\s+M 110\.0/);
    expect(awl).toMatch(/=\s+M 120\.0/);
  });

  it('con 200 flancos ninguna marca se usa para dos cosas', () => {
    const u = used(generateAWL(edgeBlocks(200)));
    expect(u.memories).toHaveLength(200);
    expect(u.pulses).toHaveLength(200);
    expect(u.flags).toHaveLength(200);
    const all = [...u.memories, ...u.pulses, ...u.flags];
    expect(new Set(all).size).toBe(all.length);
  });

  it('con más de 800 marcas virtuales las auxiliares van detrás', () => {
    const signals = Array.from({ length: 900 }, (_, i) => S(`V${i}`, 'Virtual'));
    const blocks = edgeBlocks(2);
    const virtual = new Set(buildSymbolTable(signals).map((t) => t.address));
    const u = used(generateAWL(blocks, { signals }));
    [...u.memories, ...u.pulses, ...u.flags].forEach((a) => expect(virtual.has(a), a).toBe(false));
    expect(markerPlan(blocks, signals).memoryByte).toBeGreaterThanOrEqual(113);
  });

  it('la tabla de símbolos auxiliar lista las mismas marcas que usa el AWL', () => {
    const signals = [S('S0'), S('S1'), S('Y', 'Motor'), S('FL_MEM_001', 'Virtual')];
    const blocks = edgeBlocks(2);
    const aux = auxiliarySymbols(blocks, signals);
    const u = used(generateAWL(blocks, { signals }));
    expect(aux.map((a) => a.address).sort()).toEqual([...u.memories, ...u.pulses, ...u.flags].sort());
    expect(aux.find((a) => a.address === 'M 100.0')?.comment).toBe('Memoria de flanco ↑ S0');
    expect(aux.find((a) => a.address === 'M 120.1')?.comment).toBe('Regla activa R2 · r2');
    // Los símbolos no chocan con los del proyecto ni entre sí.
    const names = [...buildSymbolTable(signals), ...aux].map((t) => t.symbol);
    expect(new Set(names).size).toBe(names.length);
    names.forEach((n) => expect(n.length).toBeLessThanOrEqual(24));
  });
});

describe('Etiquetas de salto de Alternar', () => {
  it('tienen 4 caracteres y no se repiten con más de 100 reglas', () => {
    const toggles = Array.from({ length: 12 }, (_, i) => ({ signal: `Y${i}`, value: 'toggle' as const }));
    const rules = Array.from({ length: 120 }, (_, i) => R(i + 1, [up('S')], i === 9 ? toggles : [toggles[0]]));
    const awl = generateAWL([{ name: 'B', rules }]);
    const defs = [...awl.matchAll(/^(\w+): NOP 0$/gm)].map((m) => m[1]);
    const jumps = [...awl.matchAll(/SPBN\s+(\w+)/g)].map((m) => m[1]);
    expect(defs).toHaveLength(119 + 12);
    expect(new Set(defs).size).toBe(defs.length);
    expect(jumps).toEqual(defs);
    defs.forEach((d) => expect(d).toMatch(/^T[0-9A-Z]{3}$/));
  });

  it('numeración en base 36', () => {
    expect(jumpLabel(0)).toBe('T000');
    expect(jumpLabel(35)).toBe('T00Z');
    expect(jumpLabel(36)).toBe('T010');
    expect(jumpLabel(46655)).toBe('TZZZ');
  });
});

describe('Reglas sin condiciones o sin acciones', () => {
  const blocks: Block[] = [
    {
      name: 'B',
      rules: [
        R(1, [C('a')], [{ signal: 'y', value: '1' }], 'normal'),
        R(2, [], [{ signal: 'z', value: '1' }], 'sin condiciones'),
        R(3, [C('a')], [], 'sin acciones'),
        R(4, [C('a', '==0')], [{ signal: 'y', value: '0' }], 'ultima'),
      ],
    },
  ];
  const signals = [S('a'), S('y', 'Motor'), S('z', 'Motor')];

  it('el simulador no las ejecuta', () => {
    const sim = new Simulator(signals, blocks[0].rules);
    sim.apply([{ signal: 'a', value: 1 }]);
    expect(sim.states.y).toBe(1);
    expect(sim.states.z).toBe(0);
  });

  it('el AWL las omite con un comentario y no deja una asignación sin lógica', () => {
    const awl = generateAWL(blocks);
    expect(awl).toContain('// R2 · sin condiciones: omitida (sin condiciones)');
    expect(awl).toContain('// R3 · sin acciones: omitida (sin acciones)');
    expect(awl).not.toContain('"z"');
    expect(awl).not.toMatch(/TITLE = R[23] /);
    // Cada «= regla activa» va precedida de una condición.
    const lines = awl.split('\n');
    lines.forEach((l, i) => {
      if (l.includes('// regla activa')) expect(lines[i - 1]).toMatch(/^\s+(U|UN|\))\s/);
    });
    // R4 conserva su marca aunque dos reglas no se generen.
    expect(awl).toMatch(/TITLE = R4 · ultima\n.*\n\s+=\s+M 120\.3/);
  });

  it('el KOP las omite y la Network sigue siendo el número de regla', () => {
    const rungs = ladderModel(blocks);
    expect(rungs.map((r) => r.number)).toEqual([1, 4]);
    const kop = generateKOP(blocks);
    expect(kop).toContain('Network 4: ultima');
    expect(kop).toContain('// Network 2: sin condiciones (omitida: sin condiciones');
    expect(kop).not.toContain('(S) z');
  });

  it('una regla mal formada (sin listas) no rompe los generadores', () => {
    const broken = [{ name: 'B', rules: [{ id: 1, name: 'rota' } as unknown as Rule, blocks[0].rules[0]] }];
    expect(() => generateAWL(broken)).not.toThrow();
    expect(() => generateKOP(broken)).not.toThrow();
    expect(() => ruleLogicText(broken[0].rules[0])).not.toThrow();
    const sim = new Simulator(signals, broken[0].rules);
    sim.apply([{ signal: 'a', value: 1 }]);
    expect(sim.states.y).toBe(1);
    expect(ladderModel(broken).map((r) => r.number)).toEqual([2]);
  });
});

describe('Inductivos no válidos o repetidos', () => {
  const signals = [
    S('PX'),
    S('A', 'Cilindro', { inductivoActivo: 'X', inductivoReposo: 'A0' }),
    S('B', 'Cilindro', { inductivoActivo: 'X', inductivoReposo: 'mal nombre' }),
    S('D', 'Cilindro', { inductivoActivo: 'PX', inductivoReposo: 'D0' }),
    S('E', 'Cilindro', { inductivoActivo: 'E1', inductivoReposo: 'E1' }),
  ];

  it('cleanSignals descarta los inductivos que darían símbolos duplicados o no válidos', () => {
    const clean = cleanSignals(signals);
    expect(clean.map((s) => s.name)).toEqual(['PX', 'A', 'B', 'D', 'E']);
    const by = Object.fromEntries(clean.map((s) => [s.name, s]));
    expect(by.A.inductivoActivo).toBe('X');
    expect(by.B.inductivoActivo).toBeUndefined();
    expect(by.B.inductivoReposo).toBeUndefined();
    expect(by.D.inductivoActivo).toBeUndefined();
    expect(by.D.inductivoReposo).toBe('D0');
    expect(by.E.inductivoActivo).toBe('E1');
    expect(by.E.inductivoReposo).toBeUndefined();
    const symbols = buildSymbolTable(clean).map((t) => t.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    // No se modifica el proyecto: solo la copia que usan simulación y código.
    expect(signals[2].inductivoActivo).toBe('X');
  });

  it('las señales correctas se devuelven tal cual', () => {
    const ok = [S('A', 'Cilindro', { inductivoActivo: 'A1', inductivoReposo: 'A0' }), S('B')];
    const clean = cleanSignals(ok);
    expect(clean[0]).toBe(ok[0]);
    expect(clean[1]).toBe(ok[1]);
  });

  it('inductivoProblems explica cada caso', () => {
    const p = inductivoProblems(signals);
    expect(p.get(1)?.activo).toContain('otro cilindro');
    expect(p.get(2)?.activo).toContain('otro cilindro');
    expect(p.get(2)?.reposo).toContain('sin espacios');
    expect(p.get(3)).toEqual({ activo: '«PX» ya es el nombre de una señal' });
    expect(p.get(4)?.reposo).toContain('mismo inductivo');
    expect(p.has(0)).toBe(false);
  });
});

describe('Transportador: cilindros que no son topes', () => {
  it('sus inductivos siguen al cilindro aunque la planta mueva los de los topes', () => {
    const signals = [
      S('BTN'),
      S('MOTOR', 'Motor'),
      S('C01', 'Cilindro', { inductivoActivo: 'C01PX2', inductivoReposo: 'C01PX1' }),
      S('GARRA', 'Cilindro', { inductivoActivo: 'GARRA_A', inductivoReposo: 'GARRA_R' }),
      S('HECHO', 'Virtual'),
    ];
    const rules = [
      R(1, [up('BTN')], [{ signal: 'GARRA', value: '1' }]),
      R(2, [C('GARRA_A')], [{ signal: 'HECHO', value: '1' }]),
    ];
    const layout = { ...defaultLayout(signals), pallets: 0 };
    layout.stops = layout.stops.filter((t) => t.cylinder === 'C01');
    layout.stations = [];
    layout.sensors = [];
    const plant = new Plant(layout, signals, rules);
    expect(plant.sim.states.GARRA_R).toBe(1);
    plant.sim.apply([{ signal: 'BTN', value: 1 }]);
    expect(plant.sim.states.GARRA).toBe(1);
    expect(plant.sim.states.GARRA_A).toBe(1);
    expect(plant.sim.states.GARRA_R).toBe(0);
    expect(plant.sim.states.HECHO).toBe(1);
  });

  it('con externalDerived: true el simulador no toca ningún inductivo', () => {
    const signals = [S('BTN'), S('GARRA', 'Cilindro', { inductivoActivo: 'GARRA_A' })];
    const sim = new Simulator(signals, [R(1, [up('BTN')], [{ signal: 'GARRA', value: '1' }])], { externalDerived: true });
    sim.apply([{ signal: 'BTN', value: 1 }]);
    expect(sim.states.GARRA).toBe(1);
    expect(sim.states.GARRA_A).toBe(0);
  });
});

describe('SVG descargado', () => {
  it('no deja variables CSS, tampoco las que llevan cifras en el nombre', () => {
    const svg = standaloneSvg('<svg><path style="stroke:var(--ink-3, #7A8794);fill:var(--lad-bg, #FFFFFF)"/></svg>');
    expect(svg).not.toContain('var(');
    expect(svg).toContain('stroke:#7A8794;fill:#FFFFFF');
  });
});
