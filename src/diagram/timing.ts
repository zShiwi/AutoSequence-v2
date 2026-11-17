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
  signals.forEach((s) => {
    if (!only || only.has(s.name)) {
      const kind: WaveRow['kind'] =
        s.type === 'Virtual' ? 'mark' : s.type === 'Sensor' && !targets.has(s.name) ? 'in' : 'out';
      rows.push({ name: s.name, kind });
    }
    derived
      .filter((d) => d.source === s.name && (!only || only.has(d.name)))
      .forEach((d) => rows.push({ name: d.name, kind: 'derived' }));
  });
  return rows;
}

const KIND_TAG: Record<WaveRow['kind'], string> = {
  in: 'ENT',
  out: 'SAL',
  mark: 'MARCA',
  derived: 'IND',
};

export function renderTimingDiagram(
  rows: WaveRow[],
  history: SimStep[],
  opts: {
    stepW?: number;
    highlightStep?: number;
    links?: LinkMode;
    ruleLabel?: (ruleId: number | string, ruleIndex: number) => string;
  } = {},
): string {
  if (!rows.length || !history.length) {
    return '<p class="empty-inline">No hay datos de simulación.</p>';
  }
  const labelW = 188;
  const rowH = 38;
  const stepW = opts.stepW ?? Math.max(36, Math.min(48, Math.floor(1100 / history.length)));
  const width = labelW + history.length * stepW + 16;
  const height = 22 + rows.length * rowH + 8;

  const labels = rows
    .map((r, i) => {
      const y = 22 + i * rowH + rowH / 2;
      return `<g class="td-label"><text x="12" y="${y + 4}" style="font:500 12.5px ${SCREEN_PAINT.mono};fill:${SCREEN_PAINT.text}">${esc(r.name)}</text><text x="${labelW - 12}" y="${y + 4}" text-anchor="end" style="font:600 9px ${SCREEN_PAINT.font};letter-spacing:.06em;fill:${SCREEN_PAINT.wave[r.kind]}">${KIND_TAG[r.kind]}</text></g>`;
    })
    .join('');

  const effects = computeEffects(rows, history, opts.ruleLabel ?? ((_, i) => `R${i + 1}`));
  const waves = drawWaves(
    rows,
    history,
    { x: labelW, y: 0, rowH, stepW, timeHeader: true },
    SCREEN_PAINT,
    { markerId: 'td-ah', effects, links: opts.links ?? 'hover', highlightStep: opts.highlightStep },
  );

  return `<svg class="timing-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Cronograma de señales">
  <text x="12" y="14" style="font:600 10px ${SCREEN_PAINT.font};letter-spacing:.08em;fill:${SCREEN_PAINT.muted}">SEÑAL</text>
  <text x="${labelW - 12}" y="14" text-anchor="end" style="font:600 10px ${SCREEN_PAINT.font};letter-spacing:.08em;fill:${SCREEN_PAINT.muted}">CICLO →</text>
  ${labels}${waves}</svg>`;
}
