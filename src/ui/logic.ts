/** Paso 2 · Lógica: bloques y reglas SI/ENTONCES. */

import { commit, project, allRules } from '../state/store';
import { allSignalNames, cleanSignals, derivedSignals, isActuatorType } from '../plc/signals';
import type { Action, ActionValue, Condition, ConditionEvent, Rule } from '../types';
import { confirmDialog, esc, h, icon, modal, promptDialog, qs, toast } from './dom';
import type { App } from './app';

const EVENTS: { v: ConditionEvent; label: string; chip: string }[] = [
  { v: '==1', label: '= 1  (activa)', chip: '= 1' },
  { v: '==0', label: '= 0  (inactiva)', chip: '= 0' },
  { v: 'Flanco ascendente', label: '↑  Flanco ascendente (0→1)', chip: '↑' },
  { v: 'Flanco descendente', label: '↓  Flanco descendente (1→0)', chip: '↓' },
];
const VALUES: { v: ActionValue; label: string; chip: string }[] = [
  { v: '1', label: 'SET  (poner a 1)', chip: 'SET' },
  { v: '0', label: 'RESET  (poner a 0)', chip: 'RESET' },
  { v: 'toggle', label: 'Alternar', chip: 'ALT' },
];

let activeBlock = 0;

function autoName(r: Pick<Rule, 'conditions' | 'actions'>): string {
  const c = r.conditions.map((x) => x.signal).filter(Boolean).slice(0, 2).join(' + ');
  const a = r.actions.map((x) => x.signal).filter(Boolean).slice(0, 2).join(' + ');
  return `${c || '…'} → ${a || '…'}`;
}

function condChip(c: Condition, known: Set<string>): string {
  const ev = EVENTS.find((e) => e.v === c.event);
  const missing = !known.has(c.signal);
  return `<span class="chip chip--cond${missing ? ' chip--missing' : ''}"${missing ? ' title="Esta señal no existe"' : ''}><code>${esc(c.signal || '?')}</code><b>${ev?.chip ?? c.event}</b></span>`;
}

function actChip(a: Action, known: Set<string>): string {
  const v = VALUES.find((x) => x.v === a.value);
  const missing = !known.has(a.signal);
  return `<span class="chip chip--act chip--${a.value === '1' ? 'set' : a.value === '0' ? 'reset' : 'toggle'}${missing ? ' chip--missing' : ''}"${missing ? ' title="Esta señal no existe"' : ''}><b>${v?.chip ?? a.value}</b><code>${esc(a.signal || '?')}</code></span>`;
}

export function renderLogic(app: App): HTMLElement {
  const p = project();
  if (activeBlock >= p.blocks.length) activeBlock = 0;

  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 2 de 5</p>
          <h1>Lógica</h1>
          <p class="lede">Reglas del tipo <em>SI se cumplen todas las condiciones ENTONCES ejecutar las acciones</em>, agrupadas en bloques funcionales. Se evalúan en orden, de arriba abajo.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--primary" data-act="new">${icon('plus', 16)}<span>Nueva regla</span></button>
        </div>
      </header>
      <div class="tabs-bar">
        <div class="tabs" role="tablist" data-slot="tabs"></div>
        <div class="tabs-bar__tools" data-slot="blocktools"></div>
      </div>
      <section data-slot="rules"></section>
      <footer class="page-foot">
        <button class="btn btn--ghost" data-act="prev">${icon('chevronLeft', 16)} Señales</button>
        <button class="btn btn--ghost" data-act="next">Continuar a Simulación ${icon('chevronRight', 16)}</button>
      </footer>
    </div>`);

  const tabs = qs(page, '[data-slot="tabs"]');
  const tools = qs(page, '[data-slot="blocktools"]');
  const list = qs(page, '[data-slot="rules"]');

  const draw = () => {
    const known = new Set(allSignalNames(cleanSignals(p.signals)));
    tabs.innerHTML = p.blocks
      .map(
        (b, i) =>
          `<button role="tab" class="tab${i === activeBlock ? ' is-active' : ''}" aria-selected="${i === activeBlock}" data-i="${i}">${esc(b.name)}<span class="tab__count">${b.rules.length}</span></button>`,
      )
      .join('');
    tools.innerHTML = `
      <button class="btn btn--ghost btn--sm" data-act="block-new">${icon('plus', 15)}<span>Bloque</span></button>
      <button class="icon-btn" data-act="block-rename" title="Renombrar bloque" aria-label="Renombrar bloque">${icon('edit', 16)}</button>
      <button class="icon-btn icon-btn--danger" data-act="block-delete" title="Eliminar bloque" aria-label="Eliminar bloque"${p.blocks.length < 2 ? ' disabled' : ''}>${icon('trash', 16)}</button>`;

    const block = p.blocks[activeBlock];
    if (!block.rules.length) {
      list.innerHTML = `
        <div class="empty empty--compact">
          <div class="empty__art" aria-hidden="true">${icon('logic', 30)}</div>
          <h2>El bloque «${esc(block.name)}» no tiene reglas</h2>
          <p>${p.signals.length ? 'Crea la primera regla: elige qué señales deben cumplirse y qué salidas se activan.' : 'Antes de crear reglas, define las señales de la máquina.'}</p>
          <div class="empty__actions">
            ${p.signals.length ? `<button class="btn btn--primary" data-act="new">${icon('plus', 16)}<span>Nueva regla</span></button>` : `<button class="btn btn--primary" data-act="to-signals">${icon('signals', 16)}<span>Ir a Señales</span></button>`}
          </div>
        </div>`;
    } else {
      list.innerHTML = `<ol class="rules">${block.rules
        .map((r, i) => {
          const missing =
            r.conditions.some((c) => !known.has(c.signal)) || r.actions.some((a) => !known.has(a.signal));
          return `
          <li class="rule${missing ? ' rule--warn' : ''}" data-i="${i}">
            <div class="rule__num">${i + 1}</div>
            <div class="rule__main">
              <div class="rule__title">${esc(r.name)}${missing ? `<span class="badge badge--warn">${icon('alert', 13)}Señal inexistente</span>` : ''}</div>
              <div class="rule__logic">
                <span class="kw">SI</span>
                ${r.conditions.map((c) => condChip(c, known)).join('<span class="kw kw--and">Y</span>')}
                <span class="kw kw--then">${icon('chevronRight', 14)} ENTONCES</span>
                ${r.actions.map((a) => actChip(a, known)).join('')}
              </div>
            </div>
            <div class="rule__tools">
              <button class="icon-btn" data-r="up" title="Subir" aria-label="Subir regla"${i === 0 ? ' disabled' : ''}>${icon('arrowUp', 16)}</button>
              <button class="icon-btn" data-r="down" title="Bajar" aria-label="Bajar regla"${i === block.rules.length - 1 ? ' disabled' : ''}>${icon('arrowDown', 16)}</button>
              <button class="icon-btn" data-r="dup" title="Duplicar" aria-label="Duplicar regla">${icon('duplicate', 16)}</button>
              <button class="icon-btn" data-r="edit" title="Editar" aria-label="Editar regla">${icon('edit', 16)}</button>
              <button class="icon-btn icon-btn--danger" data-r="del" title="Eliminar" aria-label="Eliminar regla">${icon('trash', 16)}</button>
            </div>
          </li>`;
        })
        .join('')}</ol>`;
    }

    list.querySelector('[data-act="new"]')?.addEventListener('click', () => openEditor());
    list.querySelector('[data-act="to-signals"]')?.addEventListener('click', () => app.go('signals'));
  };

  // ---- Eventos ------------------------------------------------------------

  tabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!t) return;
    activeBlock = Number(t.dataset.i);
    draw();
  });

  tools.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'block-new') {
      const name = await promptDialog('Nuevo bloque', 'Nombre del bloque', `Bloque ${p.blocks.length + 1}`, {
        confirm: 'Crear bloque',
        hint: 'Un bloque agrupa reglas de una misma función (p. ej. «Secuencia», «Seguridad»). Cada bloque genera una hoja de documentación.',
      });
      if (!name) return;
      p.blocks.push({ name, rules: [] });
      activeBlock = p.blocks.length - 1;
      commit();
      draw();
    } else if (act === 'block-rename') {
      const b = p.blocks[activeBlock];
      const name = await promptDialog('Renombrar bloque', 'Nombre del bloque', b.name);
      if (!name) return;
      b.name = name;
      commit();
      draw();
    } else if (act === 'block-delete') {
      const b = p.blocks[activeBlock];
      if (p.blocks.length < 2) return;
      const ok = await confirmDialog(
        'Eliminar bloque',
        `Se eliminará el bloque <strong>${esc(b.name)}</strong>${b.rules.length ? ` y sus ${b.rules.length} regla${b.rules.length === 1 ? '' : 's'}` : ''}.`,
        { confirm: 'Eliminar bloque', danger: true },
      );
      if (!ok) return;
      p.blocks.splice(activeBlock, 1);
      activeBlock = Math.max(0, activeBlock - 1);
      commit();
      draw();
    }
  });

  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!btn) return;
    const i = Number(btn.closest<HTMLElement>('[data-i]')!.dataset.i);
    const rules = p.blocks[activeBlock].rules;
    switch (btn.dataset.r) {
      case 'up':
        [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
        break;
      case 'down':
        [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
        break;
      case 'dup': {
        const copy: Rule = JSON.parse(JSON.stringify(rules[i]));
        copy.id = Date.now();
        copy.name = `${copy.name} (copia)`;
        rules.splice(i + 1, 0, copy);
        toast('Regla duplicada.');
        break;
      }
      case 'edit':
        return openEditor(i);
      case 'del': {
        const ok = await confirmDialog('Eliminar regla', `¿Eliminar la regla <strong>${esc(rules[i].name)}</strong>?`, {
          confirm: 'Eliminar',
          danger: true,
        });
        if (!ok) return;
        rules.splice(i, 1);
        toast('Regla eliminada.');
        break;
      }
    }
    commit();
    draw();
  });

  // ---- Editor de reglas ---------------------------------------------------

  const openEditor = (index?: number) => {
    const signals = cleanSignals(p.signals);
    if (!signals.length) {
      toast('Primero define al menos una señal.', 'warn');
      return app.go('signals');
    }
    const block = p.blocks[activeBlock];
    const original = index !== undefined ? block.rules[index] : undefined;
    const draft: Rule = original
      ? JSON.parse(JSON.stringify(original))
      : {
          id: Date.now(),
          name: '',
          conditions: [{ signal: '', event: '==1', delay: 0, operator: 'AND' }],
          actions: [{ signal: '', value: '1' }],
        };
    const customName = !!original && original.name !== autoName(original);
    if (!customName) draft.name = '';

    const derived = derivedSignals(signals);
    const condOptions = (sel: string) => {
      const group = (label: string, names: string[]) =>
        names.length
          ? `<optgroup label="${label}">${names.map((n) => `<option value="${esc(n)}"${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`
          : '';
      const known = new Set([...signals.map((s) => s.name), ...derived.map((d) => d.name)]);
      return (
        `<option value="">Elegir señal…</option>` +
        (sel && !known.has(sel) ? `<option value="${esc(sel)}" selected>${esc(sel)} (no existe)</option>` : '') +
        group('Sensores', signals.filter((s) => s.type === 'Sensor').map((s) => s.name)) +
        group('Inductivos', derived.map((d) => d.name)) +
        group('Salidas', signals.filter((s) => s.type === 'Motor' || s.type === 'Cilindro').map((s) => s.name)) +
        group('Marcas', signals.filter((s) => s.type === 'Virtual').map((s) => s.name))
      );
    };
    const actOptions = (sel: string) => {
      const acts = signals.filter((s) => isActuatorType(s.type));
      return (
        `<option value="">Elegir salida o marca…</option>` +
        (sel && !acts.some((a) => a.name === sel) ? `<option value="${esc(sel)}" selected>${esc(sel)} (no válida)</option>` : '') +
        acts.map((s) => `<option value="${esc(s.name)}"${s.name === sel ? ' selected' : ''}>${esc(s.name)} · ${s.type}</option>`).join('')
      );
    };

    const form = h(`
      <form class="editor" novalidate>
        <div class="field">
          <label class="field__label" for="rule-name">Nombre de la regla <span class="muted">(opcional)</span></label>
          <input id="rule-name" class="input" data-slot="name" value="${esc(draft.name)}" placeholder="Se genera a partir de las señales" />
        </div>
        <fieldset class="editor__group">
          <legend><span class="kw">SI</span> se cumplen todas estas condiciones</legend>
          <div data-slot="conds" class="editor__rows"></div>
          <button type="button" class="btn btn--ghost btn--sm" data-act="add-cond">${icon('plus', 15)}<span>Añadir condición</span></button>
        </fieldset>
        <fieldset class="editor__group">
          <legend><span class="kw kw--then">ENTONCES</span> ejecutar estas acciones</legend>
          <div data-slot="acts" class="editor__rows"></div>
          <button type="button" class="btn btn--ghost btn--sm" data-act="add-act">${icon('plus', 15)}<span>Añadir acción</span></button>
        </fieldset>
        <div class="editor__preview"><span class="eyebrow">Vista previa</span><div data-slot="preview" class="rule__logic"></div></div>
        <p class="field__error" data-slot="error" hidden></p>
      </form>`);

    const conds = qs(form, '[data-slot="conds"]');
    const acts = qs(form, '[data-slot="acts"]');
    const preview = qs(form, '[data-slot="preview"]');
    const nameInput = qs<HTMLInputElement>(form, '[data-slot="name"]');
    const err = qs(form, '[data-slot="error"]');

    const updatePreview = () => {
      const known = new Set(allSignalNames(signals));
      preview.innerHTML = `<span class="kw">SI</span>${draft.conditions
        .filter((c) => c.signal)
        .map((c) => condChip(c, known))
        .join('<span class="kw kw--and">Y</span>') || '<span class="muted">…</span>'}<span class="kw kw--then">${icon('chevronRight', 14)} ENTONCES</span>${draft.actions
        .filter((a) => a.signal)
        .map((a) => actChip(a, known))
        .join('') || '<span class="muted">…</span>'}`;
      nameInput.placeholder = autoName(draft);
    };

    const drawRows = () => {
      conds.innerHTML = draft.conditions
        .map(
          (c, i) => `
          <div class="editor__row" data-i="${i}">
            <span class="editor__join">${i === 0 ? '' : 'Y'}</span>
            <select class="input input--mono" data-c="signal" aria-label="Señal">${condOptions(c.signal)}</select>
            <select class="input" data-c="event" aria-label="Condición">${EVENTS.map((e) => `<option value="${e.v}"${e.v === c.event ? ' selected' : ''}>${e.label}</option>`).join('')}</select>
            <button type="button" class="icon-btn icon-btn--danger" data-c="del" aria-label="Quitar condición"${draft.conditions.length < 2 ? ' disabled' : ''}>${icon('x', 16)}</button>
          </div>`,
        )
        .join('');
      acts.innerHTML = draft.actions
        .map(
          (a, i) => `
          <div class="editor__row" data-i="${i}">
            <span class="editor__join"></span>
            <select class="input input--mono" data-a="signal" aria-label="Salida">${actOptions(a.signal)}</select>
            <select class="input" data-a="value" aria-label="Acción">${VALUES.map((v) => `<option value="${v.v}"${v.v === a.value ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
            <button type="button" class="icon-btn icon-btn--danger" data-a="del" aria-label="Quitar acción"${draft.actions.length < 2 ? ' disabled' : ''}>${icon('x', 16)}</button>
          </div>`,
        )
        .join('');
      updatePreview();
    };

    form.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      const row = t.closest<HTMLElement>('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (t.dataset.c === 'signal') draft.conditions[i].signal = t.value;
      if (t.dataset.c === 'event') draft.conditions[i].event = t.value as ConditionEvent;
      if (t.dataset.a === 'signal') draft.actions[i].signal = t.value;
      if (t.dataset.a === 'value') draft.actions[i].value = t.value as ActionValue;
      updatePreview();
    });
    form.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      const row = b.closest<HTMLElement>('[data-i]');
      if (b.dataset.act === 'add-cond') draft.conditions.push({ signal: '', event: '==1', delay: 0, operator: 'AND' });
      else if (b.dataset.act === 'add-act') draft.actions.push({ signal: '', value: '1' });
      else if (b.dataset.c === 'del' && row) draft.conditions.splice(Number(row.dataset.i), 1);
      else if (b.dataset.a === 'del' && row) draft.actions.splice(Number(row.dataset.i), 1);
      else return;
      drawRows();
    });
    nameInput.addEventListener('input', updatePreview);

    const save = (): boolean => {
      const cs = draft.conditions.filter((c) => c.signal);
      const as = draft.actions.filter((a) => a.signal);
      const targets = as.map((a) => a.signal);
      let problem = '';
      if (!cs.length) problem = 'Añade al menos una condición con su señal.';
      else if (!as.length) problem = 'Añade al menos una acción con su señal.';
      else if (new Set(targets).size !== targets.length) problem = 'Una misma salida aparece en dos acciones de la regla.';
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        return false;
      }
      const rule: Rule = {
        id: original?.id ?? Date.now(),
        conditions: cs.map((c) => ({ ...c, delay: 0, operator: 'AND' })),
        actions: as,
        name: nameInput.value.trim() || autoName({ conditions: cs, actions: as }),
      };
      if (index !== undefined) block.rules[index] = rule;
      else block.rules.push(rule);
      commit();
      draw();
      toast(index !== undefined ? 'Regla actualizada.' : 'Regla creada.');
      return true;
    };

    form.addEventListener('submit', (e) => e.preventDefault());
    drawRows();
    modal({
      title: original ? 'Editar regla' : `Nueva regla · ${block.name}`,
      body: form,
      wide: true,
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        { label: original ? 'Guardar cambios' : 'Crear regla', variant: 'primary', run: save },
      ],
    });
  };

  qs(page, '[data-act="new"]').addEventListener('click', () => openEditor());
  qs(page, '[data-act="prev"]').addEventListener('click', () => app.go('signals'));
  qs(page, '[data-act="next"]').addEventListener('click', () => {
    if (!allRules().length) return toast('Crea al menos una regla para simular.', 'warn');
    app.go('sim');
  });

  draw();
  return page;
}
