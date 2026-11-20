/**
 * Cronograma en pantalla: etiquetas de señal a la izquierda y ondas a la
 * derecha, con colores tomados de las variables CSS del tema (claro/oscuro).
 */

import type { Rule, Signal, SimStep } from '../types';
import { esc } from '../ui/dom';
import { actionTargets, derivedSignals } from '../plc/signals';
import { computeEffects, drawWaves, type LinkMode, type Paint, type WaveRow } from './wave';

export const SCREEN_PAINT: Paint = {
  grid: 'var(--td-grid, #E3E7EB)',
  gridStrong: 'var(--td-grid-strong, #B9C2CA)',
  text: 'var(--ink, #16212B)',
  muted: 'var(--ink-3, #7A8794)',
  wave: {
    in: 'var(--td-in, #2B7A78)',
    out: 'var(--td-out, #1E4F7A)',
    mark: 'var(--td-mark, #6A5A8C)',
    derived: 'var(--td-derived, #5C8F8D)',
  },
  fillOpacity: 0.1,
  event: 'var(--td-event, #C27803)',
  link: 'var(--td-link, #44525F)',
  tagFill: 'var(--td-tag-bg, #FFFFFF)',
  tagStroke: 'var(--td-tag-line, #B9C2CA)',
  tagText: 'var(--td-tag-ink, #16212B)',
  font: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

/** Filas del cronograma: señales en orden, con sus inductivos debajo. */
export function buildRows(signals: Signal[], rules: Rule[], only?: Set<string>): WaveRow[] {
  const targets = actionTargets(rules);
  const derived = derivedSignals(signals);
  const rows: WaveRow[] = [];
  // Inductivos de cilindros que no pertenecen al bloque (condiciones que
  // llegan de otra zona): se agrupan al final.
  const external: WaveRow[] = [];
  signals.forEach((s) => {
    if (!only || only.has(s.name)) {
      const kind: WaveRow['kind'] =
        s.type === 'Virtual' ? 'mark' : s.type === 'Sensor' && !targets.has(s.name) ? 'in' : 'out';
      rows.push({ name: s.name, kind });
    }
    derived
      .filter((d) => d.source === s.name && (!only || only.has(d.name)))
      .forEach((d) => (only && !only.has(d.source) ? external : rows).push({ name: d.name, kind: 'derived' }));
  });
  return [...rows, ...external];
}

const KIND_TAG: Record<WaveRow['kind'], string> = {
  in: 'ENT',
  out: 'SAL',
  mark: 'MARCA',
  derived: 'IND',
};

const KIND_TITLE: Record<WaveRow['kind'], string> = {
  in: 'Entrada',
  out: 'Salida',
  mark: 'Marca',
  derived: 'Inductivo',
};

export interface TimingOptions {
  stepW?: number;
  highlightStep?: number;
  links?: LinkMode;
  ruleLabel?: (ruleId: number | string, ruleIndex: number) => string;
  /** Pantallas estrechas: columna de nombres ajustada y tipo como marca de color. */
  compact?: boolean;
}

const ROW_H = 38;
const HEAD_H = 22;
/** Margen a la izquierda de las ondas cuando van en su propio SVG. */
const WAVES_PAD = 8;

/** Medidas comunes del cronograma entero y de sus dos mitades. */
function measure(rows: WaveRow[], history: SimStep[], opts: TimingOptions) {
  const compact = !!opts.compact;
  // En compacto la columna mide lo que el nombre más largo (unos 7 px por letra).
  const longest = rows.reduce((n, r) => Math.max(n, r.name.length), 0);
  const labelW = compact ? Math.min(188, Math.max(72, 22 + Math.ceil(longest * 6.9))) : 188;
  const stepW = opts.stepW ?? Math.max(36, Math.min(48, Math.floor(1100 / history.length)));
  return { compact, labelW, stepW, wavesW: history.length * stepW + 16, height: HEAD_H + rows.length * ROW_H + 8 };
}

/** Columna de nombres: cabecera, nombre de cada señal y su tipo. */
function namesColumn(rows: WaveRow[], labelW: number, compact: boolean): string {
  const labels = rows
    .map((r, i) => {
      const y = HEAD_H + i * ROW_H + ROW_H / 2;
      if (compact) {
        return `<g class="td-label"><title>${KIND_TITLE[r.kind]}</title><rect x="4" y="${y - 8}" width="3" height="16" rx="1.5" style="fill:${SCREEN_PAINT.wave[r.kind]}"/><text x="12" y="${y + 4}" style="font:500 11.5px ${SCREEN_PAINT.mono};fill:${SCREEN_PAINT.text}">${esc(r.name)}</text></g>`;
      }
      return `<g class="td-label"><text x="12" y="${y + 4}" style="font:500 12.5px ${SCREEN_PAINT.mono};fill:${SCREEN_PAINT.text}">${esc(r.name)}</text><text x="${labelW - 12}" y="${y + 4}" text-anchor="end" style="font:600 9px ${SCREEN_PAINT.font};letter-spacing:.06em;fill:${SCREEN_PAINT.wave[r.kind]}">${KIND_TAG[r.kind]}</text></g>`;
    })
    .join('');
  return `<text x="12" y="14" style="font:600 10px ${SCREEN_PAINT.font};letter-spacing:.08em;fill:${SCREEN_PAINT.muted}">SEÑAL</text>
  ${compact ? '' : `<text x="${labelW - 12}" y="14" text-anchor="end" style="font:600 10px ${SCREEN_PAINT.font};letter-spacing:.08em;fill:${SCREEN_PAINT.muted}">CICLO →</text>`}
  ${labels}`;
}

function wavesAt(x: number, rows: WaveRow[], history: SimStep[], stepW: number, opts: TimingOptions): string {
  const effects = computeEffects(rows, history, opts.ruleLabel ?? ((_, i) => `R${i + 1}`));
  return drawWaves(rows, history, { x, y: 0, rowH: ROW_H, stepW, timeHeader: true }, SCREEN_PAINT, {
    markerId: 'td-ah',
    effects,
    links: opts.links ?? 'hover',
    highlightStep: opts.highlightStep,
  });
}

/** Cronograma en un único SVG (para descargar como imagen). */
export function renderTimingDiagram(rows: WaveRow[], history: SimStep[], opts: TimingOptions = {}): string {
  if (!rows.length || !history.length) {
    return '<p class="empty-inline">No hay datos de simulación.</p>';
  }
  const m = measure(rows, history, opts);
  const width = m.labelW + m.wavesW;
  return `<svg class="timing-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${m.height}" width="${width}" height="${m.height}" role="img" aria-label="Cronograma de señales">
  ${namesColumn(rows, m.labelW, m.compact)}${wavesAt(m.labelW, rows, history, m.stepW, opts)}</svg>`;
}

/**
 * Cronograma en pantalla, partido en dos SVG de la misma altura dentro del
 * mismo contenedor con desplazamiento: los nombres quedan fijos a la izquierda
 * (`position: sticky`) y las ondas se desplazan por debajo. Al compartir
 * contenedor, el desplazamiento vertical es el mismo para los dos.
 */
export function renderTimingSplit(rows: WaveRow[], history: SimStep[], opts: TimingOptions = {}): string {
  if (!rows.length || !history.length) {
    return '<p class="empty-inline">No hay datos de simulación.</p>';
  }
  const m = measure(rows, history, opts);
  const wavesW = WAVES_PAD + m.wavesW;
  return `<div class="timing${m.compact ? ' timing--compact' : ''}" style="--td-names-w:${m.labelW}px">
  <svg class="timing-names" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.labelW} ${m.height}" width="${m.labelW}" height="${m.height}" role="img" aria-label="Señales del cronograma">
  ${namesColumn(rows, m.labelW, m.compact)}</svg>
  <svg class="timing-svg timing-svg--waves" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wavesW} ${m.height}" width="${wavesW}" height="${m.height}" role="img" aria-label="Cronograma de señales">
  ${wavesAt(WAVES_PAD, rows, history, m.stepW, opts)}</svg>
</div>`;
}
