/**
 * Estado de la aplicación y persistencia en localStorage.
 *
 * - Autoguardado: cada cambio se guarda solo (sin "¿Guardar antes de salir?").
 * - Ids estables: los proyectos antiguos (identificados por nombre) reciben
 *   un id al cargarse; así se pueden renombrar sin perderse.
 * - Misma clave de almacenamiento que el prototipo: los proyectos existentes
 *   siguen apareciendo.
 */

import type {
  Action,
  ActionValue,
  Block,
  Cajetin,
  Condition,
  ConditionEvent,
  ConveyorLayout,
  Project,
  Rule,
  Signal,
  SignalType,
} from '../types';
import {
  buildFullBackup,
  freeVersionSpace,
  markBackupDone,
  maybeSaveVersion,
  moveToTrash,
  peekTrash,
  readVersion,
  removeFromTrash,
  saveVersion,
  type FullBackup,
} from './backups';
import { ensureAddresses, type AddressFix } from '../plc/addresses';

const STORAGE_KEY = 'autosequence_projects';
const SAVE_DELAY = 400;

export type SaveStatus = 'saved' | 'pending' | 'error';

interface Session {
  project: Project | null;
  saveStatus: SaveStatus;
  lastSaved: number | null;
}

export const session: Session = { project: null, saveStatus: 'saved', lastSaved: null };

// ---- Suscripción a cambios ------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

// ---- Almacenamiento -------------------------------------------------------

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Saneado de lo leído ---------------------------------------------------
//
// Lo guardado y lo importado puede venir de versiones antiguas, de otro equipo
// o editado a mano. Antes de usarlo se deja con la forma que espera el resto de
// la aplicación: lo que no se puede interpretar se descarta o toma un valor por
// defecto, en vez de romper las vistas cada vez que se abre el proyecto.

type Raw = Record<string, unknown>;

const SIGNAL_TYPES: SignalType[] = ['Sensor', 'Motor', 'Cilindro', 'Virtual'];
const EVENTS: ConditionEvent[] = ['Flanco ascendente', 'Flanco descendente', '==1', '==0'];
const VALUES: ActionValue[] = ['0', '1', 'toggle'];

function isObj(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function objects(v: unknown): Raw[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function text(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function texts(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizeSignal(raw: Raw): Signal {
  const s = {
    ...raw,
    name: text(raw.name),
    type: SIGNAL_TYPES.includes(raw.type as SignalType) ? (raw.type as SignalType) : 'Sensor',
    initial: Number(raw.initial) === 1 ? 1 : 0,
    description: text(raw.description),
  } as Signal;
  (['inductivoActivo', 'inductivoReposo', 'presence'] as const).forEach((k) => {
    if (typeof s[k] !== 'string' || !s[k]) delete s[k];
  });
  // Direcciones: lo que no sea texto se pasa a texto para que `ensureAddresses`
  // lo revise (y lo sustituya, avisando, si no es una dirección válida).
  (['address', 'inductivoActivoAddress', 'inductivoReposoAddress'] as const).forEach((k) => {
    const v = (raw as Raw)[k];
    if (v === undefined || v === null) delete s[k];
    else s[k] = typeof v === 'string' ? v : JSON.stringify(v);
  });
  return s;
}

function normalizeRule(raw: Raw, fallbackId: number): Rule {
  // Los ids antiguos se respetan tal cual; solo se inventa uno si falta.
  const id = raw.id;
  const hasId = (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id !== '');
  return {
    ...raw,
    id: hasId ? (id as number) : fallbackId,
    name: text(raw.name),
    conditions: objects(raw.conditions).map(
      (c): Condition => ({
        ...c,
        signal: text(c.signal),
        event: EVENTS.includes(c.event as ConditionEvent) ? (c.event as ConditionEvent) : '==1',
        delay: num(c.delay, 0),
        operator: c.operator === 'OR' ? 'OR' : 'AND',
      }),
    ),
    actions: objects(raw.actions).map((a): Action => {
      const value = text(a.value) as ActionValue;
      // Igual que el simulador: lo que no es «1» ni «alternar» es un RESET.
      return { ...a, signal: text(a.signal), value: VALUES.includes(value) ? value : '0' };
    }),
  };
}

function normalizeLayout(raw: unknown): ConveyorLayout | undefined {
  if (!isObj(raw)) return undefined;
  return {
    ...raw,
    stops: objects(raw.stops).filter((t) => typeof t.cylinder === 'string'),
    sensors: objects(raw.sensors).filter((x) => typeof x.signal === 'string' && typeof x.ref === 'string'),
    stations: objects(raw.stations)
      .filter((st) => typeof st.stop === 'string')
      .map((st) => ({ ...st, okSensors: texts(st.okSensors), nokSensors: texts(st.nokSensors) })),
  } as unknown as ConveyorLayout;
}

/**
 * `addressFixes`, si se pasa, recibe las direcciones E/A/M que venían mal
 * (formato, repetidas, área equivocada) y se han sustituido.
 */
function normalize(p: Project, addressFixes?: AddressFix[]): Project {
  const raw = p as unknown as Raw;
  let nextId = Date.now();
  const rules = (list: unknown): Rule[] => objects(list).map((r) => normalizeRule(r, nextId++));
  const rawBlocks = objects(raw.blocks);
  const blocks: Block[] = rawBlocks.length
    ? rawBlocks.map((b) => ({ ...b, name: text(b.name) || 'Bloque', rules: rules(b.rules) }))
    : [{ name: 'Bloque principal', rules: rules(raw.rules) }];
  const layout = normalizeLayout(raw.layout);
  const signals = objects(raw.signals).map(normalizeSignal);
  // Un proyecto sin direcciones guardadas recibe las que se le calculaban
  // hasta ahora; el que ya las trae las conserva.
  const fixes = ensureAddresses(signals);
  addressFixes?.push(...fixes);
  const out: Project = {
    ...p,
    id: text(raw.id) || newId(),
    name: text(raw.name).trim() || 'Proyecto sin nombre',
    signals,
    blocks,
    rules: blocks.flatMap((b) => b.rules),
    cajetin: isObj(raw.cajetin) ? (raw.cajetin as Partial<Cajetin>) : {},
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
  };
  if (layout) out.layout = layout;
  else delete out.layout;
  return out;
}

/**
 * Resultado de la última lectura del almacenamiento. Lo usa `writeProjects`
 * para no escribir nunca encima de algo que no se ha podido leer.
 */
const lastRead: { ok: boolean; kept: unknown[] } = { ok: true, kept: [] };

export function loadProjects(): Project[] {
  lastRead.ok = true;
  lastRead.kept = [];
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    raw = undefined;
  }
  if (!Array.isArray(raw)) {
    lastRead.ok = false;
    return [];
  }
  const projects: Project[] = [];
  let migrate = false;
  raw.forEach((entry: unknown) => {
    // Una entrada dañada no arrastra a las demás: se salta y se conserva.
    if (!isObj(entry)) return;
    try {
      projects.push(normalize(entry as unknown as Project));
      if (!entry.id) migrate = true;
    } catch {
      lastRead.kept.push(entry);
    }
  });
  // Proyectos del prototipo original: no tenían id. Se fija y se guarda
  // la primera vez para que el id sea estable entre lecturas.
  if (migrate) writeProjects(projects);
  return projects;
}

/**
 * Si lo guardado no se pudo leer (JSON roto), se aparta en otra clave antes de
 * escribir encima; así se puede recuperar a mano.
 */
function rescueUnreadable(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(`${STORAGE_KEY}_danado_${Date.now()}`, raw);
    return true;
  } catch {
    return false;
  }
}

/** Escribe la lista leída con `loadProjects` (hay que llamarla justo antes). */
function writeProjects(projects: Project[]): boolean {
  if (!lastRead.ok && !rescueUnreadable()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...projects, ...lastRead.kept]));
    lastRead.ok = true;
    return true;
  } catch {
    return false;
  }
}

function upsertOnce(project: Project): boolean {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  const clean: Project = { ...project, rules: project.blocks.flatMap((b) => b.rules) };
  if (idx >= 0) projects[idx] = clean;
  else projects.push(clean);
  return writeProjects(projects);
}

/**
 * Guarda el proyecto. Si no cabe, libera versiones automáticas antiguas y
 * reintenta: el trabajo actual vale más que una instantánea vieja.
 */
function upsert(project: Project): boolean {
  if (upsertOnce(project)) return true;
  while (freeVersionSpace()) if (upsertOnce(project)) return true;
  return false;
}

const STORAGE_FULL =
  'No se pudo guardar: el almacenamiento del navegador está lleno. Exporta una copia de seguridad y elimina proyectos o versiones que no necesites.';

// ---- Operaciones de la lista de proyectos ---------------------------------

export function nameTaken(name: string, exceptId?: string): boolean {
  return loadProjects().some(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.id !== exceptId,
  );
}

export function createProject(
  name: string,
  seed: Partial<Pick<Project, 'signals' | 'blocks' | 'cajetin' | 'layout'>> = {},
): { ok: true; project: Project } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Escribe un nombre para el proyecto.' };
  if (nameTaken(trimmed)) return { ok: false, error: `Ya existe un proyecto llamado «${trimmed}».` };
  const project = normalize({
    name: trimmed,
    signals: seed.signals ?? [],
    rules: [],
    blocks: seed.blocks ?? [{ name: 'Bloque principal', rules: [] }],
    cajetin: seed.cajetin ?? {},
    ...(seed.layout ? { layout: seed.layout } : {}),
  });
  if (!upsert(project)) return { ok: false, error: STORAGE_FULL };
  return { ok: true, project };
}

/**
 * Mueve el proyecto a la papelera (recuperable durante TRASH_DAYS días).
 * Devuelve false, sin borrar nada, si no se pudo guardar en la papelera.
 */
export function deleteProject(id: string): boolean {
  let all = loadProjects();
  const p = all.find((x) => x.id === id);
  if (!p) return true;
  if (!moveToTrash(p)) return false;
  all = loadProjects();
  if (writeProjects(all.filter((x) => x.id !== id))) return true;
  removeFromTrash(id);
  return false;
}

/**
 * Recupera un proyecto de la papelera. Solo sale de ella cuando ya está
 * guardado en la lista; si no se pudo guardar devuelve null y sigue allí.
 */
export function restoreFromTrash(id: string): Project | null {
  const p = peekTrash(id);
  if (!p) return null;
  let restored: Project;
  try {
    const base = normalize(p);
    let name = base.name;
    let n = 2;
    while (nameTaken(name)) name = `${base.name} (${n++})`;
    restored = { ...base, name };
  } catch {
    return null;
  }
  if (!upsert(restored)) return null;
  removeFromTrash(id);
  return restored;
}

/** Copia completa de todos los proyectos (y marca la fecha de la copia). */
export function exportAllJSON(): string {
  flushSave();
  const json = buildFullBackup(loadProjects());
  markBackupDone();
  return json;
}

/** Importa un proyecto exportado o una copia completa de varios. */
export function importFile(
  json: string,
): { ok: true; imported: Project[]; skipped: number; addressFixes: AddressFix[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  const backup = data as Partial<FullBackup>;
  if (backup && backup.format === 'autosequence-backup' && Array.isArray(backup.projects)) {
    const imported: Project[] = [];
    const addressFixes: AddressFix[] = [];
    let skipped = 0;
    let full = false;
    for (const p of backup.projects) {
      // Un proyecto que no se puede importar no corta la copia: se salta.
      const r = importProject(JSON.stringify(p ?? null));
      if (r.ok) {
        imported.push(r.project);
        addressFixes.push(...r.addressFixes);
      } else {
        skipped++;
        full ||= r.error === STORAGE_FULL;
      }
    }
    if (!imported.length) {
      return { ok: false, error: full ? STORAGE_FULL : 'La copia de seguridad no contiene proyectos válidos.' };
    }
    return { ok: true, imported, skipped, addressFixes };
  }
  const r = importProject(json);
  return r.ok ? { ok: true, imported: [r.project], skipped: 0, addressFixes: r.addressFixes } : r;
}

export function duplicateProject(id: string): Project | null {
  const src = loadProjects().find((p) => p.id === id);
  if (!src) return null;
  let name = `${src.name} (copia)`;
  let n = 2;
  while (nameTaken(name)) name = `${src.name} (copia ${n++})`;
  const copy = normalize({
    ...JSON.parse(JSON.stringify(src)),
    id: undefined,
    name,
    createdAt: undefined,
    updatedAt: undefined,
  });
  return upsert(copy) ? copy : null;
}

/**
 * Valida y añade un proyecto importado desde JSON. Las direcciones E/A/M se
 * conservan; las que vienen repetidas o no son válidas se sustituyen por el
 * primer hueco libre y se devuelven en `addressFixes` para avisar.
 */
export function importProject(
  json: string,
): { ok: true; project: Project; addressFixes: AddressFix[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  const p = data as Partial<Project>;
  if (!p || typeof p !== 'object' || !Array.isArray(p.signals) || typeof p.name !== 'string') {
    return { ok: false, error: 'El archivo no parece un proyecto de AutoSequence (faltan «name» o «signals»).' };
  }
  let project: Project;
  const addressFixes: AddressFix[] = [];
  try {
    const base = p.name.trim() || 'Proyecto sin nombre';
    let name = base;
    let n = 2;
    while (nameTaken(name)) name = `${base} (${n++})`;
    project = normalize({ ...(p as Project), id: undefined, name }, addressFixes);
  } catch {
    return { ok: false, error: 'El archivo está dañado y no se puede importar.' };
  }
  if (!upsert(project)) return { ok: false, error: STORAGE_FULL };
  return { ok: true, project, addressFixes };
}

export function exportProjectJSON(project: Project): string {
  const { id: _id, ...rest } = { ...project, rules: project.blocks.flatMap((b) => b.rules) };
  void _id;
  return JSON.stringify({ format: 'autosequence', version: 2, ...rest }, null, 2);
}

// ---- Proyecto activo ------------------------------------------------------

export function openProject(id: string): boolean {
  const p = loadProjects().find((x) => x.id === id);
  if (!p) return false;
  session.project = p;
  upsert(p); // fija el id en proyectos antiguos
  resetHistory();
  emit();
  return true;
}

// ---- Deshacer / rehacer ----------------------------------------------------

const UNDO_MAX = 100;
/** Cambios separados por menos de esto se agrupan en un solo paso. */
const UNDO_GROUP_MS = 1000;
const undoStack: string[] = [];
const redoStack: string[] = [];
let baseline: string | null = null;
let lastCommitAt = 0;

function snapshot(p: Project): string {
  return JSON.stringify({ ...p, updatedAt: 0 });
}

function resetHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  baseline = session.project ? snapshot(session.project) : null;
  lastCommitAt = 0;
}

/** Registra el estado anterior al cambio que se acaba de hacer. */
function recordChange(p: Project, separate = false): void {
  const snap = snapshot(p);
  const now = Date.now();
  if (baseline !== null && snap !== baseline) {
    if (separate || now - lastCommitAt > UNDO_GROUP_MS || !undoStack.length) {
      undoStack.push(baseline);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }
    redoStack.length = 0;
  }
  baseline = snap;
  // Tras una acción de un clic, el siguiente cambio empieza otro paso.
  lastCommitAt = separate ? 0 : now;
}

/** Sustituye el contenido del proyecto abierto manteniendo el mismo objeto. */
function restoreSnapshot(json: string): void {
  const p = session.project!;
  const data = JSON.parse(json) as Project;
  Object.keys(p).forEach((k) => delete (p as unknown as Record<string, unknown>)[k]);
  Object.assign(p, data, { id: p.id ?? data.id, updatedAt: Date.now() });
  baseline = snapshot(p);
  lastCommitAt = 0;
  session.saveStatus = 'pending';
  flushSave();
  emit();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undo(): boolean {
  const p = session.project;
  if (!p || !undoStack.length) return false;
  flushSave();
  redoStack.push(snapshot(p));
  restoreSnapshot(undoStack.pop()!);
  return true;
}

export function redo(): boolean {
  const p = session.project;
  if (!p || !redoStack.length) return false;
  undoStack.push(snapshot(p));
  restoreSnapshot(redoStack.pop()!);
  return true;
}

export function closeProject(): void {
  flushSave();
  session.project = null;
  resetHistory();
  emit();
}

let saveTimer: number | undefined;

/** Notifica un cambio del proyecto activo y programa el autoguardado. */
/**
 * Registra un cambio del proyecto abierto. Los cambios seguidos (escribir en
 * un campo) se agrupan en un solo paso de deshacer; con `separate` el cambio
 * es siempre un paso propio (acciones de un clic, como crear un tope).
 */
export function commit(opts: { separate?: boolean } = {}): void {
  const p = session.project;
  if (!p) return;
  p.updatedAt = Date.now();
  p.rules = p.blocks.flatMap((b) => b.rules);
  // Las señales nuevas (se creen donde se creen) reciben aquí su dirección, y
  // las que cambian de tipo, una del área que les toca. Las demás no se tocan.
  ensureAddresses(p.signals);
  recordChange(p, opts.separate);
  session.saveStatus = 'pending';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, SAVE_DELAY);
  emit();
}

export function flushSave(): void {
  window.clearTimeout(saveTimer);
  const p = session.project;
  if (!p || session.saveStatus !== 'pending') return;
  const ok = upsert(p);
  session.saveStatus = ok ? 'saved' : 'error';
  if (ok) {
    session.lastSaved = Date.now();
    maybeSaveVersion(p);
  }
  emit();
}

/** Guarda ahora una versión con nombre del proyecto abierto. */
export function saveNamedVersion(label: string): boolean {
  if (!session.project) return false;
  flushSave();
  return saveVersion(session.project, label);
}

/**
 * Vuelve a una versión guardada. Antes guarda el estado actual como versión
 * y lo deja en «deshacer», así restaurar nunca hace perder trabajo.
 */
export function restoreVersion(ts: number): boolean {
  const p = session.project;
  if (!p?.id) return false;
  const data = readVersion(p.id, ts);
  if (!data) return false;
  flushSave();
  saveVersion(p, 'Antes de restaurar');
  undoStack.push(snapshot(p));
  redoStack.length = 0;
  restoreSnapshot(JSON.stringify({ ...normalize({ ...data, id: p.id }), id: p.id }));
  return true;
}

export function renameProject(name: string): string | null {
  const p = session.project;
  if (!p) return null;
  const trimmed = name.trim();
  if (!trimmed) return 'El nombre no puede estar vacío.';
  if (nameTaken(trimmed, p.id)) return `Ya existe un proyecto llamado «${trimmed}».`;
  p.name = trimmed;
  commit();
  return null;
}

// ---- Consultas y cambios de dominio ---------------------------------------

export function project(): Project {
  if (!session.project) throw new Error('No hay proyecto abierto');
  return session.project;
}

export function allRules(): Rule[] {
  return session.project ? session.project.blocks.flatMap((b) => b.rules) : [];
}

/** Reglas que usan una señal (por nombre), con su bloque. */
export function signalUsage(name: string): { block: string; rule: string }[] {
  if (!session.project || !name) return [];
  const out: { block: string; rule: string }[] = [];
  session.project.blocks.forEach((b) =>
    b.rules.forEach((r) => {
      if (r.conditions.some((c) => c.signal === name) || r.actions.some((a) => a.signal === name)) {
        out.push({ block: b.name, rule: r.name });
      }
    }),
  );
  return out;
}

/**
 * Renombra una señal en todas las reglas que la usan (devuelve cuántas
 * referencias de reglas cambian). También actualiza los enlaces que no son
 * reglas: la presencia de los topes y el transportador.
 */
export function renameSignalRefs(oldName: string, newName: string): number {
  if (!session.project || !oldName || oldName === newName) return 0;
  const p = session.project;
  p.signals.forEach((s) => {
    if (s.presence === oldName) s.presence = newName;
  });
  if (p.layout) {
    const l = p.layout;
    const sw = (v: string | undefined) => (v === oldName ? newName : v);
    if (l.motor === oldName) l.motor = newName;
    l.stops.forEach((t) => {
      t.cylinder = sw(t.cylinder)!;
      if (t.presence) t.presence = sw(t.presence);
    });
    l.sensors.forEach((x) => {
      x.signal = sw(x.signal)!;
      x.ref = sw(x.ref)!;
    });
    l.stations.forEach((st) => {
      st.stop = sw(st.stop)!;
      if (st.release) st.release = sw(st.release);
      st.okSensors = st.okSensors.map((v) => sw(v)!);
      st.nokSensors = st.nokSensors.map((v) => sw(v)!);
    });
  }
  let n = 0;
  session.project.blocks.forEach((b) =>
    b.rules.forEach((r) => {
      r.conditions.forEach((c) => {
        if (c.signal === oldName) {
          c.signal = newName;
          n++;
        }
      });
      r.actions.forEach((a) => {
        if (a.signal === oldName) {
          a.signal = newName;
          n++;
        }
      });
    }),
  );
  return n;
}

export function setSignals(signals: Signal[]): void {
  project().signals = signals;
  commit();
}

export function setCajetin(patch: Partial<Cajetin>): void {
  const p = project();
  p.cajetin = { ...(p.cajetin ?? {}), ...patch };
  commit();
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'ahora mismo';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
