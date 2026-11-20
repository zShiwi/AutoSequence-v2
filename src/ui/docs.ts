/** Paso 5 · Documentación: hojas A3 con cajetín, portada e impresión. */

import { allRules, project, setCajetin } from '../state/store';
import { runAutoScenario } from '../plc/simulation';
import { auxiliarySymbols, buildSymbolTable, type SymbolEntry } from '../plc/addresses';
import { cleanSignals, derivedSignals, signalsUsedBy } from '../plc/signals';
import { buildRows } from '../diagram/timing';
import { ruleLabeler, ruleLogicText } from '../plc/rules';
import { SYMBOL_ROWS_PER_SHEET, renderCover, renderSheet, renderSymbolSheet, type SymbolRow } from '../diagram/sheet';
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

const GROUPS: Record<SymbolEntry['area'], string> = { E: 'Entradas (E)', A: 'Salidas (A)', M: 'Marcas (M)' };

/**
 * Filas de la tabla de símbolos del documento: las señales por áreas, con las
 * direcciones guardadas, y detrás las marcas auxiliares que usa el programa
 * (las mismas que lista la vista de Código).
 */
export function symbolRows(symbols: SymbolEntry[], auxiliary: SymbolEntry[]): SymbolRow[] {
  const rows: SymbolRow[] = [];
  (['E', 'A', 'M'] as const).forEach((area) => {
    const list = symbols.filter((t) => t.area === area);
    if (list.length) rows.push({ group: GROUPS[area] }, ...list);
  });
  if (auxiliary.length) rows.push({ group: 'Marcas auxiliares del programa' }, ...auxiliary);
  return rows;
}

/** Reparte las filas en hojas; un título de grupo no se queda solo al final. */
function paginate(rows: SymbolRow[]): SymbolRow[][] {
  const pages: SymbolRow[][] = [];
  let cur: SymbolRow[] = [];
  rows.forEach((r) => {
    if (cur.length === SYMBOL_ROWS_PER_SHEET || ('group' in r && cur.length === SYMBOL_ROWS_PER_SHEET - 1)) {
      pages.push(cur);
      cur = [];
    }
    cur.push(r);
  });
  if (cur.length) pages.push(cur);
  return pages;
}

export function buildSheets(p: Project): Sheet[] {
  const signals = cleanSignals(p.signals);
  const symbols = buildSymbolTable(signals);
  const auxiliary = auxiliarySymbols(p.blocks, signals);
  const symbolPages = paginate(symbolRows(symbols, auxiliary));
  const symbolCount = symbols.length + auxiliary.length;
  const descriptions: Record<string, string> = {};
  signals.forEach((s) => (descriptions[s.name] = s.description));
  derivedSignals(signals).forEach(
    (d) => (descriptions[d.name] = `Inductivo ${d.inverted ? 'retraído' : 'extendido'} ${d.source}`),
  );
  const pages = p.blocks.length + 1 + symbolPages.length;
  const cajetin = p.cajetin ?? {};
  const ruleLabel = ruleLabeler(p.blocks);

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
        ruleLabel,
        legend: b.rules.map((r, ri) => ({
          label: ruleLabel(r.id, ri),
          name: r.name,
          logic: ruleLogicText(r),
        })),
      }),
    });
  });

  const symbolNote = `${symbolCount} símbolo${symbolCount === 1 ? '' : 's'}`;
  symbolPages.forEach((rows, i) => {
    const title = symbolPages.length > 1 ? `Tabla de símbolos (${i + 1} de ${symbolPages.length})` : 'Tabla de símbolos';
    sheets.push({
      title,
      subtitle: `${symbolNote} · direcciones E, A y M`,
      svg: renderSymbolSheet(rows, {
        projectName: p.name,
        cajetin,
        page: p.blocks.length + 2 + i,
        pages,
        pageName: 'Tabla de símbolos',
        title,
        note: `${symbols.length} señal${symbols.length === 1 ? '' : 'es'} · ${auxiliary.length} marca${auxiliary.length === 1 ? '' : 's'} auxiliar${auxiliary.length === 1 ? '' : 'es'}`,
      }),
    });
  });

  const cover: Sheet = {
    title: 'Portada',
    subtitle: 'Índice del documento',
    svg: renderCover(
      [
        ...p.blocks.map((b, i) => ({ title: b.name, rules: b.rules.length, page: i + 2 })),
        ...(symbolPages.length ? [{ title: 'Tabla de símbolos', rules: 0, page: p.blocks.length + 2, note: symbolNote }] : []),
      ],
      { signals: signals.length, rules: allRules().length },
      { projectName: p.name, cajetin, page: 1, pages, pageName: 'Portada' },
    ),
  };
  return [cover, ...sheets];
}

/** Documento HTML autónomo con todas las hojas, una por página A3. */
function printableHtml(title: string, svgs: string[]): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(title)} · Documentación</title>
<style>
@page { size: A3 landscape; margin: 0; }
html, body { margin: 0; background: #e9ecef; }
.page { width: 420mm; height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); break-after: page; }
.page:last-child { break-after: auto; }
.page svg { display: block; width: 100%; height: 100%; }
@media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; } }
</style></head><body>
${svgs.map((s) => `<div class="page">${s}</div>`).join('\n')}
</body></html>
`;
}

export function renderDocs(app: App): HTMLElement {
  const p = project();
  const page = h(`
    <div class="page page--wide">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 5 de 5</p>
          <h1>Documentación</h1>
          <p class="lede">Hojas A3 apaisadas con la plantilla industrial: portada con índice, un diagrama funcional por bloque con su tabla de señales y la tabla de símbolos con las direcciones, todo con cajetín.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--ghost" data-act="html" title="Documento completo para abrir en el navegador e imprimir">${icon('download', 16)}<span>Documento .html</span></button>
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
      void download(`${slug(p.name)}-hoja-${Number(d) + 1}-${slug(s.title)}.svg`, standaloneSvg(s.svg), 'image/svg+xml');
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
  qs(page, '[data-act="html"]').addEventListener('click', () => {
    void download(
      `${slug(p.name)}-documentacion.html`,
      printableHtml(p.name, sheets.map((s) => s.svg)),
      'text/html;charset=utf-8',
      'Documento descargado. Ábrelo en el navegador e imprime en A3 horizontal.',
    );
  });
  qs(page, '[data-act="prev"]').addEventListener('click', () => app.go('code'));

  drawSheets();
  return page;
}
