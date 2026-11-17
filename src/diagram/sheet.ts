/**
 * Hojas de documentación A3 apaisadas (1587 × 1122), con la misma maqueta que
 * la plantilla industrial del prototipo: marco, regleta de columnas, tabla de
 * señales a la izquierda, cronograma a la derecha y cajetín inferior.
 *
 * Son documentos para imprimir: blanco y negro, independientes del tema.
 */

import type { Cajetin, SimStep } from '../types';
import { esc } from '../ui/dom';
import { addressOf, type SymbolEntry } from '../plc/addresses';
import { computeEffects, drawWaves, type Paint, type WaveRow } from './wave';

export const SHEET_W = 1587;
export const SHEET_H = 1122;

const FONT = "'IBM Plex Sans', Arial, Helvetica, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier New', monospace";

const PAPER: Paint = {
  grid: '#D2D2D2',
  gridStrong: '#000000',
  text: '#000000',
  muted: '#555555',
  wave: { in: '#000000', out: '#000000', mark: '#3A3A3A', derived: '#4A4A4A' },
  fillOpacity: 0.07,
  event: '#000000',
  link: '#000000',
  tagFill: '#FFFFFF',
  tagStroke: '#000000',
  tagText: '#000000',
  font: FONT,
  mono: MONO,
};

/** Línea de la leyenda de reglas de una hoja. */
export interface RuleLegend {
  label: string;
  name: string;
  logic: string;
}

function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  text.split(/\s+/).forEach((w) => {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  });
  if (cur) lines.push(cur);
  return lines.map((l) => clip(l, max + 4));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function txt(
  x: number,
  y: number,
  s: string,
  o: { size?: number; weight?: number; anchor?: string; mono?: boolean; color?: string; italic?: boolean } = {},
): string {
  return `<text x="${x}" y="${y}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''} style="font:${o.italic ? 'italic ' : ''}${o.weight ?? 400} ${o.size ?? 11}px ${o.mono ? MONO : FONT};fill:${o.color ?? '#000'}">${esc(s)}</text>`;
}

function cell(x: number, y: number, w: number, hgt: number, fill = '#fff', sw = 0.5): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" style="fill:${fill};stroke:#000;stroke-width:${sw}"/>`;
}

function frame(): string {
  const out = [
    `<rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" style="fill:#fff"/>`,
    `<rect x="5" y="5" width="1577" height="1112" style="fill:none;stroke:#000;stroke-width:2"/>`,
    `<rect x="15" y="15" width="1557" height="1092" style="fill:none;stroke:#000;stroke-width:1"/>`,
    `<line x1="15" y1="40" x2="1572" y2="40" style="stroke:#000;stroke-width:1"/>`,
  ];
  const w = 1557 / 10;
  for (let i = 0; i < 10; i++) {
    const x = 15 + i * w;
    if (i > 0) out.push(`<line x1="${x}" y1="15" x2="${x}" y2="40" style="stroke:#000;stroke-width:.6"/>`);
    out.push(txt(x + w / 2, 32, String(i), { size: 11, anchor: 'middle', color: '#333' }));
  }
  return out.join('');
}

export interface SheetMeta {
  projectName: string;
  cajetin: Partial<Cajetin>;
  page: number;
  pages: number;
  pageName: string;
}

function titleBlock(m: SheetMeta): string {
  const c = m.cajetin;
  const today = new Date().toLocaleDateString('es-ES');
  const out: string[] = ['<g transform="translate(15,1020)">'];
  out.push(cell(0, 0, 1557, 87, '#fff', 1.5));
  [311, 622, 933, 1244].forEach((x) => out.push(`<line x1="${x}" y1="0" x2="${x}" y2="87" style="stroke:#000;stroke-width:1"/>`));

  const pair = (x: number, y: number, h: number, label: string, value: string, lsize = 10, vsize = 11) => {
    out.push(cell(x, y, 120, h, '#F0F0F0'), cell(x + 120, y, 191, h));
    const ty = y + h / 2 + lsize * 0.36;
    out.push(txt(x + 5, ty, label, { size: lsize, weight: 700 }));
    out.push(txt(x + 125, y + h / 2 + vsize * 0.36, clip(value, 28), { size: vsize }));
  };

  // Columna 1
  pair(0, 0, 29, 'Page name', m.pageName);
  pair(0, 29, 29, 'Designer', c.designer ?? '');
  pair(0, 58, 29, 'Date of creation', c.creationDate || today);
  // Columna 2
  pair(311, 0, 29, 'Modification date', c.modDate || today);
  out.push(cell(311, 29, 120, 58, '#F0F0F0'), cell(431, 29, 191, 58));
  out.push(txt(316, 52, 'Responsible for', { size: 10, weight: 700 }), txt(316, 66, 'project', { size: 10, weight: 700 }));
  out.push(txt(436, 62, clip(c.responsible ?? '', 28), { size: 11 }));
  // Columna 3: empresa y proyecto
  out.push(cell(622, 0, 311, 50, '#fff', 1));
  out.push(txt(777, 26, clip(c.company || 'AutoSequence', 26), { size: 19, weight: 700, anchor: 'middle' }));
  out.push(txt(777, 42, clip(c.companySubtitle ?? '', 44), { size: 10.5, anchor: 'middle', color: '#333' }));
  out.push(cell(622, 50, 90, 37, '#F0F0F0'), cell(712, 50, 221, 37));
  out.push(txt(627, 73, 'Project', { size: 10, weight: 700 }));
  out.push(txt(717, 73, clip(m.projectName, 30), { size: 11, weight: 600 }));
  // Columna 4: datos de documento (prefijos IEC 81346)
  const rows: [string, string][] = [
    ['& Document type', c.docType ?? ''],
    ['= Functional assign.', c.funcAssign ?? ''],
    ['== Installation', c.installation ?? ''],
    ['++ Place of install.', c.installType ?? ''],
    ['+ Mounting location', c.mountLocation ?? ''],
  ];
  const hs = [17, 17, 17, 18, 18];
  let yy = 0;
  rows.forEach(([l, v], i) => {
    out.push(cell(933, yy, 120, hs[i], '#F0F0F0'), cell(1053, yy, 191, hs[i]));
    out.push(txt(938, yy + hs[i] - 5, l, { size: 9, weight: 700 }));
    out.push(txt(1058, yy + hs[i] - 5, clip(v, 30), { size: 9.5 }));
    yy += hs[i];
  });
  // Columna 5: paginación
  out.push(cell(1244, 0, 313, 87, '#fff', 1));
  out.push(txt(1400, 22, 'PAGE', { size: 10, weight: 700, anchor: 'middle', color: '#333' }));
  out.push(txt(1400, 60, String(m.page), { size: 34, weight: 700, anchor: 'middle' }));
  out.push(txt(1400, 78, `of ${m.pages}`, { size: 10.5, anchor: 'middle', color: '#333' }));
  out.push('</g>');
  return out.join('');
}

export function renderSheet(
  rows: WaveRow[],
  history: SimStep[],
  symbols: SymbolEntry[],
  descriptions: Record<string, string>,
  initial: Record<string, number>,
  meta: SheetMeta & {
    blockTitle: string;
    ruleCount: number;
    legend: RuleLegend[];
    ruleLabel: (ruleId: number | string, ruleIndex: number) => string;
  },
): string {
  const out: string[] = [frame()];
  // Leyenda de reglas al pie del área de diagrama; las filas usan el resto.
  const legendLines = meta.legend.slice(0, 14);
  const legendH = legendLines.length ? 34 + legendLines.length * 19 : 0;
  const rowH = Math.min(56, (940 - legendH - 16) / Math.max(rows.length, 1));
  const tableTop = 40;

  // Tabla de señales.
  out.push('<g transform="translate(15,40)">');
  out.push(`<rect x="0" y="0" width="450" height="980" style="fill:#fff;stroke:#000;stroke-width:1"/>`);
  [65, 305, 395].forEach((x) => out.push(`<line x1="${x}" y1="0" x2="${x}" y2="980" style="stroke:#000;stroke-width:1"/>`));
  out.push(`<line x1="449" y1="0" x2="449" y2="980" style="stroke:#000;stroke-width:2"/>`);
  out.push(`<line x1="0" y1="40" x2="450" y2="40" style="stroke:#000;stroke-width:1"/>`);
  out.push(txt(6, 26, 'Actuator', { size: 12.5, weight: 700 }));
  out.push(txt(72, 26, 'Designation', { size: 12.5, weight: 700 }));
  out.push(txt(311, 18, 'Denomination', { size: 11, weight: 700 }), txt(311, 33, 'Signal', { size: 11, weight: 700 }));
  out.push(`<text x="430" y="34" transform="rotate(-90 430 34)" style="font:700 10px ${FONT}">Status</text>`);
  rows.forEach((r, i) => {
    const y = tableTop + i * rowH;
    const cy = y + rowH / 2 + 4;
    out.push(`<line x1="0" y1="${y + rowH}" x2="450" y2="${y + rowH}" style="stroke:#BDBDBD;stroke-width:.6"/>`);
    out.push(txt(6, cy, addressOf(symbols, r.name), { size: 10, mono: true }));
    out.push(txt(72, cy, clip(descriptions[r.name] ?? '', 34), { size: 11 }));
    out.push(txt(311, cy, clip(r.name, 12), { size: 10.5, mono: true, weight: 500 }));
    out.push(txt(422, cy, String(initial[r.name] ?? 0), { size: 11, anchor: 'middle', mono: true }));
  });
  out.push('</g>');

  // Área de diagrama.
  out.push(txt(480, 56, meta.blockTitle, { size: 13, weight: 700 }));
  out.push(
    txt(1562, 56, `${meta.ruleCount} regla${meta.ruleCount === 1 ? '' : 's'} · ${history.length} ciclos`, {
      size: 10.5,
      anchor: 'end',
      color: '#444',
    }),
  );
  const stepW = 1082 / Math.max(history.length, 1);
  out.push(
    drawWaves(rows, history, { x: 480, y: 58, rowH, stepW, timeHeader: true }, PAPER, {
      markerId: `sh-ah-${meta.page}`,
      effects: computeEffects(rows, history, meta.ruleLabel),
      links: 'all',
    }),
  );
  if (!rows.length) {
    out.push(txt(1020, 500, 'Este bloque no tiene reglas: no hay señales que documentar.', { size: 14, anchor: 'middle', color: '#666', italic: true }));
  }

  if (legendLines.length) {
    const ly = 1020 - legendH;
    out.push(`<line x1="465" y1="${ly}" x2="1572" y2="${ly}" style="stroke:#000;stroke-width:1"/>`);
    out.push(txt(480, ly + 20, 'REGLAS DEL BLOQUE', { size: 10, weight: 700, color: '#333' }));
    legendLines.forEach((l, i) => {
      const y = ly + 40 + i * 19;
      out.push(`<rect x="480" y="${y - 11}" width="${8 + l.label.length * 6.4}" height="15" rx="7.5" style="fill:#fff;stroke:#000;stroke-width:1"/>`);
      out.push(txt(484 + (l.label.length * 6.4) / 2, y + 0.5, l.label, { size: 9.5, weight: 600, mono: true, anchor: 'middle' }));
      out.push(txt(522, y, clip(l.name, 34), { size: 11, weight: 600 }));
      out.push(txt(760, y, clip(l.logic, 118), { size: 10.5, mono: true, color: '#222' }));
    });
    if (meta.legend.length > legendLines.length) {
      out.push(txt(1562, ly + 20, `+${meta.legend.length - legendLines.length} reglas más (ver código PLC)`, { size: 10, anchor: 'end', color: '#555' }));
    }
  }

  out.push(titleBlock(meta));
  return wrap(out.join(''));
}

export function renderCover(
  index: { title: string; rules: number; page: number }[],
  stats: { signals: number; rules: number },
  meta: SheetMeta,
): string {
  const c = meta.cajetin;
  const out: string[] = [frame()];
  // Título con salto de línea para que no invada el índice (columna derecha).
  const titleLines = wrapWords(meta.projectName, 24).slice(0, 3);
  out.push(txt(120, 250, (c.docType || 'Documentación de automatización').toUpperCase(), { size: 16, weight: 600, color: '#444' }));
  titleLines.forEach((l, i) => out.push(txt(120, 312 + i * 54, l, { size: 46, weight: 700 })));
  const ruleY = 312 + (titleLines.length - 1) * 54 + 30;
  out.push(`<line x1="120" y1="${ruleY}" x2="760" y2="${ruleY}" style="stroke:#000;stroke-width:2"/>`);
  out.push(txt(120, ruleY + 36, clip(`${c.company || ''}${c.companySubtitle ? ' · ' + c.companySubtitle : ''}`, 64), { size: 16, color: '#333' }));
  out.push(txt(120, ruleY + 68, `${stats.signals} señales · ${stats.rules} reglas · ${index.length} bloques`, { size: 14, color: '#333' }));

  out.push(txt(900, 250, 'ÍNDICE', { size: 14, weight: 700, color: '#444' }));
  out.push(`<line x1="900" y1="262" x2="1460" y2="262" style="stroke:#000;stroke-width:1"/>`);
  index.forEach((e, i) => {
    const y = 296 + i * 34;
    out.push(txt(900, y, clip(e.title, 40), { size: 15 }));
    out.push(txt(1340, y, `${e.rules} regla${e.rules === 1 ? '' : 's'}`, { size: 12, anchor: 'end', color: '#555' }));
    out.push(txt(1460, y, String(e.page), { size: 15, weight: 600, anchor: 'end', mono: true }));
    out.push(`<line x1="900" y1="${y + 12}" x2="1460" y2="${y + 12}" style="stroke:#CFCFCF;stroke-width:.6"/>`);
  });

  out.push(titleBlock(meta));
  return wrap(out.join(''));
}

function wrap(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sheet-svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}" height="${SHEET_H}">${body}</svg>`;
}
