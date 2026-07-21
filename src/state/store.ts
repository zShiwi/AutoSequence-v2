/**
 * Estado global de la aplicación y persistencia en localStorage.
 *
 * Sustituye a las variables globales sueltas del index.html original
 * (`signals`, `rules`, `blocks`, `currentProject`, `selectedBlockIndex`,
 * `simulationData`, ...) por un único store con eventos de cambio, de modo
 * que las vistas puedan re-renderizarse cuando el estado cambia.
 */

import type { Block, Project, Rule, Signal, SimStep } from '../types';

const STORAGE_KEY = 'autosequence_projects';

export interface AppState {
  currentProject: Project | null;
  signals: Signal[];
  blocks: Block[];
  rules: Rule[];
  selectedBlockIndex: number;
  editingRuleIndex: number | null;
  simulationData: SimStep[];
  currentStep: 1 | 2 | 3;
}

const state: AppState = {
  currentProject: null,
  signals: [],
  blocks: [],
  rules: [],
  selectedBlockIndex: 0,
  editingRuleIndex: null,
  simulationData: [],
  currentStep: 1,
};

export const store = state;

// ---- Persistencia --------------------------------------------------------

export function loadProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function createProject(name: string): { ok: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Pon un nombre al proyecto' };
  const projects = loadProjects();
  if (projects.some((p) => p.name === trimmed)) {
    return { ok: false, error: 'Ya existe un proyecto con ese nombre' };
  }
  projects.push({
    name: trimmed,
    signals: [],
    rules: [],
    blocks: [{ name: 'Bloque principal', rules: [] }],
  });
  saveProjects(projects);
  return { ok: true };
}

export function deleteProject(index: number): void {
  const projects = loadProjects();
  projects.splice(index, 1);
  saveProjects(projects);
}

/** Carga un proyecto en el estado activo. */
export function openProject(index: number): void {
  const projects = loadProjects();
  const project = projects[index];
  if (!project) return;

  state.currentProject = project;
  state.signals = (project.signals || []).map((s) => ({
    ...s,
    initial: (Number(s.initial) === 1 ? 1 : 0) as 0 | 1,
  }));
  state.blocks = project.blocks?.length
    ? project.blocks
    : [{ name: 'Bloque principal', rules: [] }];
  state.rules = state.blocks.flatMap((b) => b.rules || []);
  state.selectedBlockIndex = 0;
  state.editingRuleIndex = null;
  state.simulationData = [];
  state.currentStep = 1;
}

/** Guarda el estado activo de vuelta en localStorage. */
export function saveCurrentProject(): boolean {
  if (!state.currentProject) return false;
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.name === state.currentProject!.name);
  if (idx < 0) return false;
  projects[idx] = {
    ...state.currentProject,
    signals: state.signals,
    rules: state.rules,
    blocks: state.blocks,
  };
  saveProjects(projects);
  return true;
}

export function closeProject(): void {
  state.currentProject = null;
  state.signals = [];
  state.blocks = [];
  state.rules = [];
  state.simulationData = [];
}

// ---- Derivados -----------------------------------------------------------

/** Recalcula la lista plana de reglas a partir de los bloques. */
export function syncRulesFromBlocks(): void {
  state.rules = state.blocks.flatMap((b) => b.rules || []);
}
