/** Paso 1 · Señales del sistema. */

import { commit, project, renameSignalRefs, signalUsage, allRules } from '../state/store';
import { exampleBlocks, exampleSignals } from '../data/example';
import { TYPE_HINT, derivedSignals, validateSignalName } from '../plc/signals';
import type { Signal, SignalType } from '../types';
import { confirmDialog, esc, h, icon, qs, toast } from './dom';
import type { App } from './app';

const TYPES: SignalType[] = ['Sensor', 'Motor', 'Cilindro', 'Virtual'];
const TYPE_ICON: Record<SignalType, string> = {
  Sensor: 'sensor',
  Motor: 'motor',
  Cilindro: 'cylinder',
  Virtual: 'virtual',
};

function problems(signals: Signal[]): Map<number, string> {
  const out = new Map<number, string>();
  const allNames = signals.map((s) => s.name.trim());
  const derived = new Set(derivedSignals(signals).map((d) => d.name));
  signals.forEach((s, i) => {
    const n = s.name.trim();
    const v = validateSignalName(n);
    if (v) out.set(i, v);
    else if (allNames.indexOf(n) !== i) out.set(i, `«${n}» está repetido`);
    else if (derived.has(n)) out.set(i, `«${n}» ya es el nombre de un inductivo`);
    if (s.type === 'Cilindro') {
      [s.inductivoActivo, s.inductivoReposo].forEach((ind) => {
        if (ind && allNames.includes(ind) && !out.has(i)) out.set(i, `El inductivo «${ind}» coincide con otra señal`);
      });
    }
  });
  return out;
}

export function renderSignals(app: App): HTMLElement {
  const p = project();
  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 1 de 5</p>
          <h1>Señales</h1>
          <p class="lede">Entradas, salidas y marcas que intervienen en la máquina. Cada nombre se usa como símbolo en el PLC.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--primary" data-act="add">${icon('plus', 16)}<span>Añadir señal</span></button>
        </div>
      </header>
      <div class="stats" data-slot="stats"></div>
      <section data-slot="body"></section>
      <footer class="page-foot">
        <span></span>
        <button class="btn btn--ghost" data-act="next">Continuar a Lógica ${icon('chevronRight', 16)}</button>
      </footer>
    </div>`);

  const body = qs(page, '[data-slot="body"]');
  const stats = qs(page, '[data-slot="stats"]');

  const drawStats = () => {
    const s = p.signals;
    const count = (t: SignalType) => s.filter((x) => x.type === t).length;
    const ind = derivedSignals(s).length;
    stats.innerHTML = [
      ['Sensores', count('Sensor'), 'Entradas digitales'],
      ['Motores', count('Motor'), 'Salidas digitales'],
      ['Cilindros', count('Cilindro'), `${ind} inductivo${ind === 1 ? '' : 's'}`],
      ['Virtuales', count('Virtual'), 'Marcas internas'],
    ]
      .map(
        ([l, n, d]) =>
          `<div class="stat"><span class="stat__label">${l}</span><span class="stat__value">${n}</span><span class="stat__hint">${d}</span></div>`,
      )
      .join('');
  };

  const refreshValidation = () => {
    const probs = problems(p.signals);
    body.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) => {
      const i = Number(tr.dataset.i);
      const msg = probs.get(i);
      const err = tr.querySelector<HTMLElement>('.cell-error')!;
      const input = tr.querySelector<HTMLInputElement>('[data-f="name"]')!;
      err.textContent = msg ?? '';
      err.hidden = !msg;
      input.toggleAttribute('aria-invalid', !!msg);
      const usage = signalUsage(p.signals[i].name.trim());
      tr.querySelector('.usage')!.innerHTML = usage.length
        ? `<span class="badge badge--neutral" title="${esc(usage.map((u) => `${u.block} › ${u.rule}`).join('\n'))}">${usage.length} regla${usage.length === 1 ? '' : 's'}</span>`
        : '<span class="muted">—</span>';
    });
    drawStats();
  };

  const draw = () => {
    if (!p.signals.length) {
      body.innerHTML = `
        <div class="empty">
          <div class="empty__art" aria-hidden="true">${icon('signals', 34)}</div>
          <h2>Sin señales todavía</h2>
          <p>Añade los sensores, motores, cilindros y marcas de la máquina. Para los cilindros podrás indicar sus inductivos de posición.</p>
          <div class="empty__actions">
            <button class="btn btn--primary" data-act="add">${icon('plus', 16)}<span>Añadir primera señal</span></button>
            <button class="btn btn--ghost" data-act="example">${icon('play', 16)}<span>Cargar ejemplo</span></button>
          </div>
        </div>`;
      qs(body, '[data-act="add"]').addEventListener('click', add);
      qs(body, '[data-act="example"]').addEventListener('click', loadExample);
      drawStats();
      return;
    }

    body.innerHTML = `
      <div class="card card--flush">
        <div class="table-scroll">
          <table class="table table--edit">
            <thead><tr>
              <th style="width:22%">Nombre</th>
              <th style="width:15%">Tipo</th>
              <th style="width:8%">Inicial</th>
              <th>Descripción</th>
              <th style="width:20%">Inductivos de posición</th>
              <th style="width:8%">Uso</th>
              <th class="actions"><span class="sr-only">Eliminar</span></th>
            </tr></thead>
            <tbody>
              ${p.signals
                .map(
                  (s, i) => `
                <tr data-i="${i}">
                  <td>
                    <div class="name-cell"><span class="type-ico type-ico--${s.type.toLowerCase()}">${icon(TYPE_ICON[s.type], 16)}</span>
                    <input class="input input--mono" data-f="name" value="${esc(s.name)}" placeholder="p. ej. CIL_A" spellcheck="false" aria-label="Nombre de la señal" /></div>
                    <p class="cell-error" hidden></p>
                  </td>
                  <td>
                    <select class="input" data-f="type" aria-label="Tipo">
                      ${TYPES.map((t) => `<option value="${t}"${t === s.type ? ' selected' : ''}>${t}</option>`).join('')}
                    </select>
                    <span class="cell-hint">${TYPE_HINT[s.type]}</span>
                  </td>
                  <td>
                    <button class="bit${s.initial ? ' bit--on' : ''}" data-f="initial" aria-pressed="${s.initial === 1}" title="Estado al arrancar">${s.initial}</button>
                  </td>
                  <td><input class="input" data-f="description" value="${esc(s.description)}" placeholder="Función de la señal" aria-label="Descripción" /></td>
                  <td>
                    ${
                      s.type === 'Cilindro'
                        ? `<div class="ind-pair">
                             <label><span>Ext.</span><input class="input input--mono input--sm" data-f="inductivoActivo" value="${esc(s.inductivoActivo ?? '')}" placeholder="${esc(s.name || 'CIL')}_ext" spellcheck="false" /></label>
                             <label><span>Ret.</span><input class="input input--mono input--sm" data-f="inductivoReposo" value="${esc(s.inductivoReposo ?? '')}" placeholder="${esc(s.name || 'CIL')}_ret" spellcheck="false" /></label>
                           </div>`
                        : '<span class="muted">—</span>'
                    }
                  </td>
                  <td class="usage"></td>
                  <td class="actions"><button class="icon-btn icon-btn--danger" data-f="delete" aria-label="Eliminar señal">${icon('trash', 16)}</button></td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="card__foot">
          <button class="btn btn--ghost btn--sm" data-act="add">${icon('plus', 16)}<span>Añadir señal</span></button>
          <span class="muted small">Los cambios se guardan automáticamente. Al renombrar una señal se actualizan las reglas que la usan.</span>
        </div>
      </div>`;

    qs(body, '[data-act="add"]').addEventListener('click', add);
    body.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) => bindRow(tr));
    refreshValidation();
  };

  const bindRow = (tr: HTMLTableRowElement) => {
    const i = Number(tr.dataset.i);
    const s = p.signals[i];
    let committedName = s.name.trim();

    tr.querySelectorAll<HTMLInputElement>('input[data-f]').forEach((input) => {
      const f = input.dataset.f as 'name' | 'description' | 'inductivoActivo' | 'inductivoReposo';
      input.addEventListener('input', () => {
        (s as unknown as Record<string, string>)[f] = f === 'description' ? input.value : input.value.trim();
        commit();
        refreshValidation();
      });
      if (f === 'name' || f === 'inductivoActivo' || f === 'inductivoReposo') {
        let before = input.value.trim();
        input.addEventListener('focus', () => (before = input.value.trim()));
        input.addEventListener('change', () => {
          const after = input.value.trim();
          const prev = f === 'name' ? committedName : before;
          if (prev && after && prev !== after && !validateSignalName(after)) {
            const n = renameSignalRefs(prev, after);
            if (n) toast(`«${prev}» → «${after}»: ${n} referencia${n === 1 ? '' : 's'} actualizada${n === 1 ? '' : 's'} en las reglas.`, 'info');
            commit();
          }
          if (f === 'name') committedName = after;
          before = after;
          refreshValidation();
        });
      }
    });

    qs<HTMLSelectElement>(tr, '[data-f="type"]').addEventListener('change', (e) => {
      s.type = (e.target as HTMLSelectElement).value as SignalType;
      if (s.type !== 'Cilindro') {
        delete s.inductivoActivo;
        delete s.inductivoReposo;
      }
      commit();
      draw();
    });

    qs(tr, '[data-f="initial"]').addEventListener('click', () => {
      s.initial = s.initial === 1 ? 0 : 1;
      commit();
      const b = qs(tr, '[data-f="initial"]');
      b.textContent = String(s.initial);
      b.classList.toggle('bit--on', s.initial === 1);
      b.setAttribute('aria-pressed', String(s.initial === 1));
    });

    qs(tr, '[data-f="delete"]').addEventListener('click', async () => {
      const usage = signalUsage(s.name.trim());
      if (usage.length) {
        const ok = await confirmDialog(
          'Eliminar señal en uso',
          `<strong>${esc(s.name)}</strong> se usa en ${usage.length} regla${usage.length === 1 ? '' : 's'}:</p>
           <ul class="modal__list">${usage.map((u) => `<li>${esc(u.block)} › ${esc(u.rule)}</li>`).join('')}</ul>
           <p class="modal__text">Esas reglas quedarán marcadas como incompletas hasta que las corrijas.`,
          { confirm: 'Eliminar igualmente', danger: true },
        );
        if (!ok) return;
      }
      p.signals.splice(i, 1);
      commit();
      draw();
    });
  };

  const add = () => {
    p.signals.push({ name: '', type: 'Sensor', initial: 0, description: '' });
    commit();
    draw();
    const rows = body.querySelectorAll<HTMLInputElement>('[data-f="name"]');
    rows[rows.length - 1]?.focus();
  };

  const loadExample = async () => {
    const hasRules = allRules().length > 0;
    p.signals = exampleSignals();
    if (!hasRules) p.blocks = exampleBlocks();
    commit();
    toast(hasRules ? 'Señales de ejemplo cargadas.' : 'Ejemplo cargado: señales y reglas de una estación de transferencia.');
    draw();
  };

  qs(page, '[data-act="add"]').addEventListener('click', add);
  qs(page, '[data-act="next"]').addEventListener('click', () => app.go('logic'));
  draw();
  return page;
}
