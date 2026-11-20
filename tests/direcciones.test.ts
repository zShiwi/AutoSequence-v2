import { beforeEach, describe, expect, it } from 'vitest';
import type { Block, Signal } from '../src/types';

// localStorage mínimo para el entorno de Node (el almacén lo necesita).
const mem = new Map<string, string>();
const g = globalThis as unknown as { localStorage: Storage; window: unknown };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;
g.window ??= globalThis;

const KEY = 'autosequence_projects';
const {
  auxiliarySymbols,
  buildSymbolTable,
  checkAddress,
  ensureAddresses,
  markerPlan,
  parseAddress,
  renumberAddresses,
  symbolTableCSV,
} = await import('../src/plc/addresses');
const { cleanSignals, derivedSignals } = await import('../src/plc/signals');
const { generateAWL } = await import('../src/plc/awl');
const { renderLadder } = await import('../src/diagram/ladder');
const { ladderModel } = await import('../src/plc/kop');
const { exampleBlocks, exampleSignals } = await import('../src/data/example');
const { acu4Blocks, acu4Signals } = await import('../src/data/acu4');
const store = await import('../src/state/store');
const { buildSheets, symbolRows } = await import('../src/ui/docs');

const S = (name: string, type: Signal['type'] = 'Sensor', extra: Partial<Signal> = {}): Signal => ({
  name,
  type,
  initial: 0,
  description: '',
  ...extra,
});

/**
 * La asignación de antes de guardar direcciones, copiada tal cual: sensores,
 * inductivos, salidas y marcas, cada grupo en orden y contando desde cero.
 */
function legacy(signals: Signal[]): Record<string, string> {
  const clean = cleanSignals(signals);
  const at = (area: string, i: number) => `${area} ${Math.floor(i / 8)}.${i % 8}`;
  const out: Record<string, string> = {};
  let e = 0;
  let a = 0;
  let m = 0;
  clean.forEach((s) => s.type === 'Sensor' && (out[s.name] = at('E', e++)));
  derivedSignals(clean).forEach((d) => (out[d.name] = at('E', e++)));
  clean.forEach((s) => (s.type === 'Motor' || s.type === 'Cilindro') && (out[s.name] = at('A', a++)));
  clean.forEach((s) => s.type === 'Virtual' && (out[s.name] = at('M', m++)));
  return out;
}

const tableOf = (signals: Signal[]): Record<string, string> =>
  Object.fromEntries(buildSymbolTable(cleanSignals(signals)).map((t) => [t.symbol, t.address]));

const all = (signals: Signal[]): string[] =>
  signals.flatMap((s) => [s.address, s.inductivoActivoAddress, s.inductivoReposoAddress]).filter((a): a is string => !!a);

beforeEach(() => {
  store.closeProject();
  mem.clear();
});

describe('Direcciones: migración', () => {
  it.each([
    ['ejemplo', exampleSignals],
    ['ACU 4 topes', acu4Signals],
  ])('un proyecto sin direcciones (%s) recibe exactamente las de antes', (_n, make) => {
    const expected = legacy(make());
    const signals = make();
    expect(ensureAddresses(signals)).toEqual([]);
    expect(tableOf(signals)).toEqual(expected);
    // Y quedan guardadas en cada señal y en cada inductivo.
    signals.forEach((s) => {
      expect(s.address).toBe(expected[s.name]);
      if (s.inductivoActivo) expect(s.inductivoActivoAddress).toBe(expected[s.inductivoActivo]);
      if (s.inductivoReposo) expect(s.inductivoReposoAddress).toBe(expected[s.inductivoReposo]);
    });
  });

  it('las señales no utilizables no desplazan a las demás y reciben un hueco al final', () => {
    const signals = [
      S('a'),
      S(''),
      S('a'),
      S('mal nombre'),
      S('C1', 'Cilindro', { inductivoActivo: 'X', inductivoReposo: 'a' }),
      S('b'),
      S('M1', 'Virtual'),
    ];
    const expected = legacy(signals.map((s) => ({ ...s })));
    ensureAddresses(signals);
    expect(tableOf(signals)).toEqual(expected);
    expect(expected).toEqual({ a: 'E 0.0', b: 'E 0.1', X: 'E 0.2', C1: 'A 0.0', M1: 'M 0.0' });
    // Todas tienen dirección y ninguna se repite.
    const addrs = all(signals);
    expect(addrs).toHaveLength(9);
    expect(new Set(addrs).size).toBe(9);
  });

  it('un proyecto guardado sin direcciones se abre con las de antes y ya las conserva', () => {
    const signals = exampleSignals();
    const expected = legacy(exampleSignals());
    mem.set(KEY, JSON.stringify([{ name: 'Antiguo', signals, rules: [], blocks: exampleBlocks() }]));
    const p = store.loadProjects()[0];
    expect(tableOf(p.signals)).toEqual(expected);
    expect(store.openProject(p.id!)).toBe(true);
    // Un sensor nuevo al principio de la lista ya no desplaza nada.
    store.project().signals.unshift(S('NUEVO'));
    store.commit();
    store.flushSave();
    const again = store.loadProjects()[0];
    expect(tableOf(again.signals)).toMatchObject(expected);
    expect(again.signals[0].address).toBeDefined();
    expect(Object.values(expected)).not.toContain(again.signals[0].address);
  });
});

describe('Direcciones: asignación estable', () => {
  const base = (): Signal[] => {
    const signals = [
      S('S1'),
      S('S2'),
      S('C1', 'Cilindro', { inductivoActivo: 'C1A', inductivoReposo: 'C1R' }),
      S('M1', 'Motor'),
      S('V1', 'Virtual'),
    ];
    ensureAddresses(signals);
    return signals;
  };

  it('una señal nueva recibe el primer hueco libre de su área y no mueve a las demás', () => {
    const signals = base();
    const before = tableOf(signals);
    expect(before).toEqual({ S1: 'E 0.0', S2: 'E 0.1', C1A: 'E 0.2', C1R: 'E 0.3', C1: 'A 0.0', M1: 'A 0.1', V1: 'M 0.0' });
    signals.splice(1, 0, S('S3'), S('M2', 'Motor'), S('V2', 'Virtual'));
    expect(ensureAddresses(signals)).toEqual([]);
    expect(tableOf(signals)).toEqual({ ...before, S3: 'E 0.4', M2: 'A 0.2', V2: 'M 0.1' });
  });

  it('al borrar una señal su dirección queda libre para la siguiente', () => {
    const signals = base();
    signals.splice(1, 1); // S2 (E 0.1)
    ensureAddresses(signals);
    expect(tableOf(signals).C1A).toBe('E 0.2');
    signals.push(S('S9'));
    ensureAddresses(signals);
    expect(signals[signals.length - 1].address).toBe('E 0.1');
  });

  it('al cambiar el tipo se reasigna en el área que toca', () => {
    const signals = base();
    signals[0].type = 'Motor'; // S1: de entrada a salida
    ensureAddresses(signals);
    expect(signals[0].address).toBe('A 0.2');
    signals[3].type = 'Virtual'; // M1: de salida a marca
    ensureAddresses(signals);
    expect(signals[3].address).toBe('M 0.1');
    // El resto sigue donde estaba.
    expect(tableOf(signals)).toMatchObject({ S2: 'E 0.1', C1A: 'E 0.2', C1R: 'E 0.3', C1: 'A 0.0', V1: 'M 0.0' });
  });

  it('los inductivos reciben dirección al escribirlos y la sueltan al quitarlos', () => {
    const signals = base();
    const cyl = signals[2];
    delete cyl.inductivoReposo;
    ensureAddresses(signals);
    expect(cyl.inductivoReposoAddress).toBeUndefined();
    cyl.inductivoReposo = 'C1R2';
    ensureAddresses(signals);
    expect(cyl.inductivoReposoAddress).toBe('E 0.3');
    // Deja de ser cilindro: suelta las dos entradas y pasa a marcas.
    cyl.type = 'Virtual';
    delete cyl.inductivoActivo;
    delete cyl.inductivoReposo;
    ensureAddresses(signals);
    expect(cyl.inductivoActivoAddress).toBeUndefined();
    expect(cyl.address).toBe('M 0.1');
  });

  it('«Renumerar todo» vuelve a la asignación compacta', () => {
    const signals = base();
    signals[1].address = 'E 7.7';
    signals[4].address = 'M 3.0';
    signals.push(S('S3'));
    ensureAddresses(signals);
    expect(signals[1].address).toBe('E 7.7');
    const n = renumberAddresses(signals);
    expect(n).toBe(5);
    expect(tableOf(signals)).toEqual(legacy(signals.map((s) => ({ name: s.name, type: s.type, initial: 0, description: '', inductivoActivo: s.inductivoActivo, inductivoReposo: s.inductivoReposo }))));
    expect(renumberAddresses(signals)).toBe(0);
  });
});

describe('Direcciones: marcas auxiliares', () => {
  const blocks: Block[] = [
    {
      name: 'B',
      rules: [
        {
          id: 1,
          name: 'r1',
          conditions: [{ signal: 'S1', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
          actions: [{ signal: 'V1', value: '1' }],
        },
      ],
    },
  ];

  it('las marcas virtuales nunca caen en las marcas de flancos, pulsos y reglas', () => {
    const signals = [S('S1'), ...Array.from({ length: 900 }, (_, i) => S(`V${i + 1}`, 'Virtual'))];
    ensureAddresses(signals);
    const aux = new Set(auxiliarySymbols(blocks, signals).map((t) => t.address));
    expect(aux.size).toBe(3);
    signals.forEach((s) => expect(aux.has(s.address!), s.address).toBe(false));
    expect(new Set(all(signals)).size).toBe(901);
  });

  it('una marca virtual dentro de la zona reservada se rechaza a mano y se corrige al importar', () => {
    const signals = [S('S1'), S('V1', 'Virtual'), S('V2', 'Virtual')];
    ensureAddresses(signals);
    const r = checkAddress(signals, 1, 'address', 'M 100.0');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('reservadas');
    expect(checkAddress(signals, 1, 'address', 'M 99.7')).toEqual({ ok: true, address: 'M 99.7' });
    signals[1].address = 'M 120.0';
    const fixes = ensureAddresses(signals);
    expect(fixes).toEqual([{ symbol: 'V1', from: 'M 120.0', to: 'M 0.0', reason: 'reservada' }]);
  });

  it('el plan de marcas queda siempre por encima de las virtuales', () => {
    const signals = [S('S1'), S('V1', 'Virtual', { address: 'M 99.7' })];
    expect(markerPlan(blocks, signals).memoryByte).toBe(100);
    // Aunque llegara una marca más alta (datos de otra versión), no se pisa.
    expect(markerPlan(blocks, [S('S1'), S('V1', 'Virtual', { address: 'M 130.0' })]).memoryByte).toBe(131);
  });
});

describe('Direcciones: edición a mano', () => {
  const signals = (): Signal[] => {
    const list = [S('S1'), S('S2'), S('C1', 'Cilindro', { inductivoActivo: 'C1A' }), S('M1', 'Motor'), S('V1', 'Virtual')];
    ensureAddresses(list);
    return list;
  };

  it('acepta E/A/M byte.bit y lo deja en la forma normal', () => {
    expect(checkAddress(signals(), 0, 'address', ' e12.5 ')).toEqual({ ok: true, address: 'E 12.5' });
    expect(checkAddress(signals(), 3, 'address', 'A 3.0')).toEqual({ ok: true, address: 'A 3.0' });
    expect(checkAddress(signals(), 2, 'inductivoActivoAddress', 'E1.0')).toEqual({ ok: true, address: 'E 1.0' });
    // Su propia dirección no cuenta como repetida.
    expect(checkAddress(signals(), 0, 'address', 'E 0.0')).toEqual({ ok: true, address: 'E 0.0' });
    expect(parseAddress('m 2.7')).toEqual({ area: 'M', byte: 2, bit: 7 });
  });

  it.each([
    ['', 'Escribe'],
    ['E 0', 'Formato'],
    ['I 0.0', 'Formato'],
    ['E 0.8', 'bit va de 0 a 7'],
    ['E 0.12', 'bit va de 0 a 7'],
    ['E 70000.0', 'byte va de 0 a'],
    ['A 0.5', 'entradas (E)'],
    ['E 0.1', 'ya la usa S2'],
    ['E 0.2', 'ya la usa C1A'],
  ])('rechaza «%s» en un sensor', (text, why) => {
    const r = checkAddress(signals(), 0, 'address', text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(why);
  });

  it('cada tipo solo admite su área', () => {
    const list = signals();
    expect(checkAddress(list, 3, 'address', 'E 5.0').ok).toBe(false); // motor
    expect(checkAddress(list, 2, 'address', 'M 5.0').ok).toBe(false); // cilindro
    expect(checkAddress(list, 4, 'address', 'A 5.0').ok).toBe(false); // virtual
    expect(checkAddress(list, 2, 'inductivoActivoAddress', 'A 5.0').ok).toBe(false); // inductivo
    expect(checkAddress(list, 3, 'address', 'A 0.0')).toMatchObject({ ok: false, error: 'A 0.0 ya la usa C1' });
  });
});

describe('Direcciones: salidas del programa', () => {
  const project = () => {
    const signals = exampleSignals();
    ensureAddresses(signals);
    // Direcciones puestas a mano, fuera del orden de la lista.
    signals.find((s) => s.name === 'S1_marcha')!.address = 'E 4.2';
    signals.find((s) => s.name === 'CIL_A')!.address = 'A 8.1';
    signals.find((s) => s.name === 'CIL_A')!.inductivoActivoAddress = 'E 9.0';
    expect(ensureAddresses(signals)).toEqual([]);
    return { signals, blocks: exampleBlocks() };
  };

  it('la tabla de símbolos y el CSV usan las direcciones guardadas, ordenadas', () => {
    const { signals } = project();
    const table = buildSymbolTable(signals);
    expect(table.find((t) => t.symbol === 'S1_marcha')?.address).toBe('E 4.2');
    expect(table.find((t) => t.symbol === 'CIL_A')?.address).toBe('A 8.1');
    const ind = signals.find((s) => s.name === 'CIL_A')!.inductivoActivo!;
    expect(table.find((t) => t.symbol === ind)).toMatchObject({ address: 'E 9.0', area: 'E' });
    // Por áreas (E, A, M) y, dentro, por dirección.
    const key = (a: string) => 'EAM'.indexOf(a[0]) * 1e6 + parseAddress(a)!.byte * 8 + parseAddress(a)!.bit;
    const keys = table.map((t) => key(t.address));
    expect(keys).toEqual([...keys].sort((x, y) => x - y));
    expect(symbolTableCSV(table)).toContain('"S1_marcha";"E 4.2";"BOOL"');
    // No modifica las señales que recibe.
    const bare = exampleSignals();
    buildSymbolTable(bare);
    expect(bare.every((s) => s.address === undefined)).toBe(true);
  });

  it('el KOP rotula los contactos con la dirección guardada', () => {
    const { signals, blocks } = project();
    const svg = renderLadder(ladderModel(blocks), buildSymbolTable(signals)).svg;
    expect(svg).toContain('E 4.2');
    expect(svg).toContain('A 8.1');
  });

  it('el AWL usa las mismas marcas auxiliares que lista la tabla', () => {
    const { signals, blocks } = project();
    const awl = generateAWL(blocks, { signals });
    auxiliarySymbols(blocks, signals).forEach((t) => expect(awl, t.symbol).toContain(t.address));
  });

  it('la documentación A3 lleva la tabla de símbolos con las guardadas y las marcas auxiliares', () => {
    const { signals, blocks } = project();
    const table = buildSymbolTable(signals);
    const aux = auxiliarySymbols(blocks, signals);
    expect(aux.length).toBeGreaterThan(0);
    const rows = symbolRows(table, aux);
    expect(rows.filter((r) => 'group' in r).map((r) => ('group' in r ? r.group : ''))).toEqual([
      'Entradas (E)',
      'Salidas (A)',
      'Marcas (M)',
      'Marcas auxiliares del programa',
    ]);
    expect(rows.filter((r) => !('group' in r))).toHaveLength(table.length + aux.length);

    const sheets = buildSheets({ name: 'Doc', signals, blocks, rules: [], cajetin: {} });
    expect(sheets.map((s) => s.title)).toEqual(['Portada', ...blocks.map((b) => b.name), 'Tabla de símbolos']);
    const symbols = sheets[sheets.length - 1].svg;
    expect(symbols).toContain('>E 4.2<');
    expect(symbols).toContain('>A 8.1<');
    aux.forEach((t) => {
      expect(symbols).toContain(`>${t.address}<`);
      expect(symbols).toContain(`>${t.symbol}<`);
    });
    // La portada la lista en el índice y las hojas de bloque usan la guardada.
    expect(sheets[0].svg).toContain('Tabla de símbolos');
    expect(sheets.slice(1, -1).some((s) => s.svg.includes('>E 4.2<'))).toBe(true);
    expect(sheets.every((s) => s.svg.includes(`>of ${sheets.length}<`))).toBe(true);
  });

  it('con muchos símbolos la tabla se reparte en varias hojas sin perder ninguno', () => {
    const signals = Array.from({ length: 300 }, (_, i) => S(`S${i + 1}`));
    ensureAddresses(signals);
    const sheets = buildSheets({ name: 'Doc', signals, blocks: [{ name: 'B', rules: [] }], rules: [], cajetin: {} });
    const pages = sheets.filter((s) => s.title.startsWith('Tabla de símbolos'));
    expect(pages.map((s) => s.title)).toEqual(['Tabla de símbolos (1 de 3)', 'Tabla de símbolos (2 de 3)', 'Tabla de símbolos (3 de 3)']);
    const svg = pages.map((s) => s.svg).join('');
    signals.forEach((s) => expect(svg).toContain(`>${s.name}<`));
  });
});

describe('Direcciones: importar y exportar', () => {
  it('exportar e importar conserva las direcciones, también las puestas a mano', () => {
    const made = store.createProject('P', { signals: exampleSignals(), blocks: exampleBlocks() });
    if (!made.ok) throw new Error('no se creó');
    store.openProject(made.project.id!);
    const p = store.project();
    p.signals[0].address = 'E 30.1';
    p.signals.find((s) => s.type === 'Cilindro')!.inductivoReposoAddress = 'E 31.7';
    store.commit();
    const before = p.signals.map((s) => [s.name, s.address, s.inductivoActivoAddress, s.inductivoReposoAddress]);
    const json = store.exportProjectJSON(p);
    store.closeProject();
    const r = store.importFile(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addressFixes).toEqual([]);
    expect(r.imported[0].signals.map((s) => [s.name, s.address, s.inductivoActivoAddress, s.inductivoReposoAddress])).toEqual(before);
  });

  it('las direcciones repetidas o no válidas se sustituyen por un hueco libre y se avisa', () => {
    const src = {
      name: 'Raro',
      signals: [
        { name: 'S1', type: 'Sensor', initial: 0, description: '', address: 'E0.0' },
        { name: 'S2', type: 'Sensor', initial: 0, description: '', address: 'E 0.0' },
        { name: 'S3', type: 'Sensor', initial: 0, description: '', address: 'E 0.9' },
        { name: 'S4', type: 'Sensor', initial: 0, description: '', address: 'A 0.0' },
        { name: 'S5', type: 'Sensor', initial: 0, description: '', address: 7 },
        { name: 'S6', type: 'Sensor', initial: 0, description: '', address: 'E 2.0' },
        { name: 'C1', type: 'Cilindro', initial: 0, description: '', address: 'A 0.0', inductivoActivo: 'C1A', inductivoActivoAddress: 'E 2.0' },
        { name: 'S7', type: 'Sensor', initial: 0, description: '' },
      ],
      blocks: [],
    };
    const r = store.importProject(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = Object.fromEntries(r.project.signals.map((s) => [s.name, s.address]));
    // Las válidas se quedan; las demás, a los huecos en orden.
    expect(got).toEqual({ S1: 'E 0.0', S2: 'E 0.1', S3: 'E 0.2', S4: 'E 0.3', S5: 'E 0.4', S6: 'E 2.0', C1: 'A 0.0', S7: 'E 0.6' });
    expect(r.project.signals[6].inductivoActivoAddress).toBe('E 0.5');
    expect(r.addressFixes.map((f) => [f.symbol, f.from, f.to, f.reason])).toEqual([
      ['S2', 'E 0.0', 'E 0.1', 'duplicada'],
      ['S3', 'E 0.9', 'E 0.2', 'formato'],
      ['S4', 'A 0.0', 'E 0.3', 'area'],
      ['S5', '7', 'E 0.4', 'formato'],
      ['C1A', 'E 2.0', 'E 0.5', 'duplicada'],
    ]);
    // Lo importado queda guardado ya corregido.
    const saved = store.loadProjects()[0];
    expect(new Set(all(saved.signals)).size).toBe(all(saved.signals).length);
  });

  it('una copia completa suma los avisos de todos sus proyectos', () => {
    const one = { name: 'A', signals: [{ name: 'S1', type: 'Sensor', initial: 0, description: '', address: 'x' }] };
    const two = { name: 'B', signals: [{ name: 'S1', type: 'Motor', initial: 0, description: '', address: 'A 1.1' }] };
    const r = store.importFile(JSON.stringify({ format: 'autosequence-backup', projects: [one, two] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addressFixes).toHaveLength(1);
    expect(r.imported[1].signals[0].address).toBe('A 1.1');
  });

  it('deshacer devuelve también la dirección que se cambió', () => {
    const made = store.createProject('P', { signals: [S('S1'), S('S2')] });
    if (!made.ok) throw new Error('no se creó');
    store.openProject(made.project.id!);
    store.project().signals[0].address = 'E 5.5';
    store.commit({ separate: true });
    expect(store.undo()).toBe(true);
    expect(store.project().signals[0].address).toBe('E 0.0');
  });
});
