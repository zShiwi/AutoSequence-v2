/**
 * Simulación visual del transportador.
 *
 * 1. Sin transportador: formulario de medidas («cuánto mide») para crearlo.
 * 2. Editor de medidas y posiciones: topes (línea arriba/abajo y distancia al
 *    extremo izquierdo; los inductivos y la presencia van en el propio tope),
 *    sensores de línea (paso de paleta, acumulación máxima…) colocados por su
 *    distancia a un tope o al extremo, y estaciones de robot.
 * 3. Vista animada (3D o plano): paletas, topes y sensores acoplados al PLC
 *    simulado, con paletas que se añaden o quitan en marcha y mandos para
 *    provocar fallos y pulsar botones.
 */

import { allRules, commit, project } from '../state/store';
import { cleanSignals, actionTargets } from '../plc/signals';
import { ruleLabeler } from '../plc/rules';
import { Plant } from '../plant/engine';
import {
  PRESENCE_BEFORE_STOP,
  defaultLayout,
  liftEnd,
  loopLength,
  palletEntry,
  motorEnd,
  pointAt,
  sensorS,
  stopS,
  validateLayout,
} from '../plant/layout';
import type { ConveyorLayout, ConveyorLine, LayoutSensor, LayoutStation, LayoutStop, Signal, SignalLevel } from '../types';
import { esc, h, icon, qs, toast } from './dom';
import type { App } from './app';
import type { CameraPreset, PlantView } from '../plant/view3d';

const ui = {
  running: true,
  speed: 1,
  editing: false,
  plant: null as Plant | null,
  signature: '',
  view: '3d' as '3d' | 'plan',
  labels: true,
};

const SPEEDS = [1, 2, 5, 10];
const palletCount = (pl: Plant) => (pl.pending ? `${pl.pallets.length}+${pl.pending}` : String(pl.pallets.length));
const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function renderPlant(app: App): HTMLElement {
  const p = project();
  const signals = cleanSignals(p.signals);
  const root = h('<div class="plant"></div>');

  if (!p.layout) {
    root.appendChild(setupForm(signals, () => {
      ui.editing = true;
      app.refresh();
    }));
    return root;
  }

  const rules = allRules();
  const layout = p.layout;
  const issues = validateLayout(layout, signals);
  const errors = issues.filter((i) => i.level === 'error');

  // El número de paletas no reinicia la simulación: se añaden o quitan en marcha.
  const signature = JSON.stringify([p.id, signals, rules, { ...layout, pallets: 0 }]);
  if (ui.signature !== signature) {
    ui.plant = null;
    ui.signature = signature;
  }
  if (!ui.plant && !errors.length) ui.plant = new Plant(layout, signals, rules);
  const plant = ui.plant;
  if (plant) {
    const total = () => plant.pallets.length + plant.pending;
    while (total() < layout.pallets && plant.addPallet());
    while (total() > layout.pallets && plant.removePallet());
  }
  const use3d = ui.view === '3d' && !!plant;

  root.innerHTML = `
    <div class="card card--flush">
      <div class="toolbar plant-bar">
        <button class="btn btn--primary btn--sm" data-pl="run"${errors.length ? ' disabled' : ''}>${icon(ui.running ? 'pause' : 'play', 15)}<span>${ui.running ? 'Pausa' : 'Iniciar'}</span></button>
        <button class="btn btn--ghost btn--sm" data-pl="reset"${errors.length ? ' disabled' : ''}>${icon('reset', 15)}<span>Reiniciar</span></button>
        <div class="segmented segmented--sm" role="radiogroup" aria-label="Velocidad">
          ${SPEEDS.map((s) => `<button role="radio" data-speed="${s}" class="${s === ui.speed ? 'is-active' : ''}" aria-checked="${s === ui.speed}">×${s}</button>`).join('')}
        </div>
        <span class="plant-clock mono" data-slot="clock">00:00</span>
        <div class="stepper" role="group" aria-label="Paletas en el lazo">
          <span class="stepper__label">Paletas</span>
          <button class="stepper__btn" data-pl="pminus" aria-label="Quitar una paleta"${plant ? '' : ' disabled'}>−</button>
          <output class="stepper__val mono" data-slot="npallets">${plant ? palletCount(plant) : layout.pallets}</output>
          <button class="stepper__btn" data-pl="pplus" aria-label="Añadir una paleta"${plant ? '' : ' disabled'}>+</button>
          <span class="stepper__max muted small">máx. ${plant ? plant.capacity() : '—'}</span>
        </div>
        <span class="toolbar__spacer"></span>
        <div class="segmented segmented--sm" role="radiogroup" aria-label="Vista">
          <button role="radio" data-view="3d" class="${ui.view === '3d' ? 'is-active' : ''}" aria-checked="${ui.view === '3d'}">3D</button>
          <button role="radio" data-view="plan" class="${ui.view === 'plan' ? 'is-active' : ''}" aria-checked="${ui.view === 'plan'}">Esquema</button>
        </div>
        ${use3d ? `<label class="check"><input type="checkbox" data-pl-labels${ui.labels ? ' checked' : ''}/> Nombres</label>` : ''}
        <button class="btn btn--ghost btn--sm${ui.editing ? ' is-pressed' : ''}" data-pl="edit" aria-pressed="${ui.editing}">${icon('edit', 15)}<span>Medidas y posiciones</span></button>
      </div>
      ${issues.length ? `<div class="plant-issues">${issues.map((i) => `<p class="plant-issue plant-issue--${i.level}">${icon('alert', 15)}${esc(i.text)}</p>`).join('')}</div>` : ''}
      <div class="plant-canvas" data-slot="canvas"></div>
    </div>
    <div data-slot="editor"></div>
    ${
      plant
        ? `<div class="plant-panels">
            <section class="card"><div class="card__head"><h2>Mandos</h2><span class="muted small">Fallos y pulsadores</span></div><div data-slot="manual"></div></section>
            <section class="card"><div class="card__head"><h2>Estado del PLC</h2><span class="muted small">Salidas y marcas</span></div><div data-slot="state"></div></section>
            <section class="card"><div class="card__head"><h2>Producción</h2><span class="muted small" data-slot="pcount"></span></div><div data-slot="prod"></div></section>
          </div>
          <section class="card card--flush plant-log"><div class="card__head card__head--pad"><h2>Últimas reglas disparadas</h2><span class="muted small">Tiempo de simulación</span></div><div data-slot="log"></div></section>`
        : ''
    }`;

  const canvas = qs(root, '[data-slot="canvas"]');
  let view: Pick<PlantView, 'update'> & Partial<PlantView> = { update: () => {} };
  const showPlan = () => {
    const scene = buildScene(layout, signals);
    canvas.classList.remove('plant-canvas--3d');
    canvas.innerHTML = scene.svg;
    const svg = canvas.querySelector('svg')!;
    view = { update: (pl) => scene.update(svg, pl) };
    if (plant) view.update(plant);
  };
  if (use3d) {
    canvas.classList.add('plant-canvas--3d');
    canvas.innerHTML = `<div class="plant3d plant3d--loading"><span class="muted">Cargando vista 3D…</span></div>`;
    import('../plant/view3d')
      .then(({ createView3d }) => {
        if (!root.isConnected) return;
        const v = createView3d(layout, signals, { labels: ui.labels });
        if (!v) {
          ui.view = 'plan';
          toast('Este navegador no puede mostrar la vista 3D. Se muestra el plano.', 'warn');
          showPlan();
          return;
        }
        canvas.innerHTML = '';
        canvas.appendChild(v.el);
        canvas.insertAdjacentHTML(
          'beforeend',
          `<div class="plant3d__cams segmented segmented--sm" role="group" aria-label="Cámara">
            <button data-cam="general">General</button><button data-cam="lateral">Lateral</button><button data-cam="superior">Superior</button>
          </div>
          <p class="plant3d__hint">Arrastra para girar · rueda para acercar · botón derecho para desplazar</p>`,
        );
        view = v;
      })
      .catch(() => {
        toast('No se pudo cargar la vista 3D. Se muestra el plano.', 'warn');
        showPlan();
      });
  } else showPlan();

  if (ui.editing) {
    qs(root, '[data-slot="editor"]').appendChild(
      layoutEditor(layout, signals, issues, () => {
        commit();
        app.refresh();
      }),
    );
  }

  // ---- Controles ------------------------------------------------------------
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-pl]')?.dataset.pl;
    const sp = t.closest<HTMLElement>('[data-speed]')?.dataset.speed;
    const tog = t.closest<HTMLElement>('[data-pl-toggle]')?.dataset.plToggle;
    const pulse = t.closest<HTMLElement>('[data-pl-pulse]')?.dataset.plPulse;
    const vw = t.closest<HTMLElement>('[data-view]')?.dataset.view as typeof ui.view | undefined;
    const cam = t.closest<HTMLElement>('[data-cam]')?.dataset.cam as CameraPreset | undefined;
    if (vw) {
      if (vw !== ui.view) {
        ui.view = vw;
        app.refresh();
      }
    } else if (cam) {
      view.setCamera?.(cam);
    } else if ((act === 'pplus' || act === 'pminus') && plant) {
      const ok = act === 'pplus' ? plant.addPallet() : plant.removePallet();
      if (!ok) {
        toast(
          act === 'pplus'
            ? `Ya hay el máximo de paletas (${plant.capacity()}): no caben más sin meterlas dentro de una zona.`
            : 'Ahora no hay ninguna paleta en la cola de entrada para retirar. Espera a que llegue alguna.',
          'warn',
        );
        return;
      }
      layout.pallets = plant.pallets.length + plant.pending;
      if (act === 'pplus' && plant.pending) toast('La paleta entrará por el punto de entrada en cuanto haya hueco.', 'info', 1800);
      commit();
      qs(root, '[data-slot="npallets"]').textContent = palletCount(plant);
      const dims = root.querySelector<HTMLInputElement>('.plant-editor input[name="pallets"]');
      if (dims) dims.value = String(layout.pallets);
      drawPanels(true);
    } else if (sp) {
      ui.speed = Number(sp);
      root.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.speed === sp);
        b.setAttribute('aria-checked', String(b.dataset.speed === sp));
      });
    } else if (act === 'run') {
      ui.running = !ui.running;
      const b = t.closest<HTMLElement>('[data-pl]')!;
      b.innerHTML = `${icon(ui.running ? 'pause' : 'play', 15)}<span>${ui.running ? 'Pausa' : 'Iniciar'}</span>`;
    } else if (act === 'reset') {
      ui.plant = null;
      app.refresh();
      toast('Transportador reiniciado.', 'info', 1600);
    } else if (act === 'edit') {
      ui.editing = !ui.editing;
      if (ui.editing) ui.running = false;
      app.refresh();
    } else if (tog && plant) {
      plant.setManual(tog, plant.sim.states[tog] === 1 ? 0 : 1);
      drawPanels(true);
    } else if (pulse && plant) {
      const v = plant.sim.states[pulse];
      plant.setManual(pulse, (v === 1 ? 0 : 1) as SignalLevel);
      window.setTimeout(() => {
        plant.setManual(pulse, v);
        drawPanels(true);
      }, 400);
      drawPanels(true);
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-pl-labels]')) return;
    ui.labels = t.checked;
    view.setLabels?.(t.checked);
  });

  // ---- Paneles -------------------------------------------------------------
  const label = ruleLabeler(p.blocks);
  const desc = new Map(signals.map((s) => [s.name, s.description]));
  const targets = actionTargets(rules);
  let lastPanels = 0;
  const drawPanels = (force = false) => {
    if (!plant) return;
    const now = performance.now();
    if (!force && now - lastPanels < 250) return;
    lastPanels = now;
    const st = plant.sim.states;
    const manual = plant.manualInputs();
    const put = (el: Element | null, html: string) => {
      if (el && el.getAttribute('data-html') !== html) {
        el.innerHTML = html;
        el.setAttribute('data-html', html);
      }
    };
    put(
      root.querySelector('[data-slot="manual"]'),
      manual.length
        ? `<div class="io-grid io-grid--compact">${manual
            .map((n) => {
              const on = st[n] === 1;
              return `<div class="io io--input${on ? ' is-on' : ''}" title="${esc(desc.get(n) ?? '')}">
                <button class="io__switch" data-pl-toggle="${esc(n)}" aria-pressed="${on}"><span class="lamp"></span><code>${esc(n)}</code><span class="io__val">${on ? 1 : 0}</span></button>
                <button class="icon-btn" data-pl-pulse="${esc(n)}" title="Pulso" aria-label="Pulso en ${esc(n)}">${icon('pulse', 15)}</button>
              </div>`;
            })
            .join('')}</div>`
        : '<p class="muted small">Todas las entradas las gobierna el transportador.</p>',
    );
    put(
      root.querySelector('[data-slot="state"]'),
      `<div class="io-grid io-grid--compact">${signals
        .filter((x) => targets.has(x.name))
        .map((x) => {
          const on = st[x.name] === 1;
          const word = x.type === 'Cilindro' ? (on ? 'Abre' : 'Cierra') : on ? '1' : '0';
          return `<div class="io io--output${on ? ' is-on' : ''}" title="${esc(x.description)}"><span class="lamp"></span><code>${esc(x.name)}</code><span class="io__val">${word}</span></div>`;
        })
        .join('')}</div>`,
    );
    const cnt = root.querySelector('[data-slot="npallets"]');
    if (cnt && cnt.textContent !== palletCount(plant)) cnt.textContent = palletCount(plant);
    const prod = root.querySelector('[data-slot="prod"]');
    if (prod) {
      const cyc = plant.stationCycles();
      prod.innerHTML = `<dl class="plant-stats">
        <div><dt>Motor</dt><dd class="${plant.motorOn() ? 'ok' : 'bad'}">${plant.motorOn() ? 'En marcha' : 'Parado'}</dd></div>
        <div><dt>Paletas en el lazo</dt><dd>${plant.pallets.length} de ${plant.capacity()} posibles${plant.pending ? ` · ${plant.pending} esperando entrar` : ''}</dd></div>
        <div><dt>Paletas paradas</dt><dd>${plant.pallets.filter((x) => !x.moving).length}</dd></div>
        ${cyc.map((c) => `<div><dt>${esc(c.label)}</dt><dd>${c.cycles} ciclos · ${c.perMin.toFixed(1)}/min</dd></div>`).join('')}
      </dl>`;
    }
    const log = root.querySelector('[data-slot="log"]');
    if (log) {
      const last = plant.log.slice(-10).reverse();
      log.innerHTML = last.length
        ? `<table class="table table--log"><tbody>${last
            .map(
              (e) =>
                `<tr><td class="num mono">${(e.t / 1000).toFixed(1)} s</td><td><span class="fx-chip">${esc(label(e.ruleId, e.ruleIndex))}</span>${esc(e.ruleName)}</td><td><code>${esc(e.target)}</code> → ${e.to}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="muted small log__empty">Aún no se ha disparado ninguna regla.</p>';
    }
  };

  // ---- Animación -----------------------------------------------------------
  if (plant) {
    const clock = root.querySelector<HTMLElement>('[data-slot="clock"]')!;
    let last = performance.now();
    const frame = (now: number) => {
      if (!root.isConnected || ui.plant !== plant) {
        view.dispose?.();
        return;
      }
      const dt = Math.min(100, now - last);
      last = now;
      if (ui.running && !document.hidden) plant.step(dt * ui.speed);
      view.update(plant);
      clock.textContent = fmtTime(plant.time);
      drawPanels();
      requestAnimationFrame(frame);
    };
    drawPanels(true);
    requestAnimationFrame(frame);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Formulario inicial: medidas del transportador
// ---------------------------------------------------------------------------

function setupForm(signals: Signal[], done: () => void): HTMLElement {
  const base = defaultLayout(signals);
  const motors = signals.filter((s) => s.type === 'Motor');
  const el = h(`
    <div class="card plant-setup">
      <div class="plant-setup__head">
        <div class="empty__art" aria-hidden="true">${icon('conveyor', 30)}</div>
        <div>
          <h2>Configura el transportador</h2>
          <p class="muted">Lazo vertical: las paletas van por el ramal de arriba, bajan por una curva y vuelven colgadas por el de abajo. Indica el tipo y las medidas; después colocarás cada tope y los sensores por su distancia.</p>
        </div>
      </div>
      <form class="form-grid form-grid--2" novalidate>
        <fieldset class="kind-pick">
          <legend class="field__label">Tipo de transportador</legend>
          <label class="kind-opt"><input type="radio" name="kind" value="aereo" checked /><span><b>Aéreo</b><small>Va alto y se carga por abajo: carga y descarga en el ramal inferior, pre-carga arriba.</small></span></label>
          <label class="kind-opt"><input type="radio" name="kind" value="suelo" /><span><b>De suelo</b><small>Va bajo y se carga por arriba: carga y descarga en el ramal superior.</small></span></label>
        </fieldset>
        ${numField('length', 'Longitud del transportador', base.length, 'mm', 'Distancia entre los ejes de las dos curvas.')}
        ${numField('radius', 'Radio de las curvas', base.radius, 'mm')}
        <label class="field"><span class="field__label">Sentido de avance</span>
          <select class="input" name="direction">
            <option value="ccw">Abajo hacia la derecha · arriba hacia la izquierda</option>
            <option value="cw">Arriba hacia la derecha · abajo hacia la izquierda</option>
          </select>
          <span class="field__hint">El motor irá en la curva donde suben las paletas.</span></label>
        <label class="field"><span class="field__label">Motor del transportador</span>
          <select class="input" name="motor">
            ${motors.map((m) => `<option value="${esc(m.name)}"${m.name === base.motor ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
            <option value="">Sin motor (siempre en marcha)</option>
          </select></label>
        ${numField('palletLength', 'Longitud de la paleta', base.palletLength, 'mm')}
        ${numField('palletGap', 'Separación mínima entre paletas', base.palletGap, 'mm')}
        ${numField('speed', 'Velocidad de la cadena', base.speed, 'mm/s', '250 mm/s = 15 m/min')}
        ${numField('pallets', 'Paletas en el lazo', base.pallets, 'uds')}
      </form>
      <div class="plant-setup__foot">
        <span class="muted small">Se colocará un tope por cada cilindro (${base.stops.length}); luego podrás moverlos.</span>
        <button class="btn btn--primary" data-act="create">${icon('check', 16)}<span>Crear transportador</span></button>
      </div>
    </div>`);
  qs(el, '[data-act="create"]').addEventListener('click', () => {
    const f = qs<HTMLFormElement>(el, 'form');
    const num = (n: string) => Number((f.elements.namedItem(n) as HTMLInputElement).value);
    const kind = (f.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ?? 'aereo') as NonNullable<ConveyorLayout['kind']>;
    const layout: ConveyorLayout = {
      ...base,
      kind,
      length: num('length'),
      radius: num('radius'),
      direction: (f.elements.namedItem('direction') as HTMLSelectElement).value as ConveyorLayout['direction'],
      motor: (f.elements.namedItem('motor') as HTMLSelectElement).value || undefined,
      palletLength: num('palletLength'),
      palletGap: num('palletGap'),
      speed: num('speed'),
      pallets: Math.round(num('pallets')),
    };
    if (!(layout.length > 0) || !(layout.radius > 0) || !(layout.palletLength > 0) || !(layout.speed > 0)) {
      toast('Revisa las medidas: deben ser mayores que 0.', 'error');
      return;
    }
    layout.stops = defaultLayout(signals, kind).stops.map((s) => ({ ...s, x: Math.round((s.x / base.length) * layout.length) }));
    project().layout = layout;
    commit();
    toast('Transportador creado. Ahora coloca los topes y sensores.');
    done();
  });
  return el;
}

const empty = (cols: number, text: string) => `<tr class="table-empty"><td colspan="${cols}">${esc(text)}</td></tr>`;

function numField(name: string, label: string, value: number, unit: string, hint = ''): string {
  return `<label class="field"><span class="field__label">${esc(label)}</span>
    <span class="input-unit"><input class="input" type="number" min="0" step="any" name="${name}" value="${value}" /><span>${esc(unit)}</span></span>
    ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}</label>`;
}

// ---------------------------------------------------------------------------
// Editor de medidas y posiciones
// ---------------------------------------------------------------------------

function layoutEditor(
  layout: ConveyorLayout,
  signals: Signal[],
  issues: ReturnType<typeof validateLayout>,
  changed: () => void,
): HTMLElement {
  const cylinders = signals.filter((s) => s.type === 'Cilindro');
  const sensors = signals.filter((s) => s.type === 'Sensor' || s.type === 'Virtual');
  const motors = signals.filter((s) => s.type === 'Motor');
  const opt = (list: Signal[], sel: string | undefined, empty?: string) =>
    (empty !== undefined ? `<option value=""${!sel ? ' selected' : ''}>${esc(empty)}</option>` : '') +
    list.map((s) => `<option value="${esc(s.name)}"${s.name === sel ? ' selected' : ''} title="${esc(s.description)}">${esc(s.name)}</option>`).join('') +
    (sel && !list.some((s) => s.name === sel) ? `<option value="${esc(sel)}" selected>${esc(sel)} (no existe)</option>` : '');
  const lineOpt = (v: ConveyorLine) =>
    `<option value="bottom"${v === 'bottom' ? ' selected' : ''}>Ramal de abajo</option><option value="top"${v === 'top' ? ' selected' : ''}>Ramal de arriba</option>`;
  const sigByName = new Map(signals.map((s) => [s.name, s]));

  const el = h(`
    <section class="card plant-editor">
      <div class="card__head"><h2>Medidas y posiciones</h2><span class="muted small">Los cambios se guardan solos y se pueden deshacer con Ctrl+Z</span></div>
      ${issues.length ? '' : `<p class="plant-ok">${icon('check', 15)} Configuración correcta.</p>`}

      <h3 class="plant-editor__title">Transportador</h3>
      <div class="form-grid form-grid--4" data-group="dims">
        ${numField('length', 'Longitud', layout.length, 'mm')}
        ${numField('radius', 'Radio de curva', layout.radius, 'mm')}
        ${numField('palletLength', 'Paleta', layout.palletLength, 'mm')}
        ${numField('palletGap', 'Separación mínima', layout.palletGap, 'mm')}
        ${numField('speed', 'Velocidad', layout.speed, 'mm/s', `${((layout.speed * 60) / 1000).toFixed(1)} m/min`)}
        ${numField('pallets', 'Paletas', layout.pallets, 'uds')}
        <label class="field"><span class="field__label">Tipo</span>
          <select class="input" name="kind">
            <option value="aereo"${(layout.kind ?? 'aereo') === 'aereo' ? ' selected' : ''}>Aéreo · se carga por abajo</option>
            <option value="suelo"${layout.kind === 'suelo' ? ' selected' : ''}>De suelo · se carga por arriba</option>
          </select></label>
        <label class="field"><span class="field__label">Sentido</span>
          <select class="input" name="direction">
            <option value="ccw"${layout.direction === 'ccw' ? ' selected' : ''}>Abajo → · arriba ←</option>
            <option value="cw"${layout.direction === 'cw' ? ' selected' : ''}>Arriba → · abajo ←</option>
          </select></label>
        <label class="field"><span class="field__label">Motor</span>
          <select class="input" name="motor">${opt(motors, layout.motor, 'Sin motor')}</select></label>
        <label class="field"><span class="field__label">Motor en la curva</span>
          <select class="input" name="motorEnd">
            <option value=""${!layout.motorEnd ? ' selected' : ''}>Donde suben las paletas (${liftEnd(layout) === 'right' ? 'derecha' : 'izquierda'})</option>
            <option value="left"${layout.motorEnd === 'left' ? ' selected' : ''}>Izquierda</option>
            <option value="right"${layout.motorEnd === 'right' ? ' selected' : ''}>Derecha</option>
          </select></label>
      </div>

      <h3 class="plant-editor__title">Topes <span class="muted small">· los inductivos de activo/reposo y el sensor de presencia van en el propio tope</span></h3>
      <div class="table-scroll"><table class="table table--edit table--plant">
        <thead><tr><th>Cilindro</th><th>Presencia en el tope</th><th>Línea</th><th>Distancia desde el extremo izquierdo</th><th>Tiempo cilindro</th><th class="actions"></th></tr></thead>
        <tbody data-group="stops">${layout.stops
          .map((t, i) => {
            const sig = sigByName.get(t.cylinder);
            const ind = sig ? [sig.inductivoActivo, sig.inductivoReposo].filter(Boolean).join(' / ') : '';
            return `<tr data-i="${i}">
              <td><select class="input input--mono" data-f="cylinder">${opt(cylinders, t.cylinder)}</select>${ind ? `<span class="cell-hint">Inductivos: ${esc(ind)}</span>` : ''}</td>
              <td><select class="input input--mono" data-f="presence">${opt(sensors, t.presence, '—')}</select></td>
              <td><select class="input" data-f="line">${lineOpt(t.line)}</select></td>
              <td><span class="input-unit"><input class="input" type="number" step="any" data-f="x" value="${t.x}" /><span>mm</span></span></td>
              <td><span class="input-unit"><input class="input" type="number" min="1" step="any" data-f="travelMs" value="${t.travelMs}" /><span>ms</span></span></td>
              <td class="actions"><button class="icon-btn icon-btn--danger" data-del="stops" aria-label="Quitar tope">${icon('trash', 16)}</button></td>
            </tr>`;
          })
          .join('') || empty(6, 'Sin topes. Añade uno por cada cilindro de tope.')}</tbody>
      </table></div>
      <button class="btn btn--ghost btn--sm" data-add="stops">${icon('plus', 15)}<span>Añadir tope</span></button>

      <h3 class="plant-editor__title">Sensores de línea <span class="muted small">· paso de paleta, acumulación máxima… por su distancia a un tope</span></h3>
      <div class="table-scroll"><table class="table table--edit table--plant">
        <thead><tr><th>Sensor</th><th>Tipo</th><th>Referencia</th><th>Posición</th><th>Distancia</th><th class="actions"></th></tr></thead>
        <tbody data-group="sensors">${layout.sensors
          .map((x, i) => {
            const isLeft = x.ref === 'left';
            const refVal = isLeft ? `left:${x.line ?? 'bottom'}` : x.ref;
            return `<tr data-i="${i}">
              <td><select class="input input--mono" data-f="signal">${opt(sensors, x.signal)}</select></td>
              <td><select class="input" data-f="role">
                <option value="paso"${x.role === 'paso' ? ' selected' : ''}>Paso de paleta</option>
                <option value="acumulacion"${x.role === 'acumulacion' ? ' selected' : ''}>Acumulación máxima</option>
                <option value="otro"${x.role === 'otro' ? ' selected' : ''}>Otro</option>
              </select></td>
              <td><select class="input" data-f="ref">
                ${layout.stops.map((t) => `<option value="${esc(t.cylinder)}"${refVal === t.cylinder ? ' selected' : ''}>Tope ${esc(t.cylinder)}</option>`).join('')}
                <option value="left:bottom"${refVal === 'left:bottom' ? ' selected' : ''}>Extremo izquierdo · abajo</option>
                <option value="left:top"${refVal === 'left:top' ? ' selected' : ''}>Extremo izquierdo · arriba</option>
              </select></td>
              <td>${
                isLeft
                  ? '<span class="muted small">desde el extremo</span>'
                  : `<select class="input" data-f="side"><option value="before"${x.offset < 0 ? ' selected' : ''}>Antes del tope</option><option value="after"${x.offset >= 0 ? ' selected' : ''}>Después del tope</option></select>`
              }</td>
              <td><span class="input-unit"><input class="input" type="number" min="0" step="any" data-f="dist" value="${Math.abs(x.offset)}" /><span>mm</span></span></td>
              <td class="actions"><button class="icon-btn icon-btn--danger" data-del="sensors" aria-label="Quitar sensor">${icon('trash', 16)}</button></td>
            </tr>`;
          })
          .join('') || empty(6, 'Sin sensores de línea. Añade los de paso de paleta o acumulación máxima.')}</tbody>
      </table></div>
      <button class="btn btn--ghost btn--sm" data-add="sensors"${layout.stops.length ? '' : ' disabled'}>${icon('plus', 15)}<span>Añadir sensor</span></button>

      <h3 class="plant-editor__title">Estaciones <span class="muted small">· robot u operario que trabaja con la paleta parada en un tope</span></h3>
      <div class="table-scroll"><table class="table table--edit table--plant">
        <thead><tr><th>Tope</th><th>Nombre</th><th>Trabajo</th><th>Señal al terminar</th><th>Pieza OK (=1)</th><th>Pieza NOK (=0)</th><th>Tiempo</th><th class="actions"></th></tr></thead>
        <tbody data-group="stations">${layout.stations
          .map(
            (st, i) => `<tr data-i="${i}">
              <td><select class="input input--mono" data-f="stop">${layout.stops.map((t) => `<option value="${esc(t.cylinder)}"${st.stop === t.cylinder ? ' selected' : ''}>${esc(t.cylinder)}</option>`).join('')}</select></td>
              <td><input class="input" data-f="label" value="${esc(st.label)}" /></td>
              <td><select class="input" data-f="action"><option value="load"${st.action === 'load' ? ' selected' : ''}>Carga</option><option value="unload"${st.action === 'unload' ? ' selected' : ''}>Descarga</option></select></td>
              <td><select class="input input--mono" data-f="release">${opt(sensors, st.release, '—')}</select></td>
              <td><select class="input input--mono" data-f="ok">${opt(sensors, st.okSensors[0], '—')}</select></td>
              <td><select class="input input--mono" data-f="nok">${opt(sensors, st.nokSensors[0], '—')}</select></td>
              <td><span class="input-unit"><input class="input" type="number" min="0" step="any" data-f="cycle" value="${st.cycleMs / 1000}" /><span>s</span></span></td>
              <td class="actions"><button class="icon-btn icon-btn--danger" data-del="stations" aria-label="Quitar estación">${icon('trash', 16)}</button></td>
            </tr>`,
          )
          .join('') || empty(8, 'Sin estaciones. Añade un robot u operario en el tope donde trabaja.')}</tbody>
      </table></div>
      <button class="btn btn--ghost btn--sm" data-add="stations"${layout.stops.length ? '' : ' disabled'}>${icon('plus', 15)}<span>Añadir estación</span></button>
    </section>`);

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const groupEl = t.closest<HTMLElement>('[data-group]');
    if (!groupEl) return;
    const group = groupEl.dataset.group;
    if (group === 'dims') {
      const n = t.name as keyof ConveyorLayout;
      if (n === 'direction') layout.direction = t.value as ConveyorLayout['direction'];
      else if (n === 'kind') layout.kind = t.value as NonNullable<ConveyorLayout['kind']>;
      else if (n === 'motorEnd') {
        if (t.value) layout.motorEnd = t.value as 'left' | 'right';
        else delete layout.motorEnd;
      }
      else if (n === 'motor') layout.motor = t.value || undefined;
      else {
        const v = Number(t.value);
        if (!Number.isFinite(v)) return;
        (layout as unknown as Record<string, number>)[n] = n === 'pallets' ? Math.max(0, Math.round(v)) : v;
      }
      return changed();
    }
    const i = Number(t.closest<HTMLElement>('[data-i]')?.dataset.i);
    const f = (t as HTMLElement).dataset.f;
    if (group === 'stops') {
      const s = layout.stops[i];
      if (f === 'cylinder') {
        const old = s.cylinder;
        s.cylinder = t.value;
        layout.sensors.forEach((x) => x.ref === old && (x.ref = t.value));
        layout.stations.forEach((x) => x.stop === old && (x.stop = t.value));
      } else if (f === 'presence') s.presence = t.value || undefined;
      else if (f === 'line') s.line = t.value as ConveyorLine;
      else if (f === 'x') s.x = Number(t.value) || 0;
      else if (f === 'travelMs') s.travelMs = Math.max(1, Number(t.value) || 1);
    } else if (group === 'sensors') {
      const x = layout.sensors[i];
      if (f === 'signal') x.signal = t.value;
      else if (f === 'role') x.role = t.value as LayoutSensor['role'];
      else if (f === 'ref') {
        if (t.value.startsWith('left:')) {
          x.ref = 'left';
          x.line = t.value.slice(5) as ConveyorLine;
          x.offset = Math.abs(x.offset);
        } else {
          x.ref = t.value;
          delete x.line;
        }
      } else if (f === 'side') x.offset = (t.value === 'before' ? -1 : 1) * Math.abs(x.offset);
      else if (f === 'dist') {
        const d = Math.abs(Number(t.value) || 0);
        x.offset = x.ref !== 'left' && x.offset < 0 ? -d : d;
      }
    } else if (group === 'stations') {
      const st = layout.stations[i];
      if (f === 'stop') st.stop = t.value;
      else if (f === 'label') st.label = t.value.trim() || 'Estación';
      else if (f === 'action') st.action = t.value as LayoutStation['action'];
      else if (f === 'release') st.release = t.value || undefined;
      else if (f === 'ok') st.okSensors = t.value ? [t.value] : [];
      else if (f === 'nok') st.nokSensors = t.value ? [t.value] : [];
      else if (f === 'cycle') st.cycleMs = Math.max(0, Number(t.value) || 0) * 1000;
    }
    changed();
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-add]')?.dataset.add;
    const del = t.closest<HTMLElement>('[data-del]')?.dataset.del;
    if (add === 'stops') {
      const used = new Set(layout.stops.map((s) => s.cylinder));
      const free = cylinders.find((c) => !used.has(c.name));
      if (!free) return toast('Todos los cilindros ya tienen tope. Añade otro cilindro en Señales.', 'warn');
      const stop: LayoutStop = { cylinder: free.name, line: 'bottom', x: Math.round(layout.length / 2), travelMs: 300 };
      layout.stops.push(stop);
    } else if (add === 'sensors') {
      const used = new Set([...layout.sensors.map((s) => s.signal), ...layout.stops.map((s) => s.presence)]);
      const free = sensors.find((s) => s.type === 'Sensor' && !used.has(s.name));
      layout.sensors.push({ signal: free?.name ?? '', role: 'paso', ref: layout.stops[0].cylinder, offset: 600 });
    } else if (add === 'stations') {
      layout.stations.push({ stop: layout.stops[0].cylinder, label: 'Robot', action: 'load', okSensors: [], nokSensors: [], cycleMs: 3000 });
    } else if (del) {
      const i = Number(t.closest<HTMLElement>('[data-i]')?.dataset.i);
      if (del === 'stops') {
        const [gone] = layout.stops.splice(i, 1);
        layout.sensors = layout.sensors.filter((x) => x.ref !== gone.cylinder);
        layout.stations = layout.stations.filter((x) => x.stop !== gone.cylinder);
      } else if (del === 'sensors') layout.sensors.splice(i, 1);
      else if (del === 'stations') layout.stations.splice(i, 1);
    } else return;
    changed();
  });

  return el;
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

interface Scene {
  svg: string;
  update: (svg: SVGSVGElement, plant: Plant) => void;
}

function buildScene(layout: ConveyorLayout, signals: Signal[]): Scene {
  const S = layout.length;
  const R = layout.radius;
  const W = 1120;
  const padX = 64;
  const k = (W - 2 * padX - 40) / (S + 2 * R);
  const BW = 30; // ancho de la banda (px)
  const padY = 150;
  const H = 2 * R * k + 2 * padY;
  const X = (x: number) => padX + (x + R) * k;
  const Y = (y: number) => padY + (y + R) * k;
  const L = loopLength(layout);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const bySignal = new Map(signals.map((s) => [s.name, s]));

  // Normal hacia fuera del lazo en un punto.
  const outward = (s: number) => {
    const pt = pointAt(layout, s);
    // Rumbo + 90° (ccw) apunta hacia dentro o fuera según el sentido; se elige
    // el que se aleja del centro del lazo.
    const cx = S / 2;
    let nx = -Math.sin(pt.heading);
    let ny = Math.cos(pt.heading);
    const vx = pt.x - (pt.x < 0 ? 0 : pt.x > S ? S : pt.x) || pt.x - cx;
    const vy = pt.y;
    if (nx * (pt.line === 'curve' ? vx : 0) + ny * vy < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { pt, nx, ny };
  };

  const path = `M${r1(X(0))} ${r1(Y(R))}H${r1(X(S))}A${r1(R * k)} ${r1(R * k)} 0 0 0 ${r1(X(S))} ${r1(Y(-R))}H${r1(X(0))}A${r1(R * k)} ${r1(R * k)} 0 0 0 ${r1(X(0))} ${r1(Y(R))}Z`;
  const out: string[] = [];
  out.push(
    `<svg class="plant-svg" viewBox="0 0 ${W} ${r1(H)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Transportador en lazo">`,
    `<defs><marker id="pl-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" stroke-width="2"/></marker></defs>`,
  );

  // Regla en mm bajo el transportador (para colocar los elementos).
  const ry = Y(R) + BW / 2 + 118;
  const step = S > 8000 ? 2000 : S > 3000 ? 1000 : 500;
  out.push(`<g class="pl-ruler"><line x1="${X(0)}" y1="${ry}" x2="${X(S)}" y2="${ry}"/>`);
  for (let x = 0; x <= S + 1; x += step) {
    out.push(`<line x1="${r1(X(x))}" y1="${ry - 4}" x2="${r1(X(x))}" y2="${ry + 4}"/><text x="${r1(X(x))}" y="${ry + 17}" text-anchor="middle">${x}</text>`);
  }
  out.push(`<text x="${r1(X(S)) + 8}" y="${ry + 4}">mm</text></g>`);

  // Banda.
  out.push(
    `<path class="pl-rail" d="${path}" style="stroke-width:${BW + 6}"/>`,
    `<path class="pl-belt" d="${path}" style="stroke-width:${BW}"/>`,
    `<path class="pl-chain" d="${path}" data-chain/>`,
  );
  // Tambores.
  [0, S].forEach((x) => out.push(`<circle class="pl-drum" cx="${r1(X(x))}" cy="${r1(Y(0))}" r="${r1(Math.max(8, R * k * 0.35))}"/>`));
  // Flechas de sentido en las rectas.
  [0.18, 0.5, 0.82].forEach((f) =>
    [Math.round(f * S), L / 2 + Math.PI * R * 0 + (S - Math.round(f * S)) + Math.PI * R].forEach((s) => {
      const pt = pointAt(layout, s % L);
      const dx = Math.cos(pt.heading) * 12;
      const dy = Math.sin(pt.heading) * 12;
      out.push(`<path class="pl-flow" d="M${r1(X(pt.x) - dx)} ${r1(Y(pt.y) - dy)}L${r1(X(pt.x) + dx)} ${r1(Y(pt.y) + dy)}" marker-end="url(#pl-arrow)"/>`);
    }),
  );
  // Motor.
  if (layout.motor) {
    const mx = motorEnd(layout) === 'right' ? X(S + R) + 28 : X(-R) - 28;
    out.push(
      `<g class="pl-motor" data-motor><circle cx="${r1(mx)}" cy="${r1(Y(0))}" r="13"/><text x="${r1(mx)}" y="${r1(Y(0)) + 4}" text-anchor="middle">M</text><text class="pl-label" x="${r1(mx)}" y="${r1(Y(0)) + 30}" text-anchor="middle">${esc(layout.motor)}</text></g>`,
    );
  }

  // Etiquetas: se reparten en dos alturas si están muy juntas.
  const placed: { x: number; y: number }[] = [];
  const labelPos = (x: number, y: number, dy: number) => {
    let yy = y;
    for (let i = 0; i < 4 && placed.some((p) => Math.abs(p.x - x) < 70 && Math.abs(p.y - yy) < 13); i++) yy += dy;
    placed.push({ x, y: yy });
    return yy;
  };

  // Sensores de línea.
  layout.sensors.forEach((x) => {
    const s = sensorS(layout, x);
    if (s === null) return;
    const { pt, nx, ny } = outward(s);
    const cx = X(pt.x) + nx * (BW / 2 + 9);
    const cy = Y(pt.y) + ny * (BW / 2 + 9);
    const ly = labelPos(cx, cy + ny * 16 + (ny >= 0 ? 6 : -2), ny >= 0 ? 13 : -13);
    out.push(
      `<g class="pl-sensor pl-sensor--${x.role}" data-sensor="${esc(x.signal)}"><title>${esc(x.signal)} · ${esc(bySignal.get(x.signal)?.description ?? '')}</title>` +
        `<line x1="${r1(X(pt.x) + nx * (BW / 2))}" y1="${r1(Y(pt.y) + ny * (BW / 2))}" x2="${r1(cx)}" y2="${r1(cy)}"/>` +
        `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="5.5"/>` +
        `<text class="pl-label" x="${r1(cx)}" y="${r1(ly)}" text-anchor="middle">${esc(x.signal)}</text></g>`,
    );
  });

  // Topes (con su presencia) y estaciones.
  layout.stops.forEach((t) => {
    const s = stopS(layout, t);
    const { pt, nx, ny } = outward(s);
    const px = X(pt.x);
    const py = Y(pt.y);
    const hx = Math.cos(pt.heading);
    const hy = Math.sin(pt.heading);
    const bodyX = px + nx * (BW / 2 + 16);
    const bodyY = py + ny * (BW / 2 + 16);
    const pres = t.presence ? outward(s - PRESENCE_BEFORE_STOP) : null;
    const st = layout.stations.find((x) => x.stop === t.cylinder);
    const ly = labelPos(bodyX, bodyY + ny * 26 + (ny >= 0 ? 4 : 0), ny >= 0 ? 13 : -13);
    out.push(
      `<g class="pl-stop" data-stop="${esc(t.cylinder)}"><title>Tope ${esc(t.cylinder)} · ${esc(bySignal.get(t.cylinder)?.description ?? '')}</title>` +
        // pasador: va del borde exterior de la banda hacia dentro
        `<line class="pl-pin" data-pin x1="${r1(px + nx * (BW / 2))}" y1="${r1(py + ny * (BW / 2))}" x2="${r1(px - nx * (BW / 2))}" y2="${r1(py - ny * (BW / 2))}" data-ox="${r1(px + nx * (BW / 2))}" data-oy="${r1(py + ny * (BW / 2))}" data-dx="${r1(-nx * BW)}" data-dy="${r1(-ny * BW)}"/>` +
        `<rect class="pl-cyl" x="${r1(bodyX - 9)}" y="${r1(bodyY - 9)}" width="18" height="18" rx="3" transform="rotate(${r1((pt.heading * 180) / Math.PI)} ${r1(bodyX)} ${r1(bodyY)})"/>` +
        `<text class="pl-label pl-label--stop" x="${r1(bodyX)}" y="${r1(ly)}" text-anchor="middle">${esc(t.cylinder)}</text>` +
        (pres
          ? `<g class="pl-sensor pl-sensor--presence" data-sensor="${esc(t.presence!)}"><title>${esc(t.presence!)} · presencia en ${esc(t.cylinder)}</title><circle cx="${r1(X(pres.pt.x) + pres.nx * (BW / 2 + 5) - hx * 14)}" cy="${r1(Y(pres.pt.y) + pres.ny * (BW / 2 + 5) - hy * 14)}" r="4.5"/><text class="pl-label pl-label--small" x="${r1(bodyX - hx * 30)}" y="${r1(ly)}" text-anchor="middle">${esc(t.presence!)}</text></g>`
          : '') +
        `</g>`,
    );
    if (st) {
      const sx = px + nx * (BW / 2 + 82);
      const sy = py + ny * (BW / 2 + 82);
      out.push(
        `<g class="pl-station" data-station="${esc(t.cylinder)}">` +
          `<line class="pl-station__link" x1="${r1(bodyX + nx * 38)}" y1="${r1(bodyY + ny * 38)}" x2="${r1(sx)}" y2="${r1(sy - ny * 16)}"/>` +
          `<rect class="pl-station__box" x="${r1(sx - 62)}" y="${r1(sy - 16)}" width="124" height="32" rx="6"/>` +
          `<text class="pl-station__name" x="${r1(sx)}" y="${r1(sy - 2)}" text-anchor="middle">${esc(st.label)}</text>` +
          `<rect class="pl-station__track" x="${r1(sx - 52)}" y="${r1(sy + 5)}" width="104" height="4" rx="2"/>` +
          `<rect class="pl-station__bar" data-bar x="${r1(sx - 52)}" y="${r1(sy + 5)}" width="0" height="4" rx="2" data-w="104"/>` +
          `</g>`,
      );
    }
  });

  const entry = palletEntry(layout);
  if (entry) {
    const { pt, nx, ny } = outward(entry.s - layout.palletLength / 2);
    const ex = X(pt.x) - nx * (BW / 2 + 14);
    const ey = Y(pt.y) - ny * (BW / 2 + 14);
    out.push(
      `<g class="pl-entry"><title>Las paletas nuevas entran siempre por aquí</title><circle cx="${r1(ex)}" cy="${r1(ey)}" r="4"/><text class="pl-label pl-label--small" x="${r1(ex)}" y="${r1(ey - ny * 14 + 3)}" text-anchor="middle">Entrada</text></g>`,
    );
  }
  out.push('<g data-pallets></g></svg>');

  // ---- Actualización por fotograma ----------------------------------------
  const plen = layout.palletLength * k;
  const update = (svg: SVGSVGElement, plant: Plant) => {
    const g = svg.querySelector('[data-pallets]')!;
    if (g.childElementCount !== plant.pallets.length) {
      g.innerHTML = plant.pallets
        .map(
          (p) =>
            `<g class="pl-pallet" data-pallet="${p.id}"><rect x="${r1(-plen / 2)}" y="${-(BW / 2 - 3)}" width="${r1(plen)}" height="${BW - 6}" rx="3"/><text class="pl-pallet__id" x="0" y="4" text-anchor="middle">P${p.id}</text></g>`,
        )
        .join('');
    }
    plant.pallets.forEach((p) => {
      const el = g.querySelector<SVGGElement>(`[data-pallet="${p.id}"]`);
      if (!el) return;
      const mid = pointAt(layout, p.front - layout.palletLength / 2);
      el.setAttribute('transform', `translate(${r1(X(mid.x))} ${r1(Y(mid.y))}) rotate(${r1((mid.heading * 180) / Math.PI)})`);
      el.classList.toggle('is-stopped', !p.moving);
    });
    svg.querySelectorAll<SVGLineElement>('[data-pin]').forEach((pin) => {
      const cyl = pin.closest<SVGGElement>('[data-stop]')!.dataset.stop!;
      const pos = plant.cylinder.get(cyl) ?? 0;
      const f = 1 - pos; // cerrado = pasador fuera
      const ox = Number(pin.dataset.ox);
      const oy = Number(pin.dataset.oy);
      pin.setAttribute('x2', String(r1(ox + Number(pin.dataset.dx) * f)));
      pin.setAttribute('y2', String(r1(oy + Number(pin.dataset.dy) * f)));
      const grp = pin.closest('[data-stop]')!;
      grp.classList.toggle('is-open', pos >= 1);
      grp.classList.toggle('is-moving', pos > 0 && pos < 1);
    });
    svg.querySelectorAll<SVGGElement>('[data-sensor]').forEach((s) => {
      s.classList.toggle('is-on', plant.sim.states[s.dataset.sensor!] === 1);
    });
    svg.querySelectorAll<SVGGElement>('[data-station]').forEach((s) => {
      const st = plant.stations.find((x) => x.stop === s.dataset.station);
      const bar = s.querySelector<SVGRectElement>('[data-bar]');
      if (!st || !bar) return;
      const frac = st.pallet === null ? 0 : st.done ? 1 : Math.min(1, st.timer / Math.max(1, st.cycleMs));
      bar.setAttribute('width', String(r1(Number(bar.dataset.w) * frac)));
      s.classList.toggle('is-working', st.pallet !== null && !st.done);
      s.classList.toggle('is-done', st.done);
    });
    const motorOn = plant.motorOn();
    svg.querySelector('[data-motor]')?.classList.toggle('is-on', motorOn);
    const chain = svg.querySelector<SVGPathElement>('[data-chain]');
    if (chain) chain.style.strokeDashoffset = String(r1(-(((plant.time / 1000) * layout.speed * k) % 24)));
  };

  return { svg: out.join(''), update };
}
