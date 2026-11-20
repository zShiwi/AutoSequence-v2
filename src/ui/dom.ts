/**
 * Utilidades de interfaz: escapado, iconos, avisos, diálogos y descargas.
 *
 * Sustituye a los alert()/confirm()/prompt() nativos del prototipo, que
 * bloqueaban la página y daban un aspecto poco profesional.
 */

/** Escapa texto para interpolarlo en HTML o en atributos. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Crea un elemento a partir de un fragmento HTML (un solo nodo raíz). */
export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as T;
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`No se encuentra ${sel}`);
  return el as T;
}

// ---- Iconos (trazo 1.75, 20×20) -------------------------------------------

const P: Record<string, string> = {
  plus: '<path d="M10 4v12M4 10h12"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>',
  edit: '<path d="M4 16h3l8.5-8.5-3-3L4 13v3z"/><path d="M11 6l3 3"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M4 13V5.5A1.5 1.5 0 0 1 5.5 4H13"/>',
  download: '<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>',
  upload: '<path d="M10 13V3M6 7l4-4 4 4M4 16h12"/>',
  play: '<path d="M6 4l10 6-10 6z"/>',
  reset: '<path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M4 3v3.5h3.5"/>',
  chevronLeft: '<path d="M12 4l-6 6 6 6"/>',
  chevronRight: '<path d="M8 4l6 6-6 6"/>',
  signals: '<path d="M3 14h3V6h4v8h4V9h3"/>',
  logic: '<path d="M3 6h5M3 14h5M8 4v12M8 10h4l3-3M12 10l3 3"/>',
  wave: '<path d="M2 14h3V6h3v8h3V6h3v8h4"/>',
  code: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12"/>',
  sheet: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 13h14M10 13v3M7 4v9"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l1.5 2h6A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  alert: '<path d="M10 3l8 14H2z"/><path d="M10 8v4M10 14.5v.5"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  duplicate: '<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M7 17h8.5a1.5 1.5 0 0 0 1.5-1.5V7"/>',
  printer: '<path d="M6 8V3h8v5"/><rect x="3" y="8" width="14" height="6" rx="1"/><path d="M6 12h8v5H6z"/>',
  pulse: '<path d="M2 12h4l2-6 4 10 2-4h4"/>',
  moon: '<path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/>',
  undo: '<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 0 0 0 10h2"/>',
  history: '<path d="M3 10a7 7 0 1 0 2-4.9"/><path d="M3 3v3.5h3.5"/><path d="M10 6v4l3 2"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
  archive: '<rect x="3" y="4" width="14" height="4" rx="1"/><path d="M4.5 8v7.5A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V8M8 11h4"/>',
  conveyor: '<rect x="2" y="7" width="16" height="6" rx="3"/><circle cx="5" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/><path d="M8 4h4M9 4v3M11 4v3"/>',
  pause: '<path d="M7 4v12M13 4v12"/>',
  grip: '<path d="M7 5h.01M7 10h.01M7 15h.01M13 5h.01M13 10h.01M13 15h.01" stroke-width="2.5"/>',
  arrowUp: '<path d="M10 16V4M5 9l5-5 5 5"/>',
  arrowDown: '<path d="M10 4v12M5 11l5 5 5-5"/>',
  cylinder: '<rect x="2" y="7" width="10" height="6" rx="1"/><path d="M12 10h6M16 8v4"/>',
  motor: '<circle cx="10" cy="10" r="6"/><path d="M8 13V7l2 3 2-3v6"/>',
  sensor: '<path d="M4 10h5"/><circle cx="12" cy="10" r="3"/><path d="M16 6.5a5 5 0 0 1 0 7"/>',
  help: '<circle cx="10" cy="10" r="7"/><path d="M7.8 8a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.8-1.1 1.6M10 14.2v.3"/>',
  virtual: '<rect x="4" y="4" width="12" height="12" rx="2" stroke-dasharray="2 2"/><path d="M8 10h4"/>',
};

export function icon(name: keyof typeof P | string, size = 18): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

// ---- Avisos ---------------------------------------------------------------

export type ToastKind = 'ok' | 'info' | 'warn' | 'error';

function toastHost(): HTMLElement {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('<div id="toasts" class="toasts" role="status" aria-live="polite"></div>');
    document.body.appendChild(host);
  }
  return host;
}

/** Avisos a la vez en pantalla; al pasar de aquí se retira el más antiguo. */
const TOAST_MAX = 3;

interface LiveToast {
  key: string;
  el: HTMLElement;
  timer: number;
}
const liveToasts: LiveToast[] = [];

/**
 * Publica el alto que ocupan los avisos (--toast-space): en móvil la página
 * reserva ese hueco al final para que no tapen lo que hay al pie.
 */
function syncToastSpace(): void {
  const host = document.getElementById('toasts');
  const space = host && liveToasts.length ? host.offsetHeight + 20 : 0;
  document.documentElement.style.setProperty('--toast-space', `${space}px`);
}

function dismissToast(t: LiveToast): void {
  const i = liveToasts.indexOf(t);
  if (i < 0) return;
  liveToasts.splice(i, 1);
  window.clearTimeout(t.timer);
  t.el.classList.remove('is-in');
  window.setTimeout(() => {
    t.el.remove();
    syncToastSpace();
  }, 250);
}

/**
 * Aviso emergente. Desaparece solo, o antes si se toca. Un aviso idéntico a
 * otro que sigue en pantalla no se apila: renueva el que ya está.
 */
export function toast(message: string, kind: ToastKind = 'ok', ms = 3200): void {
  const key = `${kind}\n${message}`;
  const same = liveToasts.find((t) => t.key === key);
  if (same) {
    window.clearTimeout(same.timer);
    same.timer = window.setTimeout(() => dismissToast(same), ms);
    toastHost().appendChild(same.el);
    return;
  }
  const ic = { ok: 'check', info: 'info', warn: 'alert', error: 'alert' }[kind];
  const el = h(`<div class="toast toast--${kind}" title="Toca para cerrar">${icon(ic)}<span>${esc(message)}</span></div>`);
  const t: LiveToast = { key, el, timer: 0 };
  liveToasts.push(t);
  while (liveToasts.length > TOAST_MAX) dismissToast(liveToasts[0]);
  toastHost().appendChild(el);
  syncToastSpace();
  requestAnimationFrame(() => el.classList.add('is-in'));
  el.addEventListener('click', () => dismissToast(t));
  t.timer = window.setTimeout(() => dismissToast(t), ms);
}

// ---- Diálogos -------------------------------------------------------------

interface ModalAction {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
  /** Devuelve false para mantener el diálogo abierto. */
  run?: () => boolean | void;
}

/** Diálogos abiertos, el último encima. */
const modalStack: HTMLElement[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function modal(opts: {
  title: string;
  body: string | HTMLElement;
  actions: ModalAction[];
  wide?: boolean;
  onClose?: () => void;
}): { close: () => void; root: HTMLElement } {
  const root = h(`
    <div class="modal-backdrop">
      <div class="modal${opts.wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal__head">
          <h2 id="modal-title">${esc(opts.title)}</h2>
          <button class="icon-btn" data-close aria-label="Cerrar" title="Cerrar (Esc)">${icon('x')}</button>
        </header>
        <div class="modal__body"></div>
        <footer class="modal__foot"></footer>
      </div>
    </div>`);
  const body = qs(root, '.modal__body');
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else body.appendChild(opts.body);

  const prevFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    const at = modalStack.indexOf(root);
    if (at >= 0) modalStack.splice(at, 1);
    root.remove();
    prevFocus?.focus?.();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    // Con varios diálogos apilados, el teclado es solo del de arriba.
    if (modalStack[modalStack.length - 1] !== root) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      close();
    } else if (e.key === 'Tab') {
      // El foco no sale del diálogo: da la vuelta.
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });
  qs(root, '[data-close]').addEventListener('click', close);

  const foot = qs(root, '.modal__foot');
  opts.actions.forEach((a) => {
    const btn = h<HTMLButtonElement>(
      `<button class="btn btn--${a.variant ?? 'ghost'}">${esc(a.label)}</button>`,
    );
    btn.addEventListener('click', () => {
      if (a.run?.() === false) return;
      close();
    });
    foot.appendChild(btn);
  });

  document.body.appendChild(root);
  modalStack.push(root);
  const focusable = root.querySelector<HTMLElement>('input, select, textarea') ??
    foot.querySelector<HTMLElement>('.btn--primary, .btn--danger');
  focusable?.focus();
  return { close, root };
}

export function confirmDialog(
  title: string,
  message: string,
  opts: { confirm?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: `<p class="modal__text">${message}</p>`,
      onClose: () => {
        if (!answered) resolve(false);
      },
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: opts.confirm ?? 'Aceptar',
          variant: opts.danger ? 'danger' : 'primary',
          run: () => {
            answered = true;
            resolve(true);
          },
        },
      ],
    });
  });
}

export function promptDialog(
  title: string,
  label: string,
  value = '',
  opts: { confirm?: string; validate?: (v: string) => string | null; hint?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const form = h(`
      <form class="field" novalidate>
        <label class="field__label" for="prompt-input">${esc(label)}</label>
        <input id="prompt-input" class="input" value="${esc(value)}" autocomplete="off" />
        ${opts.hint ? `<p class="field__hint">${esc(opts.hint)}</p>` : ''}
        <p class="field__error" hidden></p>
      </form>`);
    const input = qs<HTMLInputElement>(form, 'input');
    const err = qs(form, '.field__error');
    let answered = false;
    const submit = (): boolean => {
      const v = input.value.trim();
      const problem = opts.validate?.(v) ?? (v ? null : 'Este campo es obligatorio.');
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return false;
      }
      answered = true;
      resolve(v);
      return true;
    };
    const m = modal({
      title,
      body: form,
      onClose: () => {
        if (!answered) resolve(null);
      },
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        { label: opts.confirm ?? 'Guardar', variant: 'primary', run: submit },
      ],
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submit()) m.close();
    });
    input.select();
  });
}

// ---- Descargas ------------------------------------------------------------

interface ViewerDownloads {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}
interface ViewerBridge {
  use(name: 'downloads'): Promise<ViewerDownloads | null>;
}

/** Extensiones que el visor de claude.ai acepta al guardar archivos. */
const VIEWER_EXT = /\.(txt|json|md|csv|svg|html|pdf|png|jpg|jpeg|zip)$/i;

/**
 * Descarga un archivo generado. Dentro del visor de claude.ai usa su
 * mecanismo de descargas (el visor bloquea los enlaces normales); fuera de
 * él, un enlace de descarga del navegador.
 */
export async function download(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
  okMessage?: string,
): Promise<boolean> {
  const bridge = (window as unknown as { claude?: ViewerBridge }).claude;
  if (bridge?.use) {
    const dl = await bridge.use('downloads').catch(() => null);
    if (dl) {
      const name = VIEWER_EXT.test(filename) ? filename : `${filename}.txt`;
      try {
        await dl.save({ filename: name, data: content });
        if (okMessage) toast(okMessage);
        return true;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'declined') return false;
        toast(
          code === 'rate_limited'
            ? 'Ya hay una descarga pendiente de confirmar.'
            : 'No se pudo descargar el archivo en esta vista.',
          'warn',
        );
        return false;
      }
    }
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (okMessage) toast(okMessage);
  return true;
}

/** Fecha local como AAAA-MM-DD (la de `toISOString` es UTC y de madrugada da el día anterior). */
export function dateStamp(d: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Nombres que Windows reserva para dispositivos y no admite como archivo. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Nombre de archivo legible a partir de un texto libre, válido en Windows:
 * sin `< > : " / \\ | ? *` ni caracteres de control, sin punto ni espacio al
 * final, sin nombres reservados y de longitud razonable.
 */
export function safeFileName(text: string, fallback = 'Proyecto'): string {
  let name = text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (name.length > 80) name = name.slice(0, 80).replace(/[. ]+$/, '');
  if (!name) return fallback;
  return WINDOWS_RESERVED.test(name) ? `_${name}` : name;
}

/** Nombre del archivo de exportación: «ACU 4 topes · 2026-11-20.json». */
export function exportFileName(projectName: string, date: Date = new Date()): string {
  return `${safeFileName(projectName)} · ${dateStamp(date)}.json`;
}

export function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'proyecto'
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---- Ayudas de los botones de icono ---------------------------------------

const ICON_BUTTONS = 'button, [role="button"], a.icon-btn';

function labelIconButton(el: Element): void {
  if (!el.matches(ICON_BUTTONS)) return;
  const title = el.getAttribute('title');
  const label = el.getAttribute('aria-label');
  if (label && !title) el.setAttribute('title', label);
  // Con texto visible el botón ya tiene nombre: solo se completa si es de icono.
  else if (title && !label && !el.textContent?.trim()) el.setAttribute('aria-label', title);
}

/**
 * Garantiza que todo botón con nombre accesible tenga también ayuda emergente
 * (title), y que el que solo lleva icono tenga nombre accesible (aria-label):
 * si falta uno, se copia del otro. Vigila los cambios del documento, porque
 * las vistas se pintan con HTML generado.
 */
export function watchIconButtons(root: HTMLElement = document.body): void {
  const scan = (node: Element) => {
    labelIconButton(node);
    node.querySelectorAll(ICON_BUTTONS).forEach(labelIconButton);
  };
  scan(root);
  new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'attributes') labelIconButton(c.target as Element);
      else c.addedNodes.forEach((n) => n instanceof Element && scan(n));
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
}
