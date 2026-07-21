/** Paso 3: simulación temporal y generación de código AWL/KOP. */

import { renderTimingDiagram } from '../diagram/timing';
import { generateAWL } from '../plc/awl';
import { generateKOP } from '../plc/kop';
import { runSimulation } from '../plc/simulation';
import { store } from '../state/store';
import type { App } from './app';

export function renderSimulationStep(app: App): HTMLElement {
  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `
    <div class="step-header">
      <div class="step-number">3</div>
      <div>
        <h2 class="step-title">Simulación y diagrama temporal</h2>
        <p class="step-description">Visualice el comportamiento del sistema en el tiempo</p>
      </div>
    </div>
    <div class="project-box">
      <button class="btn" data-action="simulate">🔄 Ejecutar simulación</button>
      <button class="btn" data-action="diagram">📈 Generar diagrama</button>
      <button class="btn btn-secondary" data-action="awl">💻 Generar código AWL</button>
      <button class="btn btn-secondary" data-action="kop">🪜 Generar KOP</button>
      <button class="btn" data-action="back">← Volver al Paso 2</button>
    </div>

    <div class="diagram-container hidden" id="diagramContainer" style="margin-top: 24px; position: relative; overflow-x: auto;">
      <button class="close-btn" data-action="close-diagram">✖ Cerrar</button>
      <h3 class="diagram-title">📈 Diagrama temporal</h3>
      <div id="timingHost"></div>
    </div>

    <div class="project-box hidden" id="awlContainer" style="margin-top: 24px; position: relative;">
      <button class="close-btn" data-action="close-awl">✖ Cerrar</button>
      <h3 class="step-title">🖥️ Código AWL generado</h3>
      <textarea id="awlCode" rows="15" style="width:100%;font-family:monospace;background:#f3f4f6;padding:12px;border-radius:4px;" readonly></textarea>
    </div>

    <div class="project-box hidden" id="kopContainer" style="margin-top: 24px; position: relative;">
      <button class="close-btn" data-action="close-kop">✖ Cerrar</button>
      <h3 class="step-title">🪜 Código KOP (Ladder) generado</h3>
      <textarea id="kopCode" rows="15" style="width:100%;font-family:monospace;background:#f3f4f6;padding:12px;border-radius:4px;" readonly></textarea>
    </div>
  `;

  const diagramContainer = step.querySelector<HTMLElement>('#diagramContainer')!;
  const timingHost = step.querySelector<HTMLElement>('#timingHost')!;
  const awlContainer = step.querySelector<HTMLElement>('#awlContainer')!;
  const kopContainer = step.querySelector<HTMLElement>('#kopContainer')!;
  const awlCode = step.querySelector<HTMLTextAreaElement>('#awlCode')!;
  const kopCode = step.querySelector<HTMLTextAreaElement>('#kopCode')!;

  step.querySelector('[data-action="simulate"]')!.addEventListener('click', () => {
    if (store.signals.length === 0) {
      alert('⚠️ Primero debe definir señales');
      return;
    }
    store.simulationData = runSimulation(store.signals, store.rules);
    alert('✅ Simulación generada correctamente');
  });

  step.querySelector('[data-action="diagram"]')!.addEventListener('click', () => {
    if (store.signals.length === 0) return alert('⚠️ No hay señales definidas');
    if (store.rules.length === 0) return alert('⚠️ No hay reglas definidas');
    if (store.simulationData.length === 0) {
      store.simulationData = runSimulation(store.signals, store.rules);
    }
    timingHost.innerHTML = renderTimingDiagram(store.signals, store.simulationData);
    diagramContainer.classList.remove('hidden');
    diagramContainer.scrollIntoView({ behavior: 'smooth' });
  });

  step.querySelector('[data-action="awl"]')!.addEventListener('click', () => {
    if (!store.signals.length || !store.rules.length) {
      alert('⚠️ Primero debes definir al menos una señal y una regla para generar AWL');
      return;
    }
    awlCode.value = generateAWL(store.blocks);
    awlContainer.classList.remove('hidden');
    awlContainer.scrollIntoView({ behavior: 'smooth' });
  });

  step.querySelector('[data-action="kop"]')!.addEventListener('click', () => {
    if (!store.blocks.length) {
      alert('⚠️ No hay bloques definidos. Crea al menos un bloque con reglas.');
      return;
    }
    kopCode.value = generateKOP(store.blocks);
    kopContainer.classList.remove('hidden');
    kopContainer.scrollIntoView({ behavior: 'smooth' });
  });

  step.querySelector('[data-action="back"]')!.addEventListener('click', () => app.showStep(2));
  step
    .querySelector('[data-action="close-diagram"]')!
    .addEventListener('click', () => diagramContainer.classList.add('hidden'));
  step
    .querySelector('[data-action="close-awl"]')!
    .addEventListener('click', () => awlContainer.classList.add('hidden'));
  step
    .querySelector('[data-action="close-kop"]')!
    .addEventListener('click', () => kopContainer.classList.add('hidden'));

  return step;
}
