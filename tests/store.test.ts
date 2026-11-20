import { beforeEach, describe, expect, it } from 'vitest';

// localStorage mínimo para el entorno de Node, con cuota opcional (en
// caracteres) para probar qué pasa cuando el navegador se queda sin sitio.
const mem = new Map<string, string>();
let quota = Infinity;
const used = (except?: string) => [...mem].reduce((n, [k, v]) => (k === except ? n : n + k.length + v.length), 0);
const g = globalThis as unknown as { localStorage: Storage; window: unknown };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (used(k) + k.length + String(v).length > quota) throw new Error('QuotaExceededError');
    mem.set(k, String(v));
  },
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
  loadProjects,
  importProject,
  importFile,
  createProject,
  exportProjectJSON,
  deleteProject,
  restoreFromTrash,
  openProject,
  closeProject,
  project,
  commit,
  flushSave,
  session,
  signalUsage,
} = await import('../src/state/store');
const { listTrash, listVersions, saveVersion } = await import('../src/state/backups');
const { generateAWL } = await import('../src/plc/awl');
const { cleanSignals } = await import('../src/plc/signals');

const stored = (): { name: string }[] => JSON.parse(mem.get(KEY) ?? '[]');
const big = (name: string, size: number) => ({ name, type: 'Sensor' as const, initial: 0 as const, description: 'x'.repeat(size) });

beforeEach(() => {
  closeProject();
  quota = Infinity;
  mem.clear();
});

describe('Persistencia', () => {
  it('los proyectos del prototipo original (sin id) reciben un id estable', () => {
    mem.set(
      'autosequence_projects',
      JSON.stringify([{ name: 'Antiguo', signals: [{ name: 'a', type: 'Sensor', initial: '1', description: '' }], rules: [] }]),
    );
    const first = loadProjects();
    const second = loadProjects();
    expect(first[0].id).toBeTruthy();
    expect(second[0].id).toBe(first[0].id);
    expect(first[0].signals[0].initial).toBe(1);
    expect(first[0].blocks).toHaveLength(1);
  });

  it('exportar e importar conserva señales y reglas y evita nombres repetidos', () => {
    const res = createProject('Línea 1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const json = exportProjectJSON(res.project);
    const imp = importProject(json);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.project.name).toBe('Línea 1 (2)');
    expect(imp.project.id).not.toBe(res.project.id);
  });

  it('rechaza archivos que no son proyectos', () => {
    expect(importProject('no es json').ok).toBe(false);
    expect(importProject('{"foo":1}').ok).toBe(false);
  });
});

describe('Almacenamiento dañado', () => {
  it('una entrada dañada no hace perder los demás proyectos', () => {
    expect(createProject('A').ok).toBe(true);
    const raw = JSON.parse(mem.get(KEY)!);
    mem.set(KEY, JSON.stringify([...raw, null, { name: 'Raro', signals: [null], blocks: [null] }, 7]));

    const list = loadProjects();
    expect(list.map((p) => p.name)).toEqual(['A', 'Raro']);
    expect(list[1].signals).toEqual([]);

    expect(createProject('B').ok).toBe(true);
    expect(stored().map((p) => p.name)).toEqual(['A', 'Raro', 'B']);
    // El nombre repetido se sigue detectando.
    expect(createProject('A').ok).toBe(false);
  });

  it('si lo guardado no es legible, se aparta antes de escribir encima', () => {
    mem.set(KEY, '[{"name":"A","signals":[]},{"name":"B"');
    expect(loadProjects()).toEqual([]);
    expect(createProject('Nuevo').ok).toBe(true);
    expect(stored().map((p) => p.name)).toEqual(['Nuevo']);
    const rescued = [...mem.keys()].filter((k) => k.startsWith(`${KEY}_danado_`));
    expect(rescued).toHaveLength(1);
    expect(mem.get(rescued[0])).toContain('"name":"A"');
  });
});

describe('Importación saneada', () => {
  it('descarta lo que no se puede interpretar en vez de fallar', () => {
    const r = importProject('{"name":"x","signals":[null]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.signals).toEqual([]);
  });

  it('un proyecto con reglas mal formadas queda utilizable', () => {
    const r = importProject(
      JSON.stringify({
        name: 'Roto',
        signals: [{ name: 5 }, { name: 'M1', type: 'Motor', inductivoActivo: 3 }, 'x'],
        blocks: [
          null,
          {
            rules: [
              { name: 'r' },
              null,
              {
                name: 's',
                conditions: [null, { signal: 'M1', event: 'raro', operator: 'XOR' }],
                actions: [{ signal: 'M1', value: 1 }, 4],
              },
            ],
          },
        ],
        cajetin: 'no',
        layout: 3,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.project;
    expect(p.signals.map((s) => [s.name, s.type])).toEqual([
      ['5', 'Sensor'],
      ['M1', 'Motor'],
    ]);
    expect(p.signals[1].inductivoActivo).toBeUndefined();
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].rules).toHaveLength(2);
    const [r1, r2] = p.blocks[0].rules;
    expect(r1.conditions).toEqual([]);
    expect(r1.actions).toEqual([]);
    expect(typeof r1.id).toBe('number');
    expect(r2.id).not.toBe(r1.id);
    expect(r2.conditions).toEqual([{ signal: 'M1', event: '==1', delay: 0, operator: 'AND' }]);
    expect(r2.actions).toEqual([{ signal: 'M1', value: '1' }]);
    expect(p.cajetin).toEqual({});
    expect(p.layout).toBeUndefined();

    // Lo que antes rompía Lógica, Simulación y Código.
    expect(openProject(p.id!)).toBe(true);
    expect(() => signalUsage('M1')).not.toThrow();
    expect(() => cleanSignals(project().signals)).not.toThrow();
    expect(() => generateAWL(project().blocks)).not.toThrow();
  });

  it('en una copia completa, un proyecto dañado no corta la importación', () => {
    const backup = {
      format: 'autosequence-backup',
      version: 2,
      projects: [{ name: 'Uno', signals: [] }, null, { foo: 1 }, { name: 'Dos', signals: [null], blocks: [{ rules: [null] }] }],
    };
    const r = importFile(JSON.stringify(backup));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.imported.map((p) => p.name)).toEqual(['Uno', 'Dos']);
    expect(r.skipped).toBe(2);
  });

  it('los proyectos válidos se conservan tal cual (reglas, transportador)', () => {
    const src = {
      name: 'Bueno',
      signals: [
        {
          name: 'C01',
          type: 'Cilindro',
          initial: 0,
          description: 'Tope',
          inductivoActivo: 'C01PX2',
          inductivoReposo: 'C01PX1',
          presence: 'PX01',
        },
        { name: 'PX01', type: 'Sensor', initial: 1, description: '' },
      ],
      blocks: [
        {
          name: 'B',
          rules: [
            {
              id: 17,
              name: 'abre',
              conditions: [{ signal: 'PX01', event: 'Flanco ascendente', delay: 0, operator: 'AND' }],
              actions: [{ signal: 'C01', value: 'toggle' }],
            },
          ],
        },
      ],
      layout: {
        length: 3000,
        radius: 300,
        direction: 'ccw',
        palletLength: 400,
        palletGap: 50,
        speed: 200,
        pallets: 2,
        kind: 'suelo',
        stops: [{ cylinder: 'C01', presence: 'PX01', line: 'top', x: 500, travelMs: 300 }],
        sensors: [],
        stations: [{ stop: 'C01', label: 'Robot', action: 'load', okSensors: ['PX01'], nokSensors: [], cycleMs: 1000 }],
      },
    };
    const r = importProject(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.signals).toEqual(src.signals);
    expect(r.project.blocks).toEqual(src.blocks);
    expect(r.project.layout).toEqual(src.layout);
  });
});

describe('Almacenamiento lleno', () => {
  it('no se elimina un proyecto que no cabe en la papelera', () => {
    const a = createProject('Grande', { signals: [big('S1', 400)] });
    if (!a.ok) throw new Error('no se creó');
    quota = used() + 50;
    expect(deleteProject(a.project.id!)).toBe(false);
    expect(loadProjects().map((p) => p.name)).toEqual(['Grande']);
    expect(listTrash()).toEqual([]);
  });

  it('la papelera no se vacía para hacer sitio: antes se liberan versiones automáticas', () => {
    const a = createProject('A');
    const b = createProject('B', { signals: [big('S1', 300)] });
    if (!a.ok || !b.ok) throw new Error('no se crearon');
    expect(deleteProject(a.project.id!)).toBe(true);
    for (let i = 0; i < 6; i++) saveVersion({ ...b.project, updatedAt: i });
    saveVersion({ ...b.project, updatedAt: 99 }, 'Enviado al cliente');
    expect(listVersions(b.project.id!)).toHaveLength(7);

    quota = used() + 100;
    expect(deleteProject(b.project.id!)).toBe(true);
    expect(
      listTrash()
        .map((e) => e.project.name)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(loadProjects()).toEqual([]);
    // Las versiones con nombre no se sacrifican.
    const left = listVersions(b.project.id!);
    expect(left.length).toBeLessThan(7);
    expect(left.some((v) => v.label === 'Enviado al cliente')).toBe(true);
  });

  it('recuperar de la papelera no saca el proyecto si no se puede guardar', () => {
    const a = createProject('A', { signals: [big('S1', 400)] });
    if (!a.ok) throw new Error('no se creó');
    expect(deleteProject(a.project.id!)).toBe(true);
    quota = used() + 50;
    expect(restoreFromTrash(a.project.id!)).toBeNull();
    expect(listTrash().map((e) => e.project.name)).toEqual(['A']);
    quota = Infinity;
    expect(restoreFromTrash(a.project.id!)?.name).toBe('A');
    expect(listTrash()).toEqual([]);
    expect(loadProjects().map((p) => p.name)).toEqual(['A']);
  });

  it('el autoguardado libera versiones automáticas antiguas en vez de quedarse en error', () => {
    const a = createProject('A', { signals: [big('S1', 300)] });
    if (!a.ok) throw new Error('no se creó');
    for (let i = 0; i < 8; i++) saveVersion({ ...a.project, updatedAt: i });
    expect(openProject(a.project.id!)).toBe(true);
    quota = used() + 20;
    project().signals.push(big('S2', 600));
    commit();
    flushSave();
    expect(session.saveStatus).toBe('saved');
    expect(loadProjects()[0].signals.map((s) => s.name)).toEqual(['S1', 'S2']);
    expect(listVersions(a.project.id!).length).toBeLessThan(8);
  });

  it('crear o importar sin sitio avisa en vez de dar el proyecto por guardado', () => {
    quota = 10;
    expect(createProject('A').ok).toBe(false);
    expect(importProject('{"name":"x","signals":[]}').ok).toBe(false);
  });
});
