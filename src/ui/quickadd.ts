/**
 * Alta rápida de señales.
 *
 * «Tope» crea de una vez el cilindro con sus inductivos de activo (abierto) y
 * reposo (cerrado) y el sensor de presencia de la paleta en ese tope; con
 * escribir solo el nombre basta. Sensor, motor y marca crean una señal suelta
 * con un nombre libre propuesto.
 */

import { commit, project } from '../state/store';
import {
  buildStop,
  nextFreeName,
  proposeStop,
  stopDraftErrors,
  stopInductivos,
  takenNames,
  validateSignalName,
  type StopDraft,
} from '../plc/signals';
import type { Signal, SignalType } from '../types';
import { esc, h, icon, modal, qs, toast } from './dom';

export type QuickKind = 'stop' | 'Sensor' | 'Motor' | 'Virtual';

export const QUICK_KINDS: { kind: QuickKind; title: string; hint: string; icon: string }[] = [
  { kind: 'stop', title: 'Tope', hint: 'Cilindro + inductivos activo/reposo + presencia', icon: 'cylinder' },
  { kind: 'Sensor', title: 'Sensor', hint: 'Entrada digital', icon: 'sensor' },
  { kind: 'Motor', title: 'Motor', hint: 'Salida digital', icon: 'motor' },
  { kind: 'Virtual', title: 'Marca', hint: 'Marca interna', icon: 'virtual' },
];

/** Botonera de alta rápida (se pinta en la cabecera de Señales). */
export function quickAddBar(): string {
  return `<div class="quickadd" role="group" aria-label="Añadir señales">
    ${QUICK_KINDS.map(
      (k) => `<button type="button" class="quickadd__btn${k.kind === 'stop' ? ' quickadd__btn--main' : ''}" data-quick="${k.kind}">
        <span class="quickadd__ico type-ico type-ico--${k.kind === 'stop' ? 'cilindro' : k.kind.toLowerCase()}">${icon(k.icon, 16)}</span>
        <span class="quickadd__txt"><strong>${icon('plus', 13)}${esc(k.title)}</strong><small>${esc(k.hint)}</small></span>
      </button>`,
    ).join('')}
  </div>`;
}

/** Abre el formulario de alta rápida; `done` recibe los nombres creados. */
export function openQuickAdd(kind: QuickKind, done: (created: string[]) => void): void {
  if (kind === 'stop') openStop(done);
  else openSimple(kind, done);
}

// ---------------------------------------------------------------------------

function field(name: string, label: string, value: string, opts: { mono?: boolean; placeholder?: string } = {}): string {
  return `<label class="field"><span class="field__label">${esc(label)}</span>
    <input class="input${opts.mono ? ' input--mono' : ''}" name="${name}" value="${esc(value)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} spellcheck="false" autocomplete="off" />
    <span class="field__error" data-err="${name}" hidden></span></label>`;
}

function openStop(done: (created: string[]) => void): void {
  const p = project();
  const d: StopDraft = proposeStop(p.signals);
  /** Los campos derivados siguen al nombre hasta que se editan a mano. */
  const auto = { activo: true, reposo: true, presenceDescription: true };
  let withPresence = true;

  const body = h(`
    <form class="qa-form" novalidate>
      <div class="form-grid form-grid--2">
        ${field('name', 'Nombre del cilindro', d.name, { mono: true })}
        ${field('description', 'Descripción', d.description, { placeholder: 'p. ej. Tope de carga' })}
      </div>
      <fieldset class="qa-group">
        <legend>Inductivos de posición <span class="muted">· van en el propio cilindro</span></legend>
        <div class="form-grid form-grid--2">
          ${field('activo', 'Activo · tope abierto', d.activo, { mono: true })}
          ${field('reposo', 'Reposo · tope cerrado', d.reposo, { mono: true })}
        </div>
      </fieldset>
      <fieldset class="qa-group">
        <legend><label class="check"><input type="checkbox" name="withPresence" checked /> Crear sensor de presencia en el tope</label></legend>
        <div class="form-grid form-grid--2" data-presence>
          ${field('presence', 'Sensor de presencia', d.presence, { mono: true })}
          ${field('presenceDescription', 'Descripción', d.presenceDescription)}
        </div>
      </fieldset>
      <div class="qa-preview">
        <p class="qa-preview__title">Se creará</p>
        <ul data-slot="preview"></ul>
      </div>
      ${p.layout ? `<p class="qa-note">${icon('conveyor', 15)} También se añadirá al transportador, en la línea de abajo; luego podrás colocarlo.</p>` : ''}
      <button type="submit" hidden></button>
    </form>`);
  const form = body as HTMLFormElement;
  const input = (n: string) => form.elements.namedItem(n) as HTMLInputElement;

  const read = () => {
    d.name = input('name').value.trim();
    d.description = input('description').value;
    d.activo = input('activo').value.trim();
    d.reposo = input('reposo').value.trim();
    d.presence = withPresence ? input('presence').value.trim() : '';
    d.presenceDescription = input('presenceDescription').value;
  };

  const render = () => {
    read();
    const errs = stopDraftErrors(d, p.signals);
    form.querySelectorAll<HTMLElement>('[data-err]').forEach((el) => {
      const msg = (errs as Record<string, string | undefined>)[el.dataset.err!];
      el.textContent = msg ?? '';
      el.hidden = !msg;
      input(el.dataset.err!).toggleAttribute('aria-invalid', !!msg);
    });
    const n = d.name || '—';
    const items: [string, string, string, string][] = [
      ['cilindro', 'cylinder', n, `Cilindro · ${d.description.trim() || `Tope ${n}`}`],
      ['derived', 'sensor', d.activo || '—', 'Inductivo activo · tope abierto'],
      ['derived', 'sensor', d.reposo || '—', 'Inductivo reposo · tope cerrado'],
    ];
    if (withPresence) items.push(['sensor', 'sensor', d.presence || '—', `Sensor · ${d.presenceDescription.trim() || `Paleta en tope ${n}`}`]);
    qs(form, '[data-slot="preview"]').innerHTML = items
      .map(
        ([cls, ic, name, what]) =>
          `<li><span class="type-ico type-ico--${cls}">${icon(ic, 14)}</span><code>${esc(name)}</code><span class="muted">${esc(what)}</span></li>`,
      )
      .join('');
    return Object.keys(errs).length === 0;
  };

  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'activo') auto.activo = false;
    if (t.name === 'reposo') auto.reposo = false;
    if (t.name === 'presenceDescription') auto.presenceDescription = false;
    if (t.name === 'withPresence') {
      withPresence = t.checked;
      form.querySelector<HTMLElement>('[data-presence]')!.hidden = !withPresence;
    }
    if (t.name === 'name') {
      const ind = stopInductivos(t.value.trim());
      if (auto.activo) input('activo').value = ind.activo;
      if (auto.reposo) input('reposo').value = ind.reposo;
      if (auto.presenceDescription) input('presenceDescription').value = `Paleta en tope ${t.value.trim()}`;
    }
    render();
  });

  const create = (): boolean => {
    if (!render()) {
      form.querySelector<HTMLInputElement>('[aria-invalid]')?.focus();
      return false;
    }
    const created = buildStop(d);
    p.signals.push(...created);
    let onConveyor = false;
    if (p.layout && !p.layout.stops.some((s) => s.cylinder === d.name)) {
      p.layout.stops.push({
        cylinder: d.name,
        ...(d.presence ? { presence: d.presence } : {}),
        line: 'bottom',
        x: Math.round(p.layout.length / 2),
        travelMs: 300,
      });
      onConveyor = true;
    }
    commit({ separate: true });
    toast(
      `Tope ${d.name} creado: inductivos ${d.activo} / ${d.reposo}${d.presence ? ` y presencia ${d.presence}` : ''}.`,
    );
    if (onConveyor)
      toast(`Colócalo en Simulación → Transportador → Medidas y posiciones (ahora está a ${Math.round(p.layout!.length / 2)} mm, abajo).`, 'info', 5200);
    done(created.map((s) => s.name));
    return true;
  };

  const m = modal({
    title: 'Añadir tope',
    body: form,
    wide: true,
    actions: [
      { label: 'Cancelar' },
      { label: 'Crear tope', variant: 'primary', run: create },
    ],
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (create()) m.close();
  });
  render();
  input('name').select();
}

const SIMPLE: Record<Exclude<QuickKind, 'stop'>, { title: string; prefix: string; initial: string; placeholder: string }> = {
  Sensor: { title: 'Añadir sensor', prefix: 'PX', initial: 'Activo al arrancar (=1)', placeholder: 'p. ej. Paleta fuera de interferencia' },
  Motor: { title: 'Añadir motor', prefix: 'M', initial: 'En marcha al arrancar', placeholder: 'p. ej. Motor del transportador' },
  Virtual: { title: 'Añadir marca', prefix: 'SM_', initial: 'Activa al arrancar', placeholder: 'p. ej. Tránsito de paleta' },
};

function openSimple(kind: Exclude<QuickKind, 'stop'>, done: (created: string[]) => void): void {
  const p = project();
  const cfg = SIMPLE[kind];
  const taken = takenNames(p.signals);
  const form = h<HTMLFormElement>(`
    <form class="qa-form" novalidate>
      <div class="form-grid form-grid--2">
        ${field('name', 'Nombre', nextFreeName(cfg.prefix, taken), { mono: true })}
        ${field('description', 'Descripción', '', { placeholder: cfg.placeholder })}
      </div>
      <label class="check"><input type="checkbox" name="initial" /> ${esc(cfg.initial)}</label>
      <button type="submit" hidden></button>
    </form>`);
  const input = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  const check = (): boolean => {
    const n = input('name').value.trim();
    const msg = validateSignalName(n) ?? (taken.has(n) ? `«${n}» ya existe` : null);
    const err = qs(form, '[data-err="name"]');
    err.textContent = msg ?? '';
    err.hidden = !msg;
    input('name').toggleAttribute('aria-invalid', !!msg);
    return !msg;
  };
  form.addEventListener('input', check);
  const create = (): boolean => {
    if (!check()) {
      input('name').focus();
      return false;
    }
    const s: Signal = {
      name: input('name').value.trim(),
      type: kind as SignalType,
      initial: input('initial').checked ? 1 : 0,
      description: input('description').value.trim(),
    };
    p.signals.push(s);
    commit({ separate: true });
    toast(`Señal ${s.name} creada.`);
    done([s.name]);
    return true;
  };
  const m = modal({
    title: cfg.title,
    body: form,
    actions: [
      { label: 'Cancelar' },
      { label: 'Crear', variant: 'primary', run: create },
    ],
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (create()) m.close();
  });
  input('name').select();
}
