/** Paso 4 · Código PLC: AWL, KOP (Ladder) y tabla de símbolos. */

import { allRules, project } from '../state/store';
import { generateAWL } from '../plc/awl';
import { generateKOP, ladderModel } from '../plc/kop';
import { buildSymbolTable, symbolTableCSV } from '../plc/addresses';
import { cleanSignals } from '../plc/signals';
import { renderLadder, standaloneSvg } from '../diagram/ladder';
import { copyText, download, esc, h, icon, qs, slug, toast } from './dom';
import type { App } from './app';

type Tab = 'awl' | 'kop' | 'symbols';
let tab: Tab = 'awl';
let kopAsText = false;

const KEYWORDS = /^(\s*)(U\(|\)|UN|U|ON|O|S|R|=|FP|FN|SPBN|SPB|SPA|NOP|L|T)(\s|$)/;

function highlightAwl(code: string): string {
  return code
    .split('\n')
    .map((raw) => {
      let line = esc(raw);
      const ci = line.indexOf('//');
      let comment = '';
      if (ci >= 0) {
        comment = `<span class="tk-c">${line.slice(ci)}</span>`;
        line = line.slice(0, ci);
      }
      line = line
        .replace(/^(NETWORK|TITLE|ORGANIZATION_BLOCK|END_ORGANIZATION_BLOCK|BEGIN|VERSION)\b/, '<span class="tk-k">$1</span>')
        .replace(/^([A-Z0-9]{2,4}):/, '<span class="tk-l">$1</span>:')
        .replace(KEYWORDS, '$1<span class="tk-op">$2</span>$3')
        .replace(/(&quot;[^&]*?&quot;)/g, '<span class="tk-s">$1</span>')
        .replace(/\b([EAM] \d+\.\d)\b/g, '<span class="tk-a">$1</span>');
      return `<span class="code__line">${line}${comment}</span>`;
    })
    .join('');
}

export function renderCode(app: App): HTMLElement {
  const p = project();
  const signals = cleanSignals(p.signals);
  const rules = allRules();
  const symbols = buildSymbolTable(signals);

  const page = h(`
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Paso 4 de 5</p>
          <h1>Código PLC</h1>
          <p class="lede">Programa equivalente a la simulación, listo para revisar e importar en STEP 7. Las direcciones se asignan automáticamente en la tabla de símbolos.</p>
        </div>
      </header>
      <section data-slot="body"></section>
      <footer class="page-foot">
        <button class="btn btn--ghost" data-act="prev">${icon('chevronLeft', 16)} Simulación</button>
        <button class="btn btn--ghost" data-act="next">Continuar a Documentación ${icon('chevronRight', 16)}</button>
      </footer>
    </div>`);
  qs(page, '[data-act="prev"]').addEventListener('click', () => app.go('sim'));
  qs(page, '[data-act="next"]').addEventListener('click', () => app.go('docs'));
  const body = qs(page, '[data-slot="body"]');

  if (!rules.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="empty__art" aria-hidden="true">${icon('code', 34)}</div>
        <h2>Sin reglas no hay programa</h2>
        <p>Define al menos una regla en Lógica para generar AWL y KOP.</p>
        <div class="empty__actions"><button class="btn btn--primary" data-act="go">${icon('logic', 16)}<span>Ir a Lógica</span></button></div>
      </div>`;
    qs(body, '[data-act="go"]').addEventListener('click', () => app.go('logic'));
    return page;
  }

  const awl = generateAWL(p.blocks, { projectName: p.name });
  const rungs = ladderModel(p.blocks);
  const base = slug(p.name);

  const draw = () => {
    const tabsHtml = (
      [
        ['awl', 'AWL (lista de instrucciones)', 'AWL'],
        ['kop', 'KOP (esquema de contactos)', 'KOP'],
        ['symbols', `Tabla de símbolos · ${symbols.length}`, `Símbolos · ${symbols.length}`],
      ] as [Tab, string, string][]
    )
      // En pantallas estrechas se muestra el texto corto para que quepan las tres.
      .map(
        ([id, label, short]) =>
          `<button role="tab" class="tab${tab === id ? ' is-active' : ''}" aria-selected="${tab === id}" aria-label="${label}" data-tab="${id}"><span class="lbl-long">${label}</span><span class="lbl-short">${short}</span></button>`,
      )
      .join('');

    let content = '';
    let tools = '';
    if (tab === 'awl') {
      tools = `
        <button class="btn btn--ghost btn--sm" data-act="copy">${icon('copy', 15)}<span>Copiar</span></button>
        <button class="btn btn--ghost btn--sm" data-act="dl-awl">${icon('download', 15)}<span>Descargar .awl</span></button>`;
      content = `<pre class="code" tabindex="0" aria-label="Código AWL"><code>${highlightAwl(awl)}</code></pre>`;
    } else if (tab === 'kop') {
      tools = `
        <label class="check"><input type="checkbox" data-act="kop-text"${kopAsText ? ' checked' : ''}/> Ver como texto</label>
        <button class="btn btn--ghost btn--sm" data-act="dl-kop">${icon('download', 15)}<span>Descargar ${kopAsText ? '.txt' : '.svg'}</span></button>`;
      content = kopAsText
        ? `<pre class="code" tabindex="0"><code>${esc(generateKOP(p.blocks))}</code></pre>`
        : `<div class="diagram-scroll diagram-scroll--ladder">${renderLadder(rungs, symbols).svg}</div>`;
    } else {
      tools = `<button class="btn btn--ghost btn--sm" data-act="dl-csv">${icon('download', 15)}<span>Descargar CSV</span></button>`;
      content = `<div class="table-scroll"><table class="table">
        <thead><tr><th>Símbolo</th><th>Dirección</th><th>Tipo</th><th>Comentario</th></tr></thead>
        <tbody>${symbols
          .map(
            (s) => `<tr><td class="mono">${esc(s.symbol)}</td><td class="mono"><span class="area area--${s.area.toLowerCase()}">${esc(s.address)}</span></td><td class="mono muted">BOOL</td><td>${esc(s.comment) || '<span class="muted">—</span>'}</td></tr>`,
          )
          .join('')}</tbody></table></div>`;
    }

    body.innerHTML = `
      <div class="callout callout--info">${icon('info', 18)}<p>Las direcciones (<strong>E</strong> entradas, <strong>A</strong> salidas, <strong>M</strong> marcas) son una propuesta automática. Ajústalas a la configuración de hardware real antes de cargar el programa. Marcas reservadas: M100–M109 memorias de flanco, M110–M119 pulsos, M120+ reglas activas.</p></div>
      <div class="card card--flush">
        <div class="tabs-bar tabs-bar--card"><div class="tabs" role="tablist">${tabsHtml}</div><div class="tabs-bar__tools">${tools}</div></div>
        ${content}
      </div>`;
  };

  body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const tb = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tb) {
      tab = tb;
      return draw();
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'copy') {
      toast((await copyText(awl)) ? 'AWL copiado al portapapeles.' : 'No se pudo copiar.', 'info');
    } else if (act === 'dl-awl') {
      void download(`${base}-OB1.awl`, awl);
    } else if (act === 'dl-kop') {
      if (kopAsText) void download(`${base}-kop.txt`, generateKOP(p.blocks));
      else void download(`${base}-kop.svg`, standaloneSvg(renderLadder(rungs, symbols).svg), 'image/svg+xml');
    } else if (act === 'dl-csv') {
      void download(`${base}-simbolos.csv`, '﻿' + symbolTableCSV(symbols), 'text/csv;charset=utf-8');
    }
  });
  body.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'kop-text') {
      kopAsText = t.checked;
      draw();
    }
  });

  draw();
  return page;
}
