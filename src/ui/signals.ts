/** Paso 1: definición de señales del sistema. */

import { exampleRules, exampleSignals } from '../data/example';
import { store, syncRulesFromBlocks } from '../state/store';
import type { Signal, SignalLevel, SignalType } from '../types';
import type { App } from './app';

const TYPES: SignalType[] = ['Sensor', 'Motor', 'Cilindro', 'Virtual'];

function icon(type: SignalType): string {
  return { Sensor: '🔍', Motor: '🔌', Cilindro: '🔩', Virtual: '🧠' }[type];
}

export function renderSignalsStep(app: App): HTMLElement {
  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `
    <div class="step-header">
      <div class="step-number">1</div>
      <div>
        <h2 class="step-title">Definir señales del sistema</h2>
        <p class="step-description">Configure todas las señales que participarán en el sistema de automatización</p>
      </div>
    </div>
    <table class="signals-table">
      <thead>
        <tr>
          <th>Nombre de señal</th><th>Tipo</th><th>Estado inicial</th>
          <th>Descripción</th><th>Inductivos</th><th>Acciones</th>
        </tr>
      </thead>
      <tbody id="signalsTableBody"></tbody>
    </table>
    <div class="project-box top-buttons">
      <button class="btn" data-action="add">Añadir señal</button>
      <button class="btn btn-warning" data-action="example">Cargar ejemplo</button>
      <button class="btn btn-secondary" data-action="next">Continuar al Paso 2 →</button>
    </div>
    <div class="error-message hidden" id="signalError"></div>
    <div class="success-message hidden" id="signalSuccess"></div>
  `;

  const tbody = step.querySelector<HTMLTableSectionElement>('#signalsTableBody')!;
  const errorBox = step.querySelector<HTMLElement>('#signalError')!;
  const successBox = step.querySelector<HTMLElement>('#signalSuccess')!;

  function addRow(signal?: Signal): void {
    const row = document.createElement('tr');
    const s = signal ?? {
      name: '',
      type: 'Sensor' as SignalType,
      initial: 0 as SignalLevel,
      description: '',
    };
    row.innerHTML = `
      <td><input type="text" class="signal-name" placeholder="Ej: cilindro_A" value="${s.name}"></td>
      <td>
        <select class="signal-type">
          ${TYPES.map(
            (t) =>
              `<option value="${t}" ${t === s.type ? 'selected' : ''}>${icon(t)} ${t}</option>`,
          ).join('')}
        </select>
      </td>
      <td>
        <select class="signal-initial">
          <option value="0" ${s.initial === 0 ? 'selected' : ''}>0 (Bajo)</option>
          <option value="1" ${s.initial === 1 ? 'selected' : ''}>1 (Alto)</option>
        </select>
      </td>
      <td><input type="text" class="signal-description" placeholder="Descripción opcional" value="${s.description}"></td>
      <td class="inductivos-cell">
        <div class="cilindro-inductivos" style="display: ${s.type === 'Cilindro' ? 'flex' : 'none'}; gap: 5px; flex-direction: column;">
          <input type="text" class="inductivo-activo" placeholder="Inductivo activo" value="${s.inductivoActivo ?? ''}">
          <input type="text" class="inductivo-reposo" placeholder="Inductivo reposo" value="${s.inductivoReposo ?? ''}">
        </div>
      </td>
      <td><button class="btn btn-danger btn-small" data-action="del">🗑️</button></td>
    `;

    const typeSelect = row.querySelector<HTMLSelectElement>('.signal-type')!;
    const inductivos = row.querySelector<HTMLElement>('.cilindro-inductivos')!;
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'Cilindro') {
        inductivos.style.display = 'flex';
      } else {
        inductivos.style.display = 'none';
        row.querySelector<HTMLInputElement>('.inductivo-activo')!.value = '';
        row.querySelector<HTMLInputElement>('.inductivo-reposo')!.value = '';
      }
    });
    row.querySelector('[data-action="del"]')!.addEventListener('click', () => {
      row.remove();
      collectSignals();
    });

    tbody.appendChild(row);
  }

  /** Lee la tabla hacia store.signals, validando duplicados. */
  function collectSignals(): boolean {
    const rows = tbody.querySelectorAll('tr');
    const names = new Set<string>();
    let hasDuplicates = false;
    const collected: Signal[] = [];

    rows.forEach((row) => {
      const nameInput = row.querySelector<HTMLInputElement>('.signal-name')!;
      const type = row.querySelector<HTMLSelectElement>('.signal-type')!.value as SignalType;
      const initial = Number(
        row.querySelector<HTMLSelectElement>('.signal-initial')!.value,
      ) as SignalLevel;
      const description = row
        .querySelector<HTMLInputElement>('.signal-description')!
        .value.trim();
      const name = nameInput.value.trim();
      if (!name) return;

      if (names.has(name)) {
        nameInput.classList.add('error-input');
        hasDuplicates = true;
        return;
      }
      nameInput.classList.remove('error-input');
      names.add(name);
      collected.push({
        name,
        type,
        initial,
        description,
        inductivoActivo:
          type === 'Cilindro'
            ? row.querySelector<HTMLInputElement>('.inductivo-activo')!.value.trim()
            : '',
        inductivoReposo:
          type === 'Cilindro'
            ? row.querySelector<HTMLInputElement>('.inductivo-reposo')!.value.trim()
            : '',
      });
    });

    store.signals = collected;

    if (hasDuplicates) {
      errorBox.textContent = '❌ Error: Hay nombres de señales duplicados';
      errorBox.classList.remove('hidden');
    } else {
      errorBox.classList.add('hidden');
    }
    return !hasDuplicates;
  }

  // Botones.
  step.querySelector('[data-action="add"]')!.addEventListener('click', () => addRow());
  step.querySelector('[data-action="example"]')!.addEventListener('click', () => {
    if (!confirm('¿Desea cargar un ejemplo de sistema industrial?')) return;
    tbody.replaceChildren();
    exampleSignals().forEach((s) => addRow(s));
    collectSignals();
    store.blocks[store.selectedBlockIndex].rules = exampleRules();
    syncRulesFromBlocks();
    alert('✅ Ejemplo industrial cargado correctamente');
  });
  step.querySelector('[data-action="next"]')!.addEventListener('click', () => {
    if (!collectSignals()) return;
    if (store.signals.length === 0) {
      errorBox.textContent = 'Debe definir al menos una señal para continuar';
      errorBox.classList.remove('hidden');
      return;
    }
    successBox.textContent = `✅ ${store.signals.length} señales definidas correctamente`;
    successBox.classList.remove('hidden');
    setTimeout(() => app.showStep(2), 600);
  });

  // Sincroniza el store cada vez que se edita cualquier celda.
  tbody.addEventListener('input', () => collectSignals());
  tbody.addEventListener('change', () => collectSignals());

  // Cargar señales existentes del proyecto.
  if (store.signals.length > 0) store.signals.forEach((s) => addRow(s));
  else addRow();

  return step;
}
