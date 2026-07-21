/** Paso 2: constructor de reglas de automatización y gestión de bloques. */

import { store, syncRulesFromBlocks } from '../state/store';
import type { Action, ActionValue, Condition, ConditionEvent, Rule } from '../types';
import type { App } from './app';

const EVENTS: { value: ConditionEvent; label: string }[] = [
  { value: 'Flanco ascendente', label: '🔺 Flanco ascendente (0→1)' },
  { value: 'Flanco descendente', label: '🔻 Flanco descendente (1→0)' },
  { value: '==1', label: '✅ Estado alto (==1)' },
  { value: '==0', label: '❌ Estado bajo (==0)' },
];

const ACTION_VALUES: { value: ActionValue; label: string }[] = [
  { value: '1', label: '1 (Alto)' },
  { value: '0', label: '0 (Bajo)' },
  { value: 'toggle', label: '🔄 Alternar' },
];

function signalIcon(type: string): string {
  return (
    ({ Sensor: '🔍', Motor: '🔌', Cilindro: '🔩', Virtual: '🧠' } as Record<string, string>)[
      type
    ] ?? '❓'
  );
}

/** Opciones para el <select> de señal de una condición (incluye inductivos). */
function conditionSignalOptions(selected = ''): string {
  const opts = ['<option value="">Seleccionar señal...</option>'];
  store.signals.forEach((s) => {
    opts.push(
      `<option value="${s.name}" ${s.name === selected ? 'selected' : ''}>${signalIcon(
        s.type,
      )} ${s.name}</option>`,
    );
    if (s.type === 'Cilindro' && s.inductivoActivo) {
      opts.push(
        `<option value="${s.inductivoActivo}" ${
          s.inductivoActivo === selected ? 'selected' : ''
        }>🔍 ${s.inductivoActivo} (activo)</option>`,
      );
    }
    if (s.type === 'Cilindro' && s.inductivoReposo) {
      opts.push(
        `<option value="${s.inductivoReposo}" ${
          s.inductivoReposo === selected ? 'selected' : ''
        }>🔍 ${s.inductivoReposo} (reposo)</option>`,
      );
    }
  });
  return opts.join('');
}

/** Opciones para el <select> de señal de una acción (solo actuadores/virtuales). */
function actionSignalOptions(selected = ''): string {
  const opts = ['<option value="">Seleccionar señal...</option>'];
  store.signals
    .filter((s) => s.type === 'Motor' || s.type === 'Cilindro' || s.type === 'Virtual')
    .forEach((s) => {
      opts.push(
        `<option value="${s.name}" ${s.name === selected ? 'selected' : ''}>${signalIcon(
          s.type,
        )} ${s.name}</option>`,
      );
    });
  return opts.join('');
}

export function renderRulesStep(app: App): HTMLElement {
  const step = document.createElement('div');
  step.className = 'step';
  step.innerHTML = `
    <div class="step-header">
      <div class="step-number">2</div>
      <div>
        <h2 class="step-title">Crear reglas de automatización</h2>
        <p class="step-description">Defina condiciones complejas con múltiples señales y acciones simultáneas</p>
      </div>
    </div>
    <div class="rule-builder">
      <h3>🔧 Constructor de reglas</h3>
      <div id="blockManager" style="margin-bottom: 24px">
        <label><strong>Bloque/Función:</strong></label>
        <select id="blockSelector"></select>
        <button data-action="block-new">➕ Nuevo bloque</button>
        <button data-action="block-rename">✏️ Renombrar</button>
        <button data-action="block-delete">🗑️ Borrar</button>
      </div>
      <div class="condition-group">
        <h4>📋 Condiciones (SI)</h4>
        <div id="conditionsList"></div>
      </div>
      <div class="actions-group">
        <h4>⚡ Acciones (ENTONCES)</h4>
        <div id="actionsList"></div>
        <button class="btn btn-small" data-action="add-action">➕ Añadir acción</button>
      </div>
      <div class="project-box top-buttons">
        <button class="btn" data-action="save-rule">💾 Guardar regla</button>
        <button class="btn btn-secondary" data-action="clear">🔄 Limpiar</button>
      </div>
    </div>
    <div class="rules-list" id="rulesList"></div>
    <div class="project-box top-buttons">
      <button class="btn" data-action="back">← Volver al Paso 1</button>
      <button class="btn btn-secondary" data-action="next">Continuar al Paso 3 →</button>
    </div>
  `;

  const blockSelector = step.querySelector<HTMLSelectElement>('#blockSelector')!;
  const conditionsList = step.querySelector<HTMLElement>('#conditionsList')!;
  const actionsList = step.querySelector<HTMLElement>('#actionsList')!;
  const rulesList = step.querySelector<HTMLElement>('#rulesList')!;

  // ---- Condiciones ----
  function addConditionRow(cond?: Condition, after?: HTMLElement): void {
    const item = document.createElement('div');
    item.className = 'condition-item';
    item.innerHTML = `
      <div class="form-group">
        <label>Señal</label>
        <select class="condition-signal">${conditionSignalOptions(cond?.signal)}</select>
      </div>
      <div class="form-group">
        <label>Evento</label>
        <select class="condition-event">
          ${EVENTS.map(
            (e) =>
              `<option value="${e.value}" ${
                cond?.event === e.value ? 'selected' : ''
              }>${e.label}</option>`,
          ).join('')}
        </select>
      </div>
      <button class="btn btn-small" data-action="add-cond">➕</button>
      <button class="btn btn-danger btn-small" data-action="del-cond">🗑️</button>
    `;
    item.querySelector('[data-action="add-cond"]')!.addEventListener('click', () =>
      addConditionRow(undefined, item),
    );
    item.querySelector('[data-action="del-cond"]')!.addEventListener('click', () => {
      if (conditionsList.querySelectorAll('.condition-item').length > 1) item.remove();
    });
    if (after) after.after(item);
    else conditionsList.appendChild(item);
  }

  // ---- Acciones ----
  function addActionRow(action?: Action): void {
    const item = document.createElement('div');
    item.className = 'action-item';
    item.innerHTML = `
      <div class="form-group">
        <label>Actuador/Virtual</label>
        <select class="action-signal">${actionSignalOptions(action?.signal)}</select>
      </div>
      <div class="form-group">
        <label>Valor</label>
        <select class="action-value">
          ${ACTION_VALUES.map(
            (v) =>
              `<option value="${v.value}" ${
                action?.value === v.value ? 'selected' : ''
              }>${v.label}</option>`,
          ).join('')}
        </select>
      </div>
      <button class="btn btn-danger btn-small" data-action="del-action">🗑️</button>
    `;
    item.querySelector('[data-action="del-action"]')!.addEventListener('click', () => {
      if (actionsList.querySelectorAll('.action-item').length > 1) item.remove();
    });
    actionsList.appendChild(item);
  }

  function clearBuilder(): void {
    conditionsList.replaceChildren();
    actionsList.replaceChildren();
    store.editingRuleIndex = null;
    addConditionRow();
    addActionRow();
  }

  // ---- Bloques ----
  function refreshBlockSelector(): void {
    if (store.blocks.length === 0) {
      store.blocks.push({ name: 'Bloque principal', rules: [] });
      store.selectedBlockIndex = 0;
    }
    blockSelector.replaceChildren();
    store.blocks.forEach((block, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = block.name;
      if (idx === store.selectedBlockIndex) opt.selected = true;
      blockSelector.appendChild(opt);
    });
  }

  // ---- Lista de reglas del bloque ----
  function displayRules(): void {
    rulesList.replaceChildren();
    const block = store.blocks[store.selectedBlockIndex];
    if (!block?.rules) return;

    block.rules.forEach((rule, index) => {
      const conds = rule.conditions
        .map((c, i) => `${i === 0 ? '' : ' Y '}<strong>${c.signal}</strong> → ${c.event}`)
        .join('; ');
      const actions = rule.actions
        .map(
          (a) =>
            `<strong>${a.signal}</strong> = ${a.value === 'toggle' ? '🔄 Alternar' : a.value}`,
        )
        .join('; ');

      const card = document.createElement('div');
      card.className = 'rule-card';
      card.innerHTML = `
        <div class="rule-header">
          <div class="rule-title">📋 ${rule.name}</div>
          <div>
            <button class="btn btn-small" data-action="edit">✏️</button>
            <button class="btn btn-danger btn-small" data-action="del">🗑️</button>
          </div>
        </div>
        <div class="rule-conditions"><strong>🔍 Condiciones (AND):</strong> ${conds}</div>
        <div class="rule-actions"><strong>⚡ Acciones:</strong> ${actions}</div>
      `;
      card.querySelector('[data-action="edit"]')!.addEventListener('click', () =>
        editRule(index),
      );
      card.querySelector('[data-action="del"]')!.addEventListener('click', () => {
        if (confirm('¿Está seguro de que desea eliminar esta regla?')) {
          block.rules.splice(index, 1);
          syncRulesFromBlocks();
          displayRules();
          alert('✅ Regla eliminada correctamente');
        }
      });
      rulesList.appendChild(card);
    });
  }

  function editRule(index: number): void {
    const block = store.blocks[store.selectedBlockIndex];
    const rule = block.rules[index];
    store.editingRuleIndex = index;

    conditionsList.replaceChildren();
    rule.conditions.forEach((c) => addConditionRow(c));
    actionsList.replaceChildren();
    rule.actions.forEach((a) => addActionRow(a));

    // Se retira la regla original; se re-guardará al pulsar "Guardar regla".
    block.rules.splice(index, 1);
    syncRulesFromBlocks();
    displayRules();
  }

  function saveRule(): void {
    const conditions: Condition[] = [];
    conditionsList.querySelectorAll('.condition-item').forEach((item) => {
      const signal = item.querySelector<HTMLSelectElement>('.condition-signal')!.value;
      const event = item.querySelector<HTMLSelectElement>('.condition-event')!
        .value as ConditionEvent;
      if (signal) conditions.push({ signal, event, delay: 0, operator: 'AND' });
    });

    const actions: Action[] = [];
    actionsList.querySelectorAll('.action-item').forEach((item) => {
      const signal = item.querySelector<HTMLSelectElement>('.action-signal')!.value;
      const value = item.querySelector<HTMLSelectElement>('.action-value')!
        .value as ActionValue;
      if (signal) actions.push({ signal, value });
    });

    if (conditions.length === 0 || actions.length === 0) {
      alert('⚠️ La regla debe tener al menos una condición y una acción');
      return;
    }

    const name = `${conditions
      .map((c) => c.signal)
      .slice(0, 2)
      .join('+')} → ${actions
      .map((a) => a.signal)
      .slice(0, 2)
      .join('+')}`;

    const rule: Rule = { id: Date.now(), name, conditions, actions };
    const block = store.blocks[store.selectedBlockIndex];
    if (!block.rules) block.rules = [];

    if (store.editingRuleIndex !== null) {
      block.rules.splice(store.editingRuleIndex, 0, rule);
      store.editingRuleIndex = null;
    } else {
      block.rules.push(rule);
    }

    syncRulesFromBlocks();
    displayRules();
    clearBuilder();
    alert('✅ Regla guardada correctamente');
  }

  // ---- Cableado de eventos ----
  blockSelector.addEventListener('change', () => {
    store.selectedBlockIndex = Number(blockSelector.value);
    displayRules();
  });
  step.querySelector('[data-action="block-new"]')!.addEventListener('click', () => {
    const name = prompt('Nombre del nuevo bloque:', `Bloque ${store.blocks.length + 1}`);
    if (!name) return;
    store.blocks.push({ name, rules: [] });
    store.selectedBlockIndex = store.blocks.length - 1;
    refreshBlockSelector();
    displayRules();
  });
  step.querySelector('[data-action="block-rename"]')!.addEventListener('click', () => {
    const name = prompt(
      'Nuevo nombre para el bloque:',
      store.blocks[store.selectedBlockIndex].name,
    );
    if (!name) return;
    store.blocks[store.selectedBlockIndex].name = name;
    refreshBlockSelector();
  });
  step.querySelector('[data-action="block-delete"]')!.addEventListener('click', () => {
    if (store.blocks.length === 1) {
      alert('No puedes borrar el último bloque.');
      return;
    }
    if (!confirm('¿Seguro que quieres borrar este bloque?')) return;
    store.blocks.splice(store.selectedBlockIndex, 1);
    store.selectedBlockIndex = 0;
    syncRulesFromBlocks();
    refreshBlockSelector();
    displayRules();
  });
  step.querySelector('[data-action="add-action"]')!.addEventListener('click', () =>
    addActionRow(),
  );
  step.querySelector('[data-action="save-rule"]')!.addEventListener('click', saveRule);
  step.querySelector('[data-action="clear"]')!.addEventListener('click', clearBuilder);
  step.querySelector('[data-action="back"]')!.addEventListener('click', () =>
    app.showStep(1),
  );
  step.querySelector('[data-action="next"]')!.addEventListener('click', () => {
    if (store.rules.length === 0) {
      alert('⚠️ Debe crear al menos una regla para continuar');
      return;
    }
    app.showStep(3);
  });

  // Estado inicial de la vista.
  refreshBlockSelector();
  clearBuilder();
  displayRules();

  return step;
}
