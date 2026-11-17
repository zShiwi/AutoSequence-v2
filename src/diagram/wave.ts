/**
 * Dibujo de cronogramas (ondas digitales) compartido por la vista en pantalla
 * y las hojas de documentación.
 *
 * Cada fila es una señal; cada columna, un ciclo de simulación. Las
 * activaciones de reglas se dibujan como flechas desde el flanco que las
 * dispara hasta el cambio que provocan.
 */

import type { SimStep } from '../types';
import { esc } from '../ui/dom';

export interface WaveRow {
  name: string;
  /** in = entrada, out = salida, mark = marca, derived = inductivo. */
  kind: 'in' | 'out' | 'mark' | 'derived';
}

export interface Paint {
  grid: string;
  gridStrong: string;
  text: string;
  muted: string;
  wave: Record<WaveRow['kind'], string>;
  fill: string;
  fillOpacity: number;
  arrow: string;
  event: string;
  font: string;
  mono: string;
}

export interface WaveGeometry {
  x: number;
  y: number;
  rowH: number;
  stepW: number;
  /** Mostrar la fila de etiquetas de tiempo encima. */
  timeHeader: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Índice de la última transición de `signal` en o antes de `i`. */
function lastTransition(history: SimStep[], signal: string, i: number): number {
  for (let j = i; j >= 1; j--) {
    if (history[j].states[signal] !== history[j - 1].states[signal]) return j;
  }
  return -1;
}

export function drawWaves(
  rows: WaveRow[],
  history: SimStep[],
  g: WaveGeometry,
  paint: Paint,
  opts: { arrows?: boolean; markerId: string; highlightStep?: number } = { markerId: 'ah' },
): string {
  const out: string[] = [];
  const steps = history.length;
  const top = g.y + (g.timeHeader ? 22 : 0);
  const bottom = top + rows.length * g.rowH;
  const rowIndex = new Map(rows.map((r, i) => [r.name, i]));
  const hi = (i: number) => top + i * g.rowH + g.rowH * 0.22;
  const lo = (i: number) => top + i * g.rowH + g.rowH * 0.78;
  const mid = (i: number) => top + i * g.rowH + g.rowH * 0.5;
  const xs = (i: number) => r1(g.x + i * g.stepW);

  out.push(
    `<defs><marker id="${opts.markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" style="fill:${paint.arrow}"/></marker></defs>`,
  );

  // Columna resaltada (paso actual en modo interactivo).
  if (opts.highlightStep !== undefined && opts.highlightStep >= 0) {
    out.push(
      `<rect x="${xs(opts.highlightStep)}" y="${top}" width="${g.stepW}" height="${bottom - top}" style="fill:${paint.event};opacity:.08"/>`,
    );
  }

  // Rejilla y etiquetas de tiempo.
  const labelEvery = g.stepW < 22 ? 5 : g.stepW < 32 ? 2 : 1;
  for (let i = 0; i <= steps; i++) {
    const strong = i === 0 || i === steps;
    out.push(
      `<line x1="${xs(i)}" y1="${top}" x2="${xs(i)}" y2="${bottom}" style="stroke:${strong ? paint.gridStrong : paint.grid};stroke-width:${strong ? 1 : 0.6}"/>`,
    );
    if (g.timeHeader && i < steps && i % labelEvery === 0) {
      const hasEvent = history[i].events.length > 0;
      out.push(
        `<text x="${r1(xs(i) + g.stepW / 2)}" y="${g.y + 14}" text-anchor="middle" style="font:500 10.5px ${paint.mono};fill:${hasEvent ? paint.event : paint.muted}">${history[i].time}</text>`,
      );
    }
  }
  rows.forEach((_, i) => {
    out.push(
      `<line x1="${xs(0)}" y1="${r1(top + (i + 1) * g.rowH)}" x2="${xs(steps)}" y2="${r1(top + (i + 1) * g.rowH)}" style="stroke:${paint.grid};stroke-width:0.6"/>`,
    );
  });

  // Ondas.
  rows.forEach((row, ri) => {
    const color = paint.wave[row.kind];
    let d = '';
    let fill = '';
    let prevHigh = history[0]?.states[row.name] === 1;
    for (let i = 0; i < steps; i++) {
      const high = history[i].states[row.name] === 1;
      const y = high ? hi(ri) : lo(ri);
      if (i === 0) d += `M${xs(0)} ${r1(y)}`;
      else if (high !== prevHigh) d += `V${r1(y)}`;
      d += `H${xs(i + 1)}`;
      if (high) fill += `M${xs(i)} ${r1(lo(ri))}V${r1(hi(ri))}H${xs(i + 1)}V${r1(lo(ri))}z`;
      prevHigh = high;
    }
    if (fill) out.push(`<path d="${fill}" style="fill:${color};opacity:${paint.fillOpacity}"/>`);
    out.push(
      `<path d="${d}" style="fill:none;stroke:${color};stroke-width:1.8;stroke-linejoin:miter"/>`,
    );
  });

  // Flechas causa → efecto.
  if (opts.arrows !== false) {
    history.forEach((step, i) => {
      step.activations.forEach((act) => {
        const tr = act.triggerSignals[0];
        const ti = rowIndex.get(tr);
        const gi = rowIndex.get(act.targetSignal);
        if (ti === undefined || gi === undefined || ti === gi) return;
        const j = lastTransition(history, tr, i);
        if (j < 0) return;
        const x1 = xs(j);
        const x2 = xs(i);
        const y1 = mid(ti);
        const y2 = mid(gi);
        const bend = Math.min(g.stepW * 0.45, 14);
        const dir = y2 > y1 ? 1 : -1;
        const path =
          x1 === x2
            ? `M${x1} ${r1(y1)}C${r1(x1 + bend)} ${r1(y1)} ${r1(x2 + bend)} ${r1(y2 - dir * 6)} ${r1(x2 + 1.5)} ${r1(y2)}`
            : `M${x1} ${r1(y1)}C${r1(x1 + (x2 - x1) * 0.6)} ${r1(y1)} ${r1(x2 - (x2 - x1) * 0.1)} ${r1(y2 - dir * 10)} ${r1(x2)} ${r1(y2)}`;
        out.push(
          `<path d="${path}" style="fill:none;stroke:${paint.arrow};stroke-width:1.1;stroke-dasharray:3 2" marker-end="url(#${opts.markerId})"><title>${esc(act.ruleName)}: ${esc(tr)} → ${esc(act.targetSignal)} = ${act.toValue}</title></path>`,
        );
        out.push(`<circle cx="${x1}" cy="${r1(y1)}" r="2.2" style="fill:${paint.arrow}"/>`);
      });
    });
  }

  return out.join('');
}
