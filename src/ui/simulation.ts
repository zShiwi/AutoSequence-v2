/** Paso 3 · Simulación (escenario automático o panel manual). */

import { allRules, project } from '../state/store';
import { Simulator, runAutoScenario } from '../plc/simulation';
import { cleanSignals, signalsUsedBy, actionTargets } from '../plc/signals';
import { buildRows, renderTimingDiagram } from '../diagram/timing';
import { download, esc, h, icon, qs, slug, toast } from './dom';
import { standaloneSvg } from '../diagram/ladder';
import { ruleLabeler, type RuleLabeler } from '../plc/rules';
import type { WaveRow } from '../diagram/wave';
import type { App } from './app';
import { renderPlant } from './plant';
import { watchScrollEdges } from './scrolledges';
import type { SimStep } from '../types';

type Mode = 'auto' | 'manual' | 'plant';

/**
 * Qué se muestra:
 *  - `blocks`: un cronograma por bloque (por defecto; como las hojas de un
 *    ciclograma, cada zona en su diagrama).
 *  - `all`: todas las señales en un único cronograma.
 *  - `<n>`: solo el bloque n.
 */
type Filter = 'blocks' | 'all' | `${number}`;

const ui = {
  mode: 'auto' as Mode,
  allLinks: false,
  filter: 'blocks' as Filter,
  sim: null as Simulator | null,
  blockSims: new Map<number, Simulator>(),
  signature: '',
};

interface View {
  key: string;
  title: string;
  subtitle: string;
  rows: WaveRow[];
  history: SimStep[];
}

export function renderSimulation(app: App): HTMLElement {
  const p = project();
  const signals = cleanSignals(p.signals);
  const rules = allRules();
  const ruleLabel = ruleLabeler(p.blocks);
  const signature = JSON.stringify([p.id, signals, rules]);
  if (ui.signature !== signature) {
    ui.sim = null;
    ui.blockSims.clear();
    ui.signature = signature;
    if (ui.filter !== 'blocks' && ui.filter !== 'all' && !p.blocks[Number(ui.filter)]) ui.filter = 'blocks';
  }

  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 3 de 5</p>
          <h1>Simulación</h1>
          <p class="lede">Comprueba la secuencia antes de llevarla al PLC. Cada columna es un ciclo de programa; cada etiqueta indica qué regla provoca el cambio.</p>
        </div>
        <div class="page-head__actions">
          <div class="segmented" role="radiogroup" aria-label="Modo de simulación">
            <button role="radio" data-mode="auto" aria-label="Escenario automático">${icon('play', 15)}<span class="lbl-long">Escenario automático</span><span class="lbl-short">Auto</span></button>
            <button role="radio" data-mode="manual" aria-label="Panel manual">${icon('pulse', 15)}<span class="lbl-long">Panel manual</span><span class="lbl-short">Manual</span></button>
            <button role="radio" data-mode="plant" aria-label="Transportador">${icon('conveyor', 15)}<span class="lbl-long">Transportador</span><span class="lbl-short">Transp.</span></button>
          </div>
        </div>
      </header>
      <section data-slot="body" class="sim-body"></section>
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

  /** Simulación global (panel manual y vista «todo junto»). */
  const globalSim = (): Simulator => {
    if (!ui.sim) ui.sim = ui.mode === 'auto' ? runAutoScenario(signals, rules) : new Simulator(signals, rules);
    return ui.sim;
  };

  /** Escenario automático propio de un bloque, como en su hoja de documentación. */
  const blockSim = (i: number): Simulator => {
    let s = ui.blockSims.get(i);
    if (!s) {
      s = runAutoScenario(signals, p.blocks[i].rules, 16);
      ui.blockSims.set(i, s);
    }
    return s;
  };

  const blockRows = (i: number) => buildRows(signals, rules, signalsUsedBy(p.blocks[i].rules));

  const views = (): { views: View[]; warnings: string[] } => {
    const blockIdx = p.blocks.map((b, i) => (b.rules.length ? i : -1)).filter((i) => i >= 0);
    const sub = (i: number, rows: WaveRow[]) =>
      `${p.blocks[i].rules.length} regla${p.blocks[i].rules.length === 1 ? '' : 's'} · ${rows.length} señales`;

    if (ui.filter === 'all') {
      const sim = globalSim();
      const rows = buildRows(signals, rules);
      return {
        views: [{ key: 'all', title: 'Todas las señales', subtitle: `${rules.length} reglas · ${rows.length} señales`, rows, history: sim.history }],
        warnings: sim.warnings,
      };
    }
    const indices = ui.filter === 'blocks' ? blockIdx : [Number(ui.filter)];
    if (ui.mode === 'manual') {
      const sim = globalSim();
      return {
        views: indices.map((i) => {
          const rows = blockRows(i);
          return { key: String(i), title: p.blocks[i].name, subtitle: sub(i, rows), rows, history: sim.history };
        }),
        warnings: sim.warnings,
      };
    }
    const warnings = new Set<string>();
    const vs = indices.map((i) => {
      const sim = blockSim(i);
      sim.warnings.forEach((w) => warnings.add(w));
      const rows = blockRows(i);
      return { key: String(i), title: p.blocks[i].name, subtitle: sub(i, rows), rows, history: sim.history };
    });
    return { views: vs, warnings: [...warnings] };
  };

  const draw = () => {
    page.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === ui.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });

    if (ui.mode === 'plant') {
      body.innerHTML = '';
      body.appendChild(renderPlant(app));
      return;
    }

    const { views: list, warnings } = views();
    const manual = ui.mode === 'manual';
    const sim = manual ? globalSim() : null;
    const separate = list.length > 1;

    body.innerHTML = `
      ${warnings.map((w) => `<div class="callout callout--warn">${icon('alert', 18)}<p>${esc(w)}</p></div>`).join('')}
      ${sim ? panelsHtml(sim, signals, rules) : ''}
      <div class="card card--flush sim-controls">
        <div class="toolbar">
          <label class="toolbar__field">Mostrar
            <select class="input input--sm" data-act="filter">
              <option value="blocks"${ui.filter === 'blocks' ? ' selected' : ''}>Por bloques (separado)</option>
              <option value="all"${ui.filter === 'all' ? ' selected' : ''}>Todas las señales juntas</option>
              ${p.blocks.map((b, i) => `<option value="${i}"${String(i) === ui.filter ? ' selected' : ''}>Solo: ${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <label class="check" title="Sin marcar, la relación de cada regla aparece al señalar su etiqueta"><input type="checkbox" data-act="links"${ui.allLinks ? ' checked' : ''}/> Mostrar todas las relaciones</label>
          <span class="toolbar__spacer"></span>
          <div class="legend" aria-label="Leyenda">
            <span class="legend__item legend__item--in">Entrada</span>
            <span class="legend__item legend__item--out">Salida</span>
            <span class="legend__item legend__item--mark">Marca</span>
            <span class="legend__item legend__item--derived">Inductivo</span>
            <span class="legend__tag"><span class="fx-chip">R1</span>Regla que provoca el cambio</span>
          </div>
          <button class="btn btn--ghost btn--sm" data-act="reset">${icon('reset', 15)}<span>${manual ? 'Reiniciar' : 'Recalcular'}</span></button>
        </div>
        ${separate ? `<nav class="sim-index" aria-label="Diagramas">${list.map((v, n) => `<a href="#sim-${esc(v.key)}" data-jump="${esc(v.key)}"><span class="sim-index__num">${n + 1}</span>${esc(v.title)}</a>`).join('')}</nav>` : ''}
      </div>
      ${list
        .map(
          (v, n) => `
        <section class="card card--flush sim-view" id="sim-${esc(v.key)}">
          <header class="sim-view__head">
            ${separate ? `<span class="sim-view__num">${n + 1}</span>` : ''}
            <div><h2>${esc(v.title)}</h2><span class="muted small">${esc(v.subtitle)}${manual ? '' : ` · ${v.history.length} ciclos`}</span></div>
            <button class="btn btn--ghost btn--sm" data-svg="${n}" title="Descargar este cronograma como imagen SVG">${icon('download', 15)}<span>SVG</span></button>
          </header>
          <div class="diagram-scroll" data-diagram="${n}">${renderTimingDiagram(v.rows, v.history, {
            links: ui.allLinks ? 'all' : 'hover',
            ruleLabel,
            highlightStep: manual ? v.history.length - 1 : undefined,
            compact: window.innerWidth <= 640,
          })}<div class="fx-tip" role="tooltip" hidden></div></div>
          ${
            manual
              ? ''
              : `<details class="log log--inline"><summary><h3>Registro de ciclos</h3><span class="muted small">${countActivations(v.history)} cambios provocados por reglas</span></summary>${logTable(v.history, ruleLabel)}</details>`
          }
        </section>`,
        )
        .join('')}
      ${
        sim
          ? `<details class="card log" open>
              <summary><h2>Registro de ciclos</h2><span class="muted small">${countActivations(sim.history)} cambios provocados por reglas en ${sim.history.length} ciclos</span></summary>
              ${logTable(sim.history, ruleLabel)}
            </details>`
          : ''
      }`;

    if (manual) {
      body.querySelectorAll<HTMLElement>('.diagram-scroll').forEach((s) => (s.scrollLeft = s.scrollWidth));
    }
    watchScrollEdges(body, '.diagram-scroll');
    // Guardar las vistas para la descarga SVG.
    lastViews = list;
  };
  let lastViews: View[] = [];

  // Ficha y línea de relación al señalar la etiqueta de una regla.
  const showFx = (tag: SVGGElement | null) => {
    body.querySelectorAll('.fx-tag.is-active, .fx-link.is-active').forEach((n) => n.classList.remove('is-active'));
    body.querySelectorAll<HTMLElement>('.fx-tip').forEach((t) => (t.hidden = true));
    if (!tag) return;
    const host = tag.closest<HTMLElement>('.diagram-scroll');
    const tip = host?.querySelector<HTMLElement>('.fx-tip');
    if (!host || !tip) return;
    const k = tag.dataset.fx;
    tag.classList.add('is-active');
    host.querySelector(`.fx-link[data-fx="${k}"]`)?.classList.add('is-active');
    tip.innerHTML = `<strong>${tag.dataset.tipTitle ?? ''}</strong><span>${tag.dataset.tipBody ?? ''}</span>`;
    tip.hidden = false;
    // A la derecha de la etiqueta: la causa siempre queda a la izquierda
    // (ocurre antes o en el mismo ciclo), así la ficha no tapa la línea.
    const r = tag.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const right = r.right - hr.left + host.scrollLeft + 10;
    const midY = r.top - hr.top + host.scrollTop + r.height / 2;
    const fitsRight = right + tip.offsetWidth < host.scrollWidth - 4;
    const left = fitsRight ? right : r.left - hr.left + host.scrollLeft - tip.offsetWidth - 10;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, midY - tip.offsetHeight / 2)}px`;
  };
  body.addEventListener('mouseover', (e) => showFx((e.target as Element).closest<SVGGElement>('.fx-tag')));
  body.addEventListener('focusin', (e) => showFx((e.target as Element).closest<SVGGElement>('.fx-tag')));

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tog = t.closest<HTMLElement>('[data-toggle]')?.dataset.toggle;
    const pulse = t.closest<HTMLElement>('[data-pulse]')?.dataset.pulse;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const svgIdx = t.closest<HTMLElement>('[data-svg]')?.dataset.svg;
    const jump = t.closest<HTMLElement>('[data-jump]')?.dataset.jump;
    if (jump !== undefined) {
      e.preventDefault();
      body.querySelector(`#sim-${CSS.escape(jump)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (svgIdx !== undefined) {
      const svg = body.querySelector(`[data-diagram="${svgIdx}"] svg`);
      const v = lastViews[Number(svgIdx)];
      if (svg && v) void download(`${slug(p.name)}-${slug(v.title)}-cronograma.svg`, standaloneSvg(svg.outerHTML), 'image/svg+xml');
      return;
    }
    if (tog) {
      const sim = globalSim();
      sim.apply([{ signal: tog, value: sim.states[tog] === 1 ? 0 : 1 }], 'Manual');
    } else if (pulse) {
      const sim = globalSim();
      const v = sim.states[pulse];
      sim.apply([{ signal: pulse, value: v === 1 ? 0 : 1 }], 'Pulso');
      sim.apply([{ signal: pulse, value: v }], 'Pulso');
    } else if (act === 'reset') {
      ui.sim = null;
      ui.blockSims.clear();
      toast(ui.mode === 'auto' ? 'Escenario recalculado.' : 'Simulación reiniciada al estado inicial.', 'info');
    } else return;
    draw();
  });
  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'filter') ui.filter = t.value as Filter;
    else if (t.dataset.act === 'links') ui.allLinks = t.checked;
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

function panelsHtml(sim: Simulator, signals: ReturnType<typeof cleanSignals>, rules: ReturnType<typeof allRules>): string {
  const inputs = sim.inputs();
  const targets = actionTargets(rules);
  const outputs = signals.filter((s) => targets.has(s.name));
  const last = sim.history[sim.history.length - 1];
  return `<div class="panel-grid">
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
  </div>`;
}

function countActivations(history: SimStep[]): number {
  return history.reduce((n, s) => n + s.activations.length, 0);
}

function logTable(history: SimStep[], ruleLabel: RuleLabeler): string {
  const rows = history.filter((s) => s.events.length || s.activations.length);
  if (!rows.length) return '<p class="muted small log__empty">Todavía no ha ocurrido nada. Cambia una entrada para empezar.</p>';
  return `<div class="table-scroll"><table class="table table--log">
    <thead><tr><th class="num">Ciclo</th><th>Cambio externo</th><th>Regla disparada</th><th>Efecto</th></tr></thead>
    <tbody>${rows
      .map((s) => {
        const ev = s.events.map((e) => `<code>${esc(e.signal)}</code> ${e.fromValue}→${e.value}`).join('<br>') || '<span class="muted">—</span>';
        const byRule = new Map<string, string[]>();
        s.activations.forEach((a) => {
          const key = `<span class="fx-chip">${esc(ruleLabel(a.ruleId, a.ruleIndex))}</span>${esc(a.ruleName)}`;
          const list = byRule.get(key) ?? [];
          list.push(`<code>${esc(a.targetSignal)}</code> ${a.fromValue}→${a.toValue}`);
          byRule.set(key, list);
        });
        const rulesHtml = [...byRule.keys()].join('<br>') || '<span class="muted">—</span>';
        const fx = [...byRule.values()].map((l) => l.join(', ')).join('<br>') || '<span class="muted">—</span>';
        return `<tr><td class="num mono">${s.time}</td><td>${ev}</td><td>${rulesHtml}</td><td>${fx}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}
