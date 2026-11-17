/**
 * Estado de la aplicación y persistencia en localStorage.
 *
 * - Autoguardado: cada cambio se guarda solo (sin "¿Guardar antes de salir?").
 * - Ids estables: los proyectos antiguos (identificados por nombre) reciben
 *   un id al cargarse; así se pueden renombrar sin perderse.
 * - Misma clave de almacenamiento que el prototipo: los proyectos existentes
 *   siguen apareciendo.
 */

import type { Block, Cajetin, Project, Rule, Signal } from '../types';

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

function normalize(p: Project): Project {
  const blocks: Block[] =
    Array.isArray(p.blocks) && p.blocks.length
      ? p.blocks.map((b) => ({ name: b.name || 'Bloque', rules: Array.isArray(b.rules) ? b.rules : [] }))
      : [{ name: 'Bloque principal', rules: Array.isArray(p.rules) ? p.rules : [] }];
  return {
    ...p,
    id: p.id || newId(),
    name: String(p.name || 'Proyecto sin nombre'),
    signals: (p.signals || []).map((s) => ({
      ...s,
      description: s.description ?? '',
      initial: Number(s.initial) === 1 ? 1 : 0,
    })),
    blocks,
    rules: blocks.flatMap((b) => b.rules),
    cajetin: p.cajetin ?? {},
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

export function loadProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const projects = raw.map(normalize);
    // Proyectos del prototipo original: no tenían id. Se fija y se guarda
    // la primera vez para que el id sea estable entre lecturas.
    if (raw.some((p: Partial<Project>) => !p?.id)) writeProjects(projects);
    return projects;
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

function upsert(project: Project): boolean {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  const clean: Project = { ...project, rules: project.blocks.flatMap((b) => b.rules) };
  if (idx >= 0) projects[idx] = clean;
  else projects.push(clean);
  return writeProjects(projects);
}

// ---- Operaciones de la lista de proyectos ---------------------------------

export function nameTaken(name: string, exceptId?: string): boolean {
  return loadProjects().some(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.id !== exceptId,
  );
}

export function createProject(
  name: string,
  seed: Partial<Pick<Project, 'signals' | 'blocks' | 'cajetin'>> = {},
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
  });
  upsert(project);
  return { ok: true, project };
}

export function deleteProject(id: string): void {
  writeProjects(loadProjects().filter((p) => p.id !== id));
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
  upsert(copy);
  return copy;
}

/** Valida y añade un proyecto importado desde JSON. */
export function importProject(json: string): { ok: true; project: Project } | { ok: false; error: string } {
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
  let name = p.name;
  let n = 2;
  while (nameTaken(name)) name = `${p.name} (${n++})`;
  const project = normalize({ ...(p as Project), id: undefined, name });
  upsert(project);
  return { ok: true, project };
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
  emit();
  return true;
}

export function closeProject(): void {
  flushSave();
  session.project = null;
  emit();
}

let saveTimer: number | undefined;

/** Notifica un cambio del proyecto activo y programa el autoguardado. */
export function commit(): void {
  const p = session.project;
  if (!p) return;
  p.updatedAt = Date.now();
  p.rules = p.blocks.flatMap((b) => b.rules);
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
  if (ok) session.lastSaved = Date.now();
  emit();
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

/** Renombra una señal en todas las reglas que la usan. */
export function renameSignalRefs(oldName: string, newName: string): number {
  if (!session.project || !oldName || oldName === newName) return 0;
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
