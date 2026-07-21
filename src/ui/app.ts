/**
 * Controlador principal de la interfaz.
 *
 * Orquesta las dos pantallas (selector de proyecto y espacio de trabajo con
 * los 3 pasos) y expone la navegación a las vistas. Reemplaza al conjunto de
 * funciones globales `showStep`, `openProject`, `backToProjectList`, ... del
 * index.html original.
 */

import {
  closeProject,
  openProject,
  saveCurrentProject,
  store,
} from '../state/store';
import { byId, clear } from './dom';
import { renderProjectSelector } from './projects';
import { renderSignalsStep } from './signals';
import { renderRulesStep } from './rules';
import { renderSimulationStep } from './simulation';

export class App {
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Punto de entrada: muestra el selector de proyectos. */
  start(): void {
    this.showProjectSelector();
  }

  showProjectSelector(): void {
    clear(this.root);
    this.root.appendChild(renderProjectSelector(this));
  }

  openProject(index: number): void {
    openProject(index);
    this.showWorkspace();
    this.showStep(1);
  }

  backToProjectList(): void {
    if (confirm('¿Guardar antes de salir?')) saveCurrentProject();
    closeProject();
    this.showProjectSelector();
  }

  save(): void {
    if (saveCurrentProject()) alert('✅ Proyecto guardado');
  }

  /** Construye el esqueleto del espacio de trabajo (cabecera + contenedor). */
  private showWorkspace(): void {
    clear(this.root);
    const container = document.createElement('div');
    container.className = 'container';
    container.innerHTML = `
      <div class="project-box top-buttons">
        <button class="btn btn-secondary" data-action="save">Guardar Proyecto</button>
        <button class="btn btn-danger" data-action="back">Volver a lista de proyectos</button>
      </div>
      <header>
        <h1>AutoSequence Web</h1>
        <p class="subtitle">Sistema avanzado de automatización con lógica multi-señal</p>
      </header>
      <div class="steps-container" id="stepsContainer"></div>
    `;
    container
      .querySelector('[data-action="save"]')!
      .addEventListener('click', () => this.save());
    container
      .querySelector('[data-action="back"]')!
      .addEventListener('click', () => this.backToProjectList());
    this.root.appendChild(container);
  }

  showStep(step: 1 | 2 | 3): void {
    store.currentStep = step;
    const host = byId('stepsContainer');
    clear(host);
    if (step === 1) host.appendChild(renderSignalsStep(this));
    else if (step === 2) host.appendChild(renderRulesStep(this));
    else host.appendChild(renderSimulationStep(this));
  }
}
