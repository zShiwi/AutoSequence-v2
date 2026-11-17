/** Paso 3 · Simulación (escenario automático o panel manual). */

import { allRules, project } from '../state/store';
import { Simulator, runAutoScenario } from '../plc/simulation';
import { cleanSignals, signalsUsedBy, actionTargets } from '../plc/signals';
import { buildRows, renderTimingDiagram } from '../diagram/timing';
import { download, esc, h, icon, qs, slug, toast } from './dom';
import { standaloneSvg } from '../diagram/ladder';
import type { App } from './app';
import type { SimStep } from '../types';

type Mode = 'auto' | 'manual';

const ui = {
  mode: 'auto' as Mode,
  arrows: true,
  filter: 'all' as string,
  sim: null as Simulator | null,
  signature: '',
};

export function renderSimulation(app: App): HTMLElement {
  const p = project();
  const signals = cleanSignals(p.signals);
  const rules = allRules();
  const signature = JSON.stringify([p.id, signals, rules]);
  if (ui.signature !== signature) {
    ui.sim = null;
    ui.signature = signature;
  }

  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 3 de 5</p>
          <h1>Simulación</h1>
          <p class="lede">Comprueba la secuencia antes de llevarla al PLC. Cada columna es un ciclo de programa; las flechas muestran qué regla provoca cada cambio.</p>
        </div>
        <div class="page-head__actions">
          <div class="segmented" role="radiogroup" aria-label="Modo de simulación">
            <button role="radio" data-mode="auto">${icon('play', 15)}Escenario automático</button>
            <button role="radio" data-mode="manual">${icon('pulse', 15)}Panel manual</button>
          </div>
        </div>
      </header>
      <section data-slot="body"></section>
      <footer class="page-foot">
        <button class="btn btn--ghost" data-act="prev">${icon('chevronLeft', 16)} Lógica</button>
        <button class="btn btn--ghost" data-act="next">Continuar a Código PLC ${icon('chevronRight', 16)}</button>
      </footer>
    </div>`);

  const body = qs(page, '[data-slot="body"]');
  qs(page, '[data-act="prev"]').addEventListener('click', () => app.go('logic'));
  qs(page, '[data-act="next"]').addEventListener('click', () => app.go('code'));

  if (!signals.length || !rules.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="empty__art" aria-hidden="true">${icon('wave', 34)}</div>
        <h2>Nada que simular todavía</h2>
        <p>La simulación necesita al menos una señal y una regla.</p>
        <div class="empty__actions">
          <button class="btn btn--primary" data-act="go">${icon(signals.length ? 'logic' : 'signals', 16)}<span>${signals.length ? 'Crear reglas' : 'Definir señales'}</span></button>
        </div>
      </div>`;
    qs(body, '[data-act="go"]').addEventListener('click', () => app.go(signals.length ? 'logic' : 'signals'));
    page.querySelector('.segmented')?.remove();
    return page;
  }

  const ensureSim = (): Simulator => {
    if (!ui.sim) ui.sim = ui.mode === 'auto' ? runAutoScenario(signals, rules) : new Simulator(signals, rules);
    return ui.sim;
  };

  const filterRows = () => {
    if (ui.filter === 'all') return buildRows(signals, rules);
    const block = p.blocks[Number(ui.filter)];
    return buildRows(signals, rules, signalsUsedBy(block?.rules ?? []));
  };

  const draw = () => {
    const sim = ensureSim();
    page.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === ui.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });

    const inputs = sim.inputs();
    const targets = actionTargets(rules);
    const outputs = signals.filter((s) => targets.has(s.name));
    const last = sim.history[sim.history.length - 1];

    body.innerHTML = `
      ${sim.warnings.map((w) => `<div class="callout callout--warn">${icon('alert', 18)}<p>${esc(w)}</p></div>`).join('')}
      ${
        ui.mode === 'manual'
          ? `<div class="panel-grid">
              <div class="card">
                <div class="card__head"><h2>Entradas</h2><span class="muted small">Pulsa para cambiar su estado</span></div>
                <div class="io-grid">${
                  inputs.length
                    ? inputs
                        .map((n) => {
                          const on = sim.states[n] === 1;
                          return `<div class="io io--input${on ? ' is-on' : ''}">
                              <button class="io__switch" data-toggle="${esc(n)}" aria-pressed="${on}"><span class="lamp"></span><code>${esc(n)}</code><span class="io__val">${on ? 1 : 0}</span></button>
                              <button class="icon-btn" data-pulse="${esc(n)}" title="Pulso (${on ? '1→0→1' : '0→1→0'})" aria-label="Pulso en ${esc(n)}">${icon('pulse', 16)}</button>
                            </div>`;
                        })
                        .join('')
                    : '<p class="muted small">Todas las señales las escriben reglas: no hay entradas libres.</p>'
                }</div>
              </div>
              <div class="card">
                <div class="card__head"><h2>Salidas y marcas</h2><span class="muted small">Ciclo ${last.time}</span></div>
                <div class="io-grid">${outputs
                  .map((s) => {
                    const on = sim.states[s.name] === 1;
                    return `<div class="io io--output${on ? ' is-on' : ''}"><span class="lamp"></span><code>${esc(s.name)}</code><span class="io__val">${on ? 1 : 0}</span></div>`;
                  })
                  .join('')}</div>
              </div>
            </div>`
          : ''
      }
      <div class="card card--flush">
        <div class="toolbar">
          <label class="toolbar__field">Mostrar
            <select class="input input--sm" data-act="filter">
              <option value="all">Todas las señales</option>
              ${p.blocks.map((b, i) => `<option value="${i}"${String(i) === ui.filter ? ' selected' : ''}>Bloque: ${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <label class="check"><input type="checkbox" data-act="arrows"${ui.arrows ? ' checked' : ''}/> Flechas causa → efecto</label>
          <span class="toolbar__spacer"></span>
          <div class="legend" aria-label="Leyenda">
            <span class="legend__item legend__item--in">Entrada</span>
            <span class="legend__item legend__item--out">Salida</span>
            <span class="legend__item legend__item--mark">Marca</span>
            <span class="legend__item legend__item--derived">Inductivo</span>
          </div>
          <button class="btn btn--ghost btn--sm" data-act="svg" title="Descargar el cronograma como imagen SVG">${icon('download', 15)}<span>SVG</span></button>
          <button class="btn btn--ghost btn--sm" data-act="reset">${icon('reset', 15)}<span>${ui.mode === 'auto' ? 'Recalcular' : 'Reiniciar'}</span></button>
        </div>
        <div class="diagram-scroll" data-slot="diagram">${renderTimingDiagram(filterRows(), sim.history, {
          arrows: ui.arrows,
          highlightStep: ui.mode === 'manual' ? sim.history.length - 1 : undefined,
        })}</div>
      </div>
      <details class="card log"${ui.mode === 'manual' ? ' open' : ''}>
        <summary><h2>Registro de ciclos</h2><span class="muted small">${countActivations(sim.history)} disparos de regla en ${sim.history.length} ciclos</span></summary>
        ${logTable(sim.history)}
      </details>`;

    const scroll = body.querySelector<HTMLElement>('[data-slot="diagram"]');
    if (scroll && ui.mode === 'manual') scroll.scrollLeft = scroll.scrollWidth;
  };

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sim = ensureSim();
    const tog = t.closest<HTMLElement>('[data-toggle]')?.dataset.toggle;
    const pulse = t.closest<HTMLElement>('[data-pulse]')?.dataset.pulse;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (tog) {
      sim.apply([{ signal: tog, value: sim.states[tog] === 1 ? 0 : 1 }], 'Manual');
    } else if (pulse) {
      const v = sim.states[pulse];
      sim.apply([{ signal: pulse, value: v === 1 ? 0 : 1 }], 'Pulso');
      sim.apply([{ signal: pulse, value: v }], 'Pulso');
    } else if (act === 'reset') {
      ui.sim = null;
      toast(ui.mode === 'auto' ? 'Escenario recalculado.' : 'Simulación reiniciada al estado inicial.', 'info');
    } else if (act === 'svg') {
      const svg = body.querySelector('[data-slot="diagram"] svg');
      if (svg) void download(`${slug(p.name)}-cronograma.svg`, standaloneSvg(svg.outerHTML), 'image/svg+xml');
      return;
    } else return;
    draw();
  });
  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'filter') ui.filter = t.value;
    else if (t.dataset.act === 'arrows') ui.arrows = t.checked;
    else return;
    draw();
  });
  page.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.mode as Mode;
      if (m === ui.mode) return;
      ui.mode = m;
      ui.sim = null;
      draw();
    }),
  );

  draw();
  return page;
}

function countActivations(history: SimStep[]): number {
  return history.reduce((n, s) => n + s.activations.length, 0);
}

function logTable(history: SimStep[]): string {
  const rows = history.filter((s) => s.events.length || s.activations.length);
  if (!rows.length) return '<p class="muted small log__empty">Todavía no ha ocurrido nada. Cambia una entrada para empezar.</p>';
  return `<div class="table-scroll"><table class="table table--log">
    <thead><tr><th class="num">Ciclo</th><th>Cambio externo</th><th>Regla disparada</th><th>Efecto</th></tr></thead>
    <tbody>${rows
      .map((s) => {
        const ev = s.events.map((e) => `<code>${esc(e.signal)}</code> ${e.fromValue}→${e.value}`).join('<br>') || '<span class="muted">—</span>';
        const byRule = new Map<string, string[]>();
        s.activations.forEach((a) => {
          const list = byRule.get(a.ruleName) ?? [];
          list.push(`<code>${esc(a.targetSignal)}</code> ${a.fromValue}→${a.toValue}`);
          byRule.set(a.ruleName, list);
        });
        const rulesHtml = [...byRule.keys()].map((r) => esc(r)).join('<br>') || '<span class="muted">—</span>';
        const fx = [...byRule.values()].map((l) => l.join(', ')).join('<br>') || '<span class="muted">—</span>';
        return `<tr><td class="num mono">${s.time}</td><td>${ev}</td><td>${rulesHtml}</td><td>${fx}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}
