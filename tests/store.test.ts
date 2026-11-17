import { beforeEach, describe, expect, it } from 'vitest';

// localStorage mínimo para el entorno de Node.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { loadProjects, importProject, createProject, exportProjectJSON } = await import('../src/state/store');

beforeEach(() => mem.clear());

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
