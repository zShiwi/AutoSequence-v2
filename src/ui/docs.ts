/** Paso 5 · Documentación: hojas A3 con cajetín, portada e impresión. */

import { allRules, project, setCajetin } from '../state/store';
import { runAutoScenario } from '../plc/simulation';
import { buildSymbolTable } from '../plc/addresses';
import { cleanSignals, derivedSignals, signalsUsedBy } from '../plc/signals';
import { buildRows } from '../diagram/timing';
import { renderCover, renderSheet } from '../diagram/sheet';
import { standaloneSvg } from '../diagram/ladder';
import type { Cajetin, Project } from '../types';
import { download, esc, h, icon, modal, qs, slug, toast } from './dom';
import type { App } from './app';

const FIELDS: { key: keyof Cajetin; label: string; hint?: string; type?: string }[] = [
  { key: 'company', label: 'Empresa' },
  { key: 'companySubtitle', label: 'Departamento / subtítulo' },
  { key: 'designer', label: 'Diseñador' },
  { key: 'responsible', label: 'Responsable del proyecto' },
  { key: 'docType', label: 'Tipo de documento', hint: 'Prefijo &' },
  { key: 'funcAssign', label: 'Asignación funcional', hint: 'Prefijo =' },
  { key: 'installation', label: 'Instalación', hint: 'Prefijo ==' },
  { key: 'installType', label: 'Lugar de instalación', hint: 'Prefijo ++' },
  { key: 'mountLocation', label: 'Ubicación de montaje', hint: 'Prefijo +' },
  { key: 'creationDate', label: 'Fecha de creación', hint: 'Vacío = hoy' },
  { key: 'modDate', label: 'Fecha de modificación', hint: 'Vacío = hoy' },
];

interface Sheet {
  title: string;
  subtitle: string;
  svg: string;
}

export function buildSheets(p: Project): Sheet[] {
  const signals = cleanSignals(p.signals);
  const symbols = buildSymbolTable(signals);
  const descriptions: Record<string, string> = {};
  signals.forEach((s) => (descriptions[s.name] = s.description));
  derivedSignals(signals).forEach(
    (d) => (descriptions[d.name] = `Inductivo ${d.inverted ? 'retraído' : 'extendido'} ${d.source}`),
  );
  const pages = p.blocks.length + 1;
  const cajetin = p.cajetin ?? {};

  const sheets: Sheet[] = [];
  p.blocks.forEach((b, i) => {
    const sim = runAutoScenario(signals, b.rules, 16);
    const rows = b.rules.length ? buildRows(signals, b.rules, signalsUsedBy(b.rules)) : [];
    sheets.push({
      title: b.name,
      subtitle: `${b.rules.length} regla${b.rules.length === 1 ? '' : 's'} · ${rows.length} señales`,
      svg: renderSheet(rows, sim.history, symbols, descriptions, sim.history[0]?.states ?? {}, {
        projectName: p.name,
        cajetin,
        page: i + 2,
        pages,
        pageName: b.name,
        blockTitle: `${b.name} — Diagrama funcional`,
        ruleCount: b.rules.length,
      }),
    });
  });

  const cover: Sheet = {
    title: 'Portada',
    subtitle: 'Índice del documento',
    svg: renderCover(
      p.blocks.map((b, i) => ({ title: b.name, rules: b.rules.length, page: i + 2 })),
      { signals: signals.length, rules: allRules().length },
      { projectName: p.name, cajetin, page: 1, pages, pageName: 'Portada' },
    ),
  };
  return [cover, ...sheets];
}

export function renderDocs(app: App): HTMLElement {
  const p = project();
  const page = h(`
    <div class="page page--wide">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 5 de 5</p>
          <h1>Documentación</h1>
          <p class="lede">Hojas A3 apaisadas con la plantilla industrial: portada con índice y un diagrama funcional por bloque, con tabla de señales y cajetín.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--primary" data-act="print">${icon('printer', 16)}<span>Imprimir / Guardar PDF</span></button>
        </div>
      </header>
      <div class="docs-layout">
        <aside class="card docs-form">
          <div class="card__head"><h2>Cajetín</h2><span class="muted small">Se aplica a todas las hojas</span></div>
          <form class="form-grid" data-slot="form" novalidate></form>
        </aside>
        <section class="sheets" data-slot="sheets" aria-label="Hojas del documento"></section>
      </div>
      <footer class="page-foot">
        <button class="btn btn--ghost" data-act="prev">${icon('chevronLeft', 16)} Código PLC</button>
        <span></span>
      </footer>
    </div>`);

  const form = qs<HTMLFormElement>(page, '[data-slot="form"]');
  const list = qs(page, '[data-slot="sheets"]');
  let sheets: Sheet[] = [];

  form.innerHTML = FIELDS.map(
    (f) => `
    <label class="field">
      <span class="field__label">${f.label}${f.hint ? ` <span class="muted">· ${f.hint}</span>` : ''}</span>
      <input class="input input--sm" name="${f.key}" value="${esc(p.cajetin?.[f.key] ?? '')}" autocomplete="off" />
    </label>`,
  ).join('');

  const drawSheets = () => {
    sheets = buildSheets(p);
    list.innerHTML = sheets
      .map(
        (s, i) => `
        <figure class="sheet-card">
          <button class="sheet-card__preview" data-view="${i}" aria-label="Ampliar hoja ${i + 1}">${s.svg}</button>
          <figcaption>
            <span class="sheet-card__num">${i + 1}</span>
            <span class="sheet-card__text"><strong>${esc(s.title)}</strong><span class="muted small">${esc(s.subtitle)}</span></span>
            <button class="icon-btn" data-svg="${i}" title="Descargar SVG" aria-label="Descargar hoja ${i + 1} en SVG">${icon('download', 16)}</button>
          </figcaption>
        </figure>`,
      )
      .join('');
  };

  let timer: number | undefined;
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    setCajetin({ [t.name]: t.value } as Partial<Cajetin>);
    window.clearTimeout(timer);
    timer = window.setTimeout(drawSheets, 350);
  });

  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>('[data-view]')?.dataset.view;
    const d = t.closest<HTMLElement>('[data-svg]')?.dataset.svg;
    if (d !== undefined) {
      const s = sheets[Number(d)];
      download(`${slug(p.name)}-hoja-${Number(d) + 1}-${slug(s.title)}.svg`, standaloneSvg(s.svg), 'image/svg+xml');
    } else if (v !== undefined) {
      const s = sheets[Number(v)];
      const m = modal({
        title: `Hoja ${Number(v) + 1} · ${s.title}`,
        body: `<div class="sheet-zoom">${s.svg}</div>`,
        wide: true,
        actions: [{ label: 'Cerrar', variant: 'primary' }],
      });
      m.root.querySelector('.modal')?.classList.add('modal--xl');
    }
  });

  qs(page, '[data-act="print"]').addEventListener('click', () => {
    if (!sheets.length) return;
    document.getElementById('print-root')?.remove();
    const root = h(`<div id="print-root" aria-hidden="true">${sheets.map((s) => `<div class="print-page">${s.svg}</div>`).join('')}</div>`);
    document.body.appendChild(root);
    const cleanup = () => {
      root.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try {
      window.print();
      toast('En el diálogo de impresión elige «Guardar como PDF», tamaño A3 y orientación horizontal.', 'info', 6000);
    } catch {
      cleanup();
      toast('La impresión está bloqueada aquí. Descarga las hojas en SVG.', 'warn', 6000);
    }
  });
  qs(page, '[data-act="prev"]').addEventListener('click', () => app.go('code'));

  drawSheets();
  return page;
}
