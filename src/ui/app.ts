/**
 * Armazón de la aplicación y enrutado.
 *
 * Rutas (hash): #/                 → proyectos
 *               #/p/<id>/<sección> → espacio de trabajo
 *
 * Las vistas gestionan su propio contenido; el armazón solo refresca la barra
 * superior y la navegación cuando cambia el proyecto (autoguardado, recuentos).
 */

import {
  closeProject,
  exportProjectJSON,
  flushSave,
  formatRelative,
  openProject,
  renameProject,
  session,
  subscribe,
  allRules,
  canRedo,
  canUndo,
  redo,
  undo,
} from '../state/store';
import { openVersions } from './backups';
import { download, esc, h, icon, promptDialog, qs, slug, toast } from './dom';
import { renderHome } from './home';
import { renderSignals } from './signals';
import { renderLogic } from './logic';
import { renderSimulation } from './simulation';
import { renderCode } from './code';
import { renderDocs } from './docs';
import { validateSignalName } from '../plc/signals';

export type Section = 'signals' | 'logic' | 'sim' | 'code' | 'docs';

interface SectionDef {
  id: Section;
  title: string;
  icon: string;
  render: (app: App) => HTMLElement;
}

export const SECTIONS: SectionDef[] = [
  { id: 'signals', title: 'Señales', icon: 'signals', render: renderSignals },
  { id: 'logic', title: 'Lógica', icon: 'logic', render: renderLogic },
  { id: 'sim', title: 'Simulación', icon: 'wave', render: renderSimulation },
  { id: 'code', title: 'Código PLC', icon: 'code', render: renderCode },
  { id: 'docs', title: 'Documentación', icon: 'sheet', render: renderDocs },
];

const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="5" fill="var(--brand)"/><path d="M5 19h4v-5h4V9h4V5h4" fill="none" stroke="var(--brand-ink)" stroke-width="2.2" stroke-linecap="square"/><circle cx="21" cy="5" r="1.9" fill="var(--accent)"/></svg>`;

export class App {
  private root: HTMLElement;
  private view: HTMLElement | null = null;
  section: Section | null = null;
  private unsub: (() => void) | null = null;
  private tick: number | undefined;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('beforeunload', () => flushSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.route();
  }

  // ---- Deshacer / rehacer ------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!session.project || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
    if (!isUndo && !isRedo) return;
    // En un campo de texto, Ctrl+Z deshace lo escrito en ese campo.
    const t = e.target as HTMLElement | null;
    const typing =
      t &&
      ((t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes((t as HTMLInputElement).type)) ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable);
    if (typing || document.querySelector('.modal-backdrop')) return;
    e.preventDefault();
    if (isUndo) this.undo();
    else this.redo();
  }

  undo(): void {
    if (undo()) {
      this.refresh();
      toast('Cambio deshecho.', 'info', 1800);
    } else toast('No hay nada que deshacer.', 'info', 1600);
  }

  redo(): void {
    if (redo()) {
      this.refresh();
      toast('Cambio rehecho.', 'info', 1800);
    } else toast('No hay nada que rehacer.', 'info', 1600);
  }

  // ---- Navegación --------------------------------------------------------

  goHome(): void {
    location.hash = '#/';
  }

  go(section: Section): void {
    const p = session.project;
    if (!p) return this.goHome();
    location.hash = `#/p/${p.id}/${section}`;
  }

  /** Vuelve a pintar la sección actual (tras cambios masivos de datos). */
  refresh(): void {
    if (this.section) this.renderWorkspace(this.section);
  }

  openProject(id: string, section: Section = 'signals'): void {
    location.hash = `#/p/${id}/${section}`;
  }

  private route(): void {
    const m = location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
    if (!m) {
      if (session.project) closeProject();
      this.renderHome();
      return;
    }
    const [, id, sec] = m;
    if (!session.project || session.project.id !== id) {
      if (session.project) closeProject();
      if (!openProject(id)) {
        toast('Ese proyecto ya no existe.', 'warn');
        this.goHome();
        return;
      }
    }
    const section = (SECTIONS.find((s) => s.id === sec)?.id ?? 'signals') as Section;
    this.renderWorkspace(section);
  }

  // ---- Pantallas ---------------------------------------------------------

  private renderHome(): void {
    this.unsub?.();
    this.unsub = null;
    window.clearInterval(this.tick);
    this.section = null;
    document.title = 'AutoSequence · Proyectos';
    this.root.replaceChildren(
      h(`<div class="shell shell--home">${this.topbarHTML(false)}<main class="main main--home" id="view"></main></div>`),
    );
    this.bindTopbar();
    qs(this.root, '#view').appendChild(renderHome(this));
  }

  private renderWorkspace(section: Section): void {
    const needsShell = !this.root.querySelector('.shell--work');
    if (needsShell) {
      this.root.replaceChildren(
        h(`<div class="shell shell--work">
            ${this.topbarHTML(true)}
            <nav class="sidenav" aria-label="Secciones del proyecto"><ol class="steps"></ol></nav>
            <main class="main" id="view"></main>
          </div>`),
      );
      this.bindTopbar();
      this.unsub?.();
      this.unsub = subscribe(() => this.refreshChrome());
      window.clearInterval(this.tick);
      this.tick = window.setInterval(() => this.refreshSaveStatus(), 15000);
    }
    this.section = section;
    const def = SECTIONS.find((s) => s.id === section)!;
    document.title = `${def.title} · ${session.project?.name ?? ''} · AutoSequence`;
    const host = qs(this.root, '#view');
    this.view = def.render(this);
    host.replaceChildren(this.view);
    host.scrollTop = 0;
    window.scrollTo({ top: 0 });
    this.refreshChrome();
  }

  // ---- Barra superior ------------------------------------------------------

  private topbarHTML(inProject: boolean): string {
    return `
      <header class="topbar">
        <a class="brand" href="#/" aria-label="AutoSequence, ir a proyectos">${LOGO}<span class="brand__name">AutoSequence</span></a>
        <div class="crumbs">
          ${
            inProject
              ? `<a href="#/" class="crumbs__link">Proyectos</a><span class="crumbs__sep">/</span>
                 <button class="crumbs__project" data-act="rename" title="Renombrar proyecto"><span data-slot="pname"></span>${icon('edit', 14)}</button>`
              : `<span class="crumbs__here">Proyectos</span>`
          }
        </div>
        <div class="topbar__right">
          ${inProject ? `<span class="save-state" data-slot="save" aria-live="polite"></span>
             <div class="topbar__group" role="group" aria-label="Historial de cambios">
               <button class="icon-btn" data-act="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">${icon('undo', 18)}</button>
               <button class="icon-btn" data-act="redo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer">${icon('redo', 18)}</button>
               <button class="icon-btn" data-act="versions" title="Versiones guardadas" aria-label="Versiones guardadas">${icon('history', 18)}</button>
             </div>
             <button class="btn btn--ghost btn--sm" data-act="export" title="Descargar el proyecto como archivo .json">${icon('download', 16)}<span>Exportar</span></button>` : ''}
          <button class="icon-btn" data-act="theme" aria-label="Cambiar tema claro/oscuro" title="Cambiar tema">${icon('moon', 18)}</button>
        </div>
      </header>`;
  }

  private bindTopbar(): void {
    this.root.querySelector('[data-act="theme"]')?.addEventListener('click', toggleTheme);
    this.root.querySelector('[data-act="undo"]')?.addEventListener('click', () => this.undo());
    this.root.querySelector('[data-act="redo"]')?.addEventListener('click', () => this.redo());
    this.root.querySelector('[data-act="versions"]')?.addEventListener('click', () => openVersions(this));
    this.root.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const p = session.project;
      if (!p) return;
      flushSave();
      void download(`${slug(p.name)}.autosequence.json`, exportProjectJSON(p), 'application/json', 'Proyecto exportado como JSON.');
    });
    this.root.querySelector('[data-act="rename"]')?.addEventListener('click', async () => {
      const p = session.project;
      if (!p) return;
      const name = await promptDialog('Renombrar proyecto', 'Nombre del proyecto', p.name, {
        validate: (v) => (v ? null : 'El nombre no puede estar vacío.'),
      });
      if (name === null) return;
      const err = renameProject(name);
      if (err) toast(err, 'error');
      else toast('Proyecto renombrado.');
    });
    syncThemeIcon();
  }

  private refreshSaveStatus(): void {
    const el = this.root.querySelector('[data-slot="save"]');
    if (!el) return;
    const st = session.saveStatus;
    el.className = `save-state save-state--${st}`;
    el.innerHTML =
      st === 'pending'
        ? `<span class="dot"></span>Guardando…`
        : st === 'error'
          ? `${icon('alert', 14)}No se pudo guardar (almacenamiento lleno o bloqueado)`
          : `${icon('check', 14)}Guardado ${esc(formatRelative(session.lastSaved ?? session.project?.updatedAt))}`;
  }

  private refreshChrome(): void {
    const p = session.project;
    if (!p) return;
    const pname = this.root.querySelector('[data-slot="pname"]');
    if (pname) pname.textContent = p.name;
    this.refreshSaveStatus();
    this.root.querySelector<HTMLButtonElement>('[data-act="undo"]')?.toggleAttribute('disabled', !canUndo());
    this.root.querySelector<HTMLButtonElement>('[data-act="redo"]')?.toggleAttribute('disabled', !canRedo());

    const list = this.root.querySelector('.steps');
    if (!list) return;
    const rules = allRules();
    const badNames = p.signals.filter((s) => validateSignalName(s.name)).length;
    const meta: Record<Section, { text: string; state: 'ok' | 'warn' | 'empty' }> = {
      signals: {
        text: `${p.signals.length} señal${p.signals.length === 1 ? '' : 'es'}`,
        state: badNames ? 'warn' : p.signals.length ? 'ok' : 'empty',
      },
      logic: {
        text: `${rules.length} regla${rules.length === 1 ? '' : 's'} · ${p.blocks.length} bloque${p.blocks.length === 1 ? '' : 's'}`,
        state: rules.length ? 'ok' : 'empty',
      },
      sim: { text: rules.length ? 'Lista para simular' : 'Requiere reglas', state: rules.length ? 'ok' : 'empty' },
      code: { text: rules.length ? 'AWL · KOP · Símbolos' : 'Requiere reglas', state: rules.length ? 'ok' : 'empty' },
      docs: { text: 'Hojas A3 con cajetín', state: rules.length ? 'ok' : 'empty' },
    };
    list.innerHTML = SECTIONS.map(
      (s, i) => `
      <li>
        <a class="step${s.id === this.section ? ' is-current' : ''}" href="#/p/${esc(p.id)}/${s.id}" ${s.id === this.section ? 'aria-current="page"' : ''}>
          <span class="step__num">${i + 1}</span>
          <span class="step__body"><span class="step__title">${icon(s.icon, 16)}${s.title}</span><span class="step__meta">${esc(meta[s.id].text)}</span></span>
          <span class="step__state step__state--${meta[s.id].state}" aria-hidden="true"></span>
        </a>
      </li>`,
    ).join('');
    // En móvil la navegación es una tira horizontal: mantener visible el paso actual.
    if (matchMedia('(max-width: 900px)').matches) {
      list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
}

// ---- Tema --------------------------------------------------------------

const THEME_KEY = 'autosequence_theme';

export function initTheme(): void {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  } catch {
    /* sin almacenamiento: se usa el tema del sistema */
  }
}

function currentTheme(): 'dark' | 'light' {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme(): void {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* preferencia no persistente */
  }
  syncThemeIcon();
}

function syncThemeIcon(): void {
  const btn = document.querySelector('[data-act="theme"]');
  if (btn) btn.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18);
}
