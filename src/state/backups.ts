/**
 * Seguridad de los datos (todo en localStorage, sin servidor):
 *
 *  - Versiones: instantáneas automáticas de cada proyecto mientras se trabaja
 *    (como mucho una cada VERSION_EVERY_MS), para volver a un estado anterior
 *    aunque se haya cerrado el navegador.
 *  - Papelera: los proyectos eliminados se guardan TRASH_DAYS días.
 *  - Copia completa: todos los proyectos en un archivo para guardarlo fuera
 *    del navegador.
 *
 * Este módulo no depende del store para evitar dependencias circulares.
 */

import type { Project } from '../types';

const VERSIONS_PREFIX = 'autosequence_versions_';
const TRASH_KEY = 'autosequence_trash';
const LAST_BACKUP_KEY = 'autosequence_last_backup';

export const VERSION_EVERY_MS = 10 * 60 * 1000;
export const VERSIONS_MAX = 25;
export const TRASH_DAYS = 30;

export interface Version {
  ts: number;
  label: string;
  signals: number;
  rules: number;
  data: string;
}

export interface TrashEntry {
  deletedAt: number;
  project: Project;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Lee una lista; lo que no sea una lista de objetos se ignora. */
function readList<T>(key: string): T[] {
  const v = read<unknown>(key, []);
  return Array.isArray(v) ? (v.filter((x) => !!x && typeof x === 'object') as T[]) : [];
}

/**
 * Escribe una lista y dice si se guardó. Con `trim`, si el almacenamiento está
 * lleno se recorta por el principio (lo más antiguo) hasta que quepa; sin él
 * no se pierde nada: o se guarda entera o no se toca lo que había.
 */
function writeList<T>(key: string, list: T[], trim = false): boolean {
  let items = list;
  for (;;) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      return true;
    } catch {
      if (!trim || items.length <= 1) return false;
      items = items.slice(Math.ceil(items.length / 4));
    }
  }
}

// ---- Versiones ------------------------------------------------------------

const AUTO_LABEL = 'Automática';

export function listVersions(projectId: string): Version[] {
  return readList<Version>(VERSIONS_PREFIX + projectId).sort((a, b) => b.ts - a.ts);
}

function counts(p: Project) {
  return { signals: p.signals.length, rules: p.blocks.reduce((n, b) => n + b.rules.length, 0) };
}

/** Guarda una versión; devuelve false si no cupo. */
export function saveVersion(p: Project, label = AUTO_LABEL): boolean {
  if (!p.id) return false;
  const list = readList<Version>(VERSIONS_PREFIX + p.id);
  const data = JSON.stringify(p);
  if (list.length && list[list.length - 1].data === data) return true;
  list.push({ ts: Date.now(), label, ...counts(p), data });
  return writeList(VERSIONS_PREFIX + p.id, list.slice(-VERSIONS_MAX), true);
}

/** Guarda una versión automática si la última tiene más de VERSION_EVERY_MS. */
export function maybeSaveVersion(p: Project): void {
  if (!p.id) return;
  const list = readList<Version>(VERSIONS_PREFIX + p.id);
  const last = list[list.length - 1];
  if (!last || Date.now() - last.ts >= VERSION_EVERY_MS) saveVersion(p);
}

export function readVersion(projectId: string, ts: number): Project | null {
  const v = readList<Version>(VERSIONS_PREFIX + projectId).find((x) => x.ts === ts);
  if (!v) return null;
  try {
    return JSON.parse(v.data) as Project;
  } catch {
    return null;
  }
}

/**
 * Hace sitio cuando el almacenamiento está lleno: quita la mitad más antigua
 * de las versiones automáticas de cada proyecto. Las que tienen nombre no se
 * tocan (las pidió el usuario). Devuelve false cuando ya no queda nada que
 * liberar.
 */
export function freeVersionSpace(): boolean {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(VERSIONS_PREFIX)) keys.push(k);
    }
  } catch {
    return false;
  }
  let freed = false;
  keys.forEach((key) => {
    const list = readList<Version>(key);
    const auto = list.filter((v) => v.label === AUTO_LABEL).sort((a, b) => a.ts - b.ts);
    if (!auto.length) return;
    const drop = new Set(auto.slice(0, Math.ceil(auto.length / 2)));
    const kept = list.filter((v) => !drop.has(v));
    try {
      if (kept.length) localStorage.setItem(key, JSON.stringify(kept));
      else localStorage.removeItem(key);
      freed = true;
    } catch {
      /* no se pudo recortar esta lista */
    }
  });
  return freed;
}

export function deleteVersions(projectId: string): void {
  try {
    localStorage.removeItem(VERSIONS_PREFIX + projectId);
  } catch {
    /* nada que borrar */
  }
}

// ---- Papelera -------------------------------------------------------------

export function listTrash(): TrashEntry[] {
  const limit = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
  const all = readTrash();
  const kept = all.filter((e) => e.deletedAt >= limit);
  if (kept.length !== all.length) {
    all.filter((e) => e.deletedAt < limit).forEach((e) => e.project.id && deleteVersions(e.project.id));
    writeList(TRASH_KEY, kept);
  }
  return kept.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Entradas de la papelera con un proyecto reconocible. */
function readTrash(): TrashEntry[] {
  return readList<TrashEntry>(TRASH_KEY).filter(
    (e) => !!e.project && typeof e.project === 'object' && Array.isArray(e.project.signals) && Array.isArray(e.project.blocks),
  );
}

/**
 * Guarda el proyecto en la papelera y dice si entró. Nunca recorta la papelera
 * para hacer sitio: si no cabe, antes se liberan versiones automáticas.
 */
export function moveToTrash(p: Project): boolean {
  const list = readTrash();
  list.push({ deletedAt: Date.now(), project: p });
  if (writeList(TRASH_KEY, list)) return true;
  while (freeVersionSpace()) if (writeList(TRASH_KEY, list)) return true;
  return false;
}

/** Proyecto de la papelera, sin sacarlo de ella. */
export function peekTrash(id: string): Project | null {
  return readTrash().find((e) => e.project.id === id)?.project ?? null;
}

export function removeFromTrash(id: string): boolean {
  return writeList(
    TRASH_KEY,
    readTrash().filter((e) => e.project.id !== id),
  );
}

export function purgeFromTrash(id: string): void {
  removeFromTrash(id);
  deleteVersions(id);
}

// ---- Copia completa -------------------------------------------------------

export interface FullBackup {
  format: 'autosequence-backup';
  version: 2;
  createdAt: string;
  projects: Project[];
}

export function buildFullBackup(projects: Project[]): string {
  const data: FullBackup = {
    format: 'autosequence-backup',
    version: 2,
    createdAt: new Date().toISOString(),
    projects,
  };
  return JSON.stringify(data, null, 2);
}

export function markBackupDone(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  } catch {
    /* sin almacenamiento */
  }
}

export function lastBackupAt(): number | null {
  const v = Number(read<number | null>(LAST_BACKUP_KEY, null));
  return Number.isFinite(v) && v > 0 ? v : null;
}
