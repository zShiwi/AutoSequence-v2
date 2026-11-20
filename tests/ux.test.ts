import { beforeEach, describe, expect, it } from 'vitest';

// localStorage mínimo para el entorno de Node.
const mem = new Map<string, string>();
let blocked = false;
const g = globalThis as unknown as { localStorage: Storage; window: unknown };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (blocked) throw new Error('QuotaExceededError');
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

const { shortcutFor, SHORTCUT_GROUPS, SECTION_COUNT } = await import('../src/ui/shortcuts');
const { dateStamp, exportFileName, safeFileName } = await import('../src/ui/dom');
const { oneLine } = await import('../src/ui/search');
const { closeProject, commit, createProject, importFile, loadProjects, openProject, previewImport, project, saveNow, session } =
  await import('../src/state/store');

const KEY = 'autosequence_projects';
const free = { typing: false, modalOpen: false, inProject: true };
const sensor = (name: string) => ({ name, type: 'Sensor' as const, initial: 0 as const, description: '' });

beforeEach(() => {
  blocked = false;
  closeProject();
  mem.clear();
});

describe('Atajos de teclado', () => {
  it('«?» abre la ayuda y «/» o Ctrl+K llevan al buscador', () => {
    expect(shortcutFor({ key: '?', shiftKey: true }, free)).toEqual({ type: 'help' });
    expect(shortcutFor({ key: '/' }, free)).toEqual({ type: 'search' });
    expect(shortcutFor({ key: 'k', ctrlKey: true }, free)).toEqual({ type: 'search' });
    expect(shortcutFor({ key: 'K', metaKey: true }, free)).toEqual({ type: 'search' });
  });

  it('los atajos de una tecla no se disparan escribiendo en un campo', () => {
    const typing = { ...free, typing: true };
    expect(shortcutFor({ key: '?', shiftKey: true }, typing)).toBeNull();
    expect(shortcutFor({ key: '/' }, typing)).toBeNull();
    // Ctrl+Z en un campo deshace lo escrito en el campo, no el proyecto.
    expect(shortcutFor({ key: 'z', ctrlKey: true }, typing)).toBeNull();
    expect(shortcutFor({ key: 'y', ctrlKey: true }, typing)).toBeNull();
    // Los que llevan Ctrl o Alt y no escriben nada siguen valiendo.
    expect(shortcutFor({ key: 's', ctrlKey: true }, typing)).toEqual({ type: 'save' });
    expect(shortcutFor({ key: 'k', ctrlKey: true }, typing)).toEqual({ type: 'search' });
    expect(shortcutFor({ key: '2', code: 'Digit2', altKey: true }, typing)).toEqual({ type: 'section', index: 1 });
  });

  it('Alt+1…5 va a cada paso; AltGr (que escribe |, @, #) no', () => {
    for (let n = 1; n <= SECTION_COUNT; n++) {
      expect(shortcutFor({ key: String(n), code: `Digit${n}`, altKey: true }, free)).toEqual({ type: 'section', index: n - 1 });
    }
    // En macOS, Alt+3 escribe «#»: se reconoce por el código de tecla.
    expect(shortcutFor({ key: '#', code: 'Digit3', altKey: true }, free)).toEqual({ type: 'section', index: 2 });
    expect(shortcutFor({ key: '6', code: 'Digit6', altKey: true }, free)).toBeNull();
    expect(shortcutFor({ key: '@', code: 'Digit2', altKey: true, ctrlKey: true, altGraph: true }, free)).toBeNull();
    expect(shortcutFor({ key: '@', code: 'Digit2', altKey: true, altGraph: true }, free)).toBeNull();
    // Sin proyecto abierto no hay pasos a los que ir.
    expect(shortcutFor({ key: '1', code: 'Digit1', altKey: true }, { ...free, inProject: false })).toBeNull();
  });

  it('Ctrl+Z / Ctrl+Y / Ctrl+Mayús+Z deshacen y rehacen solo con un proyecto abierto', () => {
    expect(shortcutFor({ key: 'z', ctrlKey: true }, free)).toEqual({ type: 'undo' });
    expect(shortcutFor({ key: 'y', ctrlKey: true }, free)).toEqual({ type: 'redo' });
    expect(shortcutFor({ key: 'Z', ctrlKey: true, shiftKey: true }, free)).toEqual({ type: 'redo' });
    expect(shortcutFor({ key: 'z', ctrlKey: true }, { ...free, inProject: false })).toBeNull();
    expect(shortcutFor({ key: 'z', ctrlKey: true, altKey: true }, free)).toBeNull();
  });

  it('con un diálogo abierto solo valen Ctrl+S y «?»', () => {
    const modal = { ...free, modalOpen: true };
    expect(shortcutFor({ key: 's', ctrlKey: true }, modal)).toEqual({ type: 'save' });
    expect(shortcutFor({ key: '?' }, modal)).toEqual({ type: 'help' });
    expect(shortcutFor({ key: '?' }, { ...modal, typing: true })).toBeNull();
    expect(shortcutFor({ key: 'z', ctrlKey: true }, modal)).toBeNull();
    expect(shortcutFor({ key: 'k', ctrlKey: true }, modal)).toBeNull();
    expect(shortcutFor({ key: '/' }, modal)).toBeNull();
    expect(shortcutFor({ key: '1', code: 'Digit1', altKey: true }, modal)).toBeNull();
  });

  it('las teclas sueltas sin atajo no hacen nada', () => {
    expect(shortcutFor({ key: 'a' }, free)).toBeNull();
    expect(shortcutFor({ key: 'Enter' }, free)).toBeNull();
    expect(shortcutFor({ key: 's' }, free)).toBeNull();
  });

  it('el panel de ayuda lista todos los atajos', () => {
    const keys = SHORTCUT_GROUPS.flatMap((grp) => grp.rows.flatMap((r) => r.keys.map((k) => k.join('+'))));
    for (const k of ['?', 'Ctrl+K', '/', 'Ctrl+S', 'Esc', 'Ctrl+Z', 'Ctrl+Y', 'Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5']) {
      expect(keys, `falta ${k}`).toContain(k);
    }
    // Ningún texto de interfaz lleva guion largo.
    expect(JSON.stringify(SHORTCUT_GROUPS)).not.toMatch(/[—–]/);
  });
});

describe('Nombre del archivo exportado', () => {
  const day = new Date(2026, 10, 20, 0, 30);

  it('lleva el nombre del proyecto y la fecha local', () => {
    expect(exportFileName('ACU 4 topes', day)).toBe('ACU 4 topes · 2026-11-20.json');
    // A las 00:30 la fecha UTC sería la del día anterior en España.
    expect(dateStamp(day)).toBe('2026-11-20');
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('quita los caracteres que Windows no admite', () => {
    expect(safeFileName('Línea 3: prensa <A/B> "nueva"? *|\\')).toBe('Línea 3 prensa A B nueva');
    expect(safeFileName('  Estación\tde\ncarga  ')).toBe('Estación de carga');
    expect(exportFileName('a/b:c', day)).toBe('a b c · 2026-11-20.json');
    expect(exportFileName('Máquina ñ · 2', day)).toBe('Máquina ñ · 2 · 2026-11-20.json');
  });

  it('sin punto ni espacio al final, sin nombres reservados y sin quedarse vacío', () => {
    expect(safeFileName('Proyecto. . .')).toBe('Proyecto');
    expect(safeFileName('...oculto')).toBe('oculto');
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('lpt1')).toBe('_lpt1');
    expect(safeFileName('nul.txt')).toBe('_nul.txt');
    expect(safeFileName('Consola')).toBe('Consola');
    expect(safeFileName('???')).toBe('Proyecto');
    expect(safeFileName('')).toBe('Proyecto');
    const long = safeFileName('x'.repeat(300));
    expect(long.length).toBeLessThanOrEqual(80);
    // eslint-disable-next-line no-control-regex
    expect(exportFileName('a\u0000b\u001fc<>:"/\\|?*', day)).not.toMatch(/[\u0000-\u001f<>:"/\\|?*]/);
  });
});

describe('Vista previa de la importación', () => {
  const backup = (projects: unknown[]) => JSON.stringify({ format: 'autosequence-backup', version: 2, projects });

  it('dice qué proyectos entran, cuáles se renombran y cuáles se descartan, sin guardar nada', () => {
    createProject('Prensa');
    const before = mem.get(KEY);
    const json = backup([
      { name: 'Prensa', signals: [sensor('S1')], blocks: [{ name: 'B', rules: [] }] },
      { name: 'Prensa', signals: [] },
      { name: 'Cinta', signals: [sensor('S1'), sensor('S2')] },
      null,
      { foo: 1 },
      { name: 'Sin señales', signals: 'x' },
    ]);
    const res = previewImport(json);
    if (!res.ok) throw new Error(res.error);
    expect(res.kind).toBe('backup');
    expect(res.entries.map((e) => [e.name, e.finalName, e.renamed])).toEqual([
      ['Prensa', 'Prensa (2)', true],
      ['Prensa', 'Prensa (3)', true],
      ['Cinta', 'Cinta', false],
    ]);
    expect(res.entries[2].signals).toBe(2);
    expect(res.discarded.map((d) => d.name)).toEqual(['Elemento 4', 'Elemento 5', 'Sin señales']);
    expect(res.discarded.every((d) => d.reason.length > 0)).toBe(true);
    // La vista previa no escribe.
    expect(mem.get(KEY)).toBe(before);
    expect(loadProjects().map((p) => p.name)).toEqual(['Prensa']);

    // Y lo que anuncia es lo que luego se importa.
    const done = importFile(json);
    if (!done.ok) throw new Error(done.error);
    expect(done.imported.map((p) => p.name)).toEqual(res.entries.map((e) => e.finalName));
    expect(done.skipped).toBe(res.discarded.length);
  });

  it('un proyecto suelto: se anuncia el renombrado si el nombre ya existe (sin distinguir mayúsculas)', () => {
    createProject('ACU 4 topes');
    const one = JSON.stringify({ format: 'autosequence', version: 2, name: 'acu 4 TOPES', signals: [sensor('A')], rules: [] });
    const res = previewImport(one);
    if (!res.ok) throw new Error(res.error);
    expect(res.kind).toBe('project');
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ name: 'acu 4 TOPES', finalName: 'acu 4 TOPES (2)', renamed: true, signals: 1 });
    expect(res.discarded).toEqual([]);
  });

  it('proyectos del prototipo original (sin formato ni bloques) entran', () => {
    const res = previewImport(JSON.stringify({ name: 'Antiguo', signals: [sensor('a')], rules: [] }));
    if (!res.ok) throw new Error(res.error);
    expect(res.entries[0]).toMatchObject({ finalName: 'Antiguo', renamed: false });
  });

  it('errores: JSON no válido, archivo que no es un proyecto y copia sin proyectos válidos', () => {
    expect(previewImport('{no')).toEqual({ ok: false, error: 'El archivo no es un JSON válido.' });
    const notProject = previewImport('{"foo":1}');
    expect(notProject.ok).toBe(false);
    expect(!notProject.ok && notProject.error).toContain('no parece un proyecto');
    // Mismo mensaje que al importar de verdad.
    expect(notProject).toEqual(importFile('{"foo":1}'));
    const empty = previewImport(backup([null, { foo: 1 }]));
    expect(empty).toEqual({ ok: false, error: 'La copia de seguridad no contiene proyectos válidos.' });
    expect(empty).toEqual(importFile(backup([null, { foo: 1 }])));
  });
});

describe('Guardar ahora (Ctrl+S)', () => {
  it('guarda al momento lo pendiente', () => {
    const res = createProject('P');
    if (!res.ok) throw new Error(res.error);
    openProject(res.project.id!);
    project().signals.push(sensor('NUEVA'));
    commit();
    expect(session.saveStatus).toBe('pending');
    expect(loadProjects()[0].signals).toHaveLength(0);
    expect(saveNow()).toBe(true);
    expect(session.saveStatus).toBe('saved');
    expect(loadProjects()[0].signals.map((s) => s.name)).toEqual(['NUEVA']);
    // Sin cambios pendientes sigue diciendo que está guardado.
    expect(saveNow()).toBe(true);
  });

  it('si el guardado falló, lo reintenta', () => {
    const res = createProject('P');
    if (!res.ok) throw new Error(res.error);
    openProject(res.project.id!);
    project().signals.push(sensor('NUEVA'));
    commit();
    blocked = true;
    expect(saveNow()).toBe(false);
    expect(session.saveStatus).toBe('error');
    blocked = false;
    expect(saveNow()).toBe(true);
    expect(loadProjects()[0].signals).toHaveLength(1);
  });

  it('sin proyecto abierto no hace nada', () => {
    expect(saveNow()).toBe(false);
  });
});

describe('Descripción de una señal', () => {
  it('se queda en una sola línea aunque se pegue texto con saltos', () => {
    expect(oneLine('Tope de carga')).toBe('Tope de carga');
    expect(oneLine('uno\ndos')).toBe('uno dos');
    expect(oneLine('uno  \r\n\r\n  dos\ntres')).toBe('uno dos tres');
    // Los espacios dentro de la línea no se tocan (se está escribiendo).
    expect(oneLine('a  b ')).toBe('a  b ');
  });
});
