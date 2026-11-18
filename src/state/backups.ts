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

/** Escribe; si el almacenamiento está lleno, recorta la lista por el principio. */
function writeList<T>(key: string, list: T[]): void {
  let items = list;
  for (;;) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      return;
    } catch {
      if (items.length <= 1) return;
      items = items.slice(Math.ceil(items.length / 4));
    }
  }
}

// ---- Versiones ------------------------------------------------------------

export function listVersions(projectId: string): Version[] {
  return read<Version[]>(VERSIONS_PREFIX + projectId, []).sort((a, b) => b.ts - a.ts);
}

function counts(p: Project) {
  return { signals: p.signals.length, rules: p.blocks.reduce((n, b) => n + b.rules.length, 0) };
}

export function saveVersion(p: Project, label = 'Automática'): void {
  if (!p.id) return;
  const list = read<Version[]>(VERSIONS_PREFIX + p.id, []);
  const data = JSON.stringify(p);
  if (list.length && list[list.length - 1].data === data) return;
  list.push({ ts: Date.now(), label, ...counts(p), data });
  writeList(VERSIONS_PREFIX + p.id, list.slice(-VERSIONS_MAX));
}

/** Guarda una versión automática si la última tiene más de VERSION_EVERY_MS. */
export function maybeSaveVersion(p: Project): void {
  if (!p.id) return;
  const list = read<Version[]>(VERSIONS_PREFIX + p.id, []);
  const last = list[list.length - 1];
  if (!last || Date.now() - last.ts >= VERSION_EVERY_MS) saveVersion(p);
}

export function readVersion(projectId: string, ts: number): Project | null {
  const v = read<Version[]>(VERSIONS_PREFIX + projectId, []).find((x) => x.ts === ts);
  return v ? (JSON.parse(v.data) as Project) : null;
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
  const all = read<TrashEntry[]>(TRASH_KEY, []);
  const kept = all.filter((e) => e.deletedAt >= limit);
  if (kept.length !== all.length) {
    all.filter((e) => e.deletedAt < limit).forEach((e) => e.project.id && deleteVersions(e.project.id));
    writeList(TRASH_KEY, kept);
  }
  return kept.sort((a, b) => b.deletedAt - a.deletedAt);
}

export function moveToTrash(p: Project): void {
  const list = read<TrashEntry[]>(TRASH_KEY, []);
  list.push({ deletedAt: Date.now(), project: p });
  writeList(TRASH_KEY, list);
}

export function takeFromTrash(id: string): Project | null {
  const list = read<TrashEntry[]>(TRASH_KEY, []);
  const i = list.findIndex((e) => e.project.id === id);
  if (i < 0) return null;
  const [entry] = list.splice(i, 1);
  writeList(TRASH_KEY, list);
  return entry.project;
}

export function purgeFromTrash(id: string): void {
  writeList(
    TRASH_KEY,
    read<TrashEntry[]>(TRASH_KEY, []).filter((e) => e.project.id !== id),
  );
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
