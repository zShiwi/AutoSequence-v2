/**
 * Atajos de teclado de la aplicación.
 *
 * `shortcutFor` decide qué atajo corresponde a una pulsación (función pura,
 * sin DOM, para poder probarla) y `openShortcuts` muestra el panel de ayuda.
 */

import { esc, h, modal } from './dom';

export type ShortcutAction =
  | { type: 'help' }
  | { type: 'search' }
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'section'; index: number };

/** Lo que se necesita saber de la pulsación (subconjunto de KeyboardEvent). */
export interface KeyInfo {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** AltGr en teclados españoles: llega como Ctrl+Alt y escribe |, @, #… */
  altGraph?: boolean;
}

export interface KeyContext {
  /** El foco está en un campo donde se escribe. */
  typing: boolean;
  /** Hay un diálogo abierto. */
  modalOpen: boolean;
  /** Hay un proyecto abierto. */
  inProject: boolean;
}

/** Número de pasos del flujo de trabajo (Alt+1 … Alt+5). */
export const SECTION_COUNT = 5;

export function shortcutFor(e: KeyInfo, ctx: KeyContext): ShortcutAction | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  const alt = !!e.altKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // Ctrl+S vale siempre (también escribiendo o con un diálogo abierto): así
  // el navegador no ofrece guardar la página.
  if (mod && !alt && !e.shiftKey && key === 's') return { type: 'save' };

  // Con un diálogo abierto solo queda «?», que cierra la propia ayuda.
  if (ctx.modalOpen) return !ctx.typing && !mod && !alt && key === '?' ? { type: 'help' } : null;

  if (mod && !alt && !e.shiftKey && key === 'k') return { type: 'search' };

  if (alt && !mod && !e.shiftKey && !e.altGraph) {
    // Por código de tecla: con Alt, en macOS la tecla escribe otro carácter.
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '') ?? /^([1-9])$/.exec(e.key);
    const n = m ? Number(m[1]) : 0;
    if (n >= 1 && n <= SECTION_COUNT) return ctx.inProject ? { type: 'section', index: n - 1 } : null;
  }

  // En un campo de texto, Ctrl+Z deshace lo escrito en ese campo.
  if (ctx.typing) return null;

  if (mod && !alt && ctx.inProject) {
    if (key === 'z' && !e.shiftKey) return { type: 'undo' };
    if (key === 'y' || (key === 'z' && e.shiftKey)) return { type: 'redo' };
  }
  if (!mod && !alt) {
    if (key === '?') return { type: 'help' };
    if (key === '/') return { type: 'search' };
  }
  return null;
}

/** ¿Se está escribiendo en este elemento? */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'file', 'range', 'submit', 'reset', 'color'].includes(
    (el as HTMLInputElement).type,
  );
}

// ---- Panel de ayuda -------------------------------------------------------

interface ShortcutRow {
  keys: string[][];
  text: string;
}

/** Todos los atajos, agrupados. Es lo que lista el panel de ayuda. */
export const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'General',
    rows: [
      { keys: [['?']], text: 'Abrir o cerrar esta ayuda' },
      { keys: [['Ctrl', 'K'], ['/']], text: 'Buscar (señales, reglas o proyectos)' },
      { keys: [['Ctrl', 'S']], text: 'Guardar ahora' },
      { keys: [['Esc']], text: 'Cerrar el diálogo abierto o borrar la búsqueda' },
    ],
  },
  {
    title: 'Proyecto',
    rows: [
      { keys: [['Ctrl', 'Z']], text: 'Deshacer el último cambio' },
      { keys: [['Ctrl', 'Y'], ['Ctrl', 'Mayús', 'Z']], text: 'Rehacer' },
      { keys: [['Alt', '1']], text: 'Ir a Señales' },
      { keys: [['Alt', '2']], text: 'Ir a Lógica' },
      { keys: [['Alt', '3']], text: 'Ir a Simulación' },
      { keys: [['Alt', '4']], text: 'Ir a Código PLC' },
      { keys: [['Alt', '5']], text: 'Ir a Documentación' },
    ],
  },
  {
    title: 'Diálogos y formularios',
    rows: [
      { keys: [['Intro']], text: 'Aceptar el diálogo' },
      { keys: [['Tab'], ['Mayús', 'Tab']], text: 'Pasar al campo siguiente o al anterior' },
    ],
  },
];

const combo = (keys: string[]) => keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="keys__plus">+</span>');

let helpOpen: { close: () => void; root: HTMLElement } | null = null;

export function shortcutsOpen(): boolean {
  return helpOpen !== null;
}

/** Abre el panel de atajos; si ya está abierto, lo cierra. */
export function openShortcuts(): void {
  if (helpOpen) {
    helpOpen.close();
    return;
  }
  const body = h(`
    <div class="shortcuts">
      ${SHORTCUT_GROUPS.map(
        (g) => `
        <section class="shortcuts__group">
          <h3>${esc(g.title)}</h3>
          <dl>
            ${g.rows
              .map(
                (r) =>
                  `<div class="shortcuts__row"><dt>${esc(r.text)}</dt><dd>${r.keys.map((k) => `<span class="keys">${combo(k)}</span>`).join('<span class="keys__or">o</span>')}</dd></div>`,
              )
              .join('')}
          </dl>
        </section>`,
      ).join('')}
      <p class="muted small">Los atajos de una sola tecla no actúan mientras escribes en un campo. En Mac, usa <kbd>⌘</kbd> en lugar de <kbd>Ctrl</kbd>.</p>
    </div>`);
  helpOpen = modal({
    title: 'Atajos de teclado',
    body,
    wide: true,
    actions: [{ label: 'Cerrar', variant: 'primary' }],
    onClose: () => {
      helpOpen = null;
    },
  });
  helpOpen.root.querySelector('.modal')?.classList.add('modal--shortcuts');
}
