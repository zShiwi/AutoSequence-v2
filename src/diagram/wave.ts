/**
 * Dibujo de cronogramas (ondas digitales) compartido por la vista en pantalla
 * y las hojas de documentación.
 *
 * Cada fila es una señal; cada columna, un ciclo de simulación. Los cambios
 * provocados por una regla llevan una etiqueta con su número (R1, R2…) sobre
 * el flanco. La relación causa → efecto se dibuja, al estilo de los diagramas
 * funcionales industriales, como una línea recta desde el flanco que dispara
 * la regla hasta la etiqueta del efecto.
 */

import type { SignalLevel, SimStep } from '../types';
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
  fillOpacity: number;
  event: string;
  link: string;
  tagFill: string;
  tagStroke: string;
  tagText: string;
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

/** Cambio de una señal provocado por una regla. */
export interface Effect {
  step: number;
  /** Ciclo en el que cambió la señal que disparó la regla (-1 si no se ve). */
  triggerStep: number;
  trigger: string;
  /** Sentido del cambio de la señal que dispara ('' si no se conoce). */
  triggerEdge: '↑' | '↓' | '';
  target: string;
  to: SignalLevel;
  label: string;
  ruleName: string;
}

/**
 * - `none`: solo etiquetas.
 * - `hover`: etiquetas; la línea aparece al señalar una (pantalla).
 * - `all`: etiquetas y todas las líneas (documentación).
 */
export type LinkMode = 'none' | 'hover' | 'all';

const r1 = (n: number) => Math.round(n * 10) / 10;

function lastTransition(history: SimStep[], signal: string, i: number): number {
  for (let j = i; j >= 1; j--) {
    if (history[j].states[signal] !== history[j - 1].states[signal]) return j;
  }
  return -1;
}

/** Efectos visibles: un cambio real de una fila mostrada, por ciclo y señal. */
export function computeEffects(
  rows: WaveRow[],
  history: SimStep[],
  ruleLabel: (ruleId: number | string, ruleIndex: number) => string,
): Effect[] {
  const shown = new Set(rows.map((r) => r.name));
  const out: Effect[] = [];
  history.forEach((step, i) => {
    if (i === 0) return;
    step.activations.forEach((a) => {
      if (!shown.has(a.targetSignal)) return;
      if (step.states[a.targetSignal] === history[i - 1].states[a.targetSignal]) return;
      const trigger = a.triggerSignals[0];
      // La regla ve el estado del INICIO de su ciclo: el cambio que la
      // dispara es el de un cambio externo en este mismo ciclo o el último
      // anterior. Un cambio al final de este ciclo es consecuencia, no causa.
      const seen = step.previousStates[trigger];
      const tj =
        seen !== history[i - 1].states[trigger] ? i : lastTransition(history, trigger, i - 1);
      out.push({
        step: i,
        triggerStep: shown.has(trigger) ? tj : -1,
        trigger,
        triggerEdge: tj < 0 ? '' : seen === 1 ? '↑' : '↓',
        target: a.targetSignal,
        to: a.toValue,
        label: ruleLabel(a.ruleId, a.ruleIndex),
        ruleName: a.ruleName,
      });
    });
  });
  return out;
}

export function drawWaves(
  rows: WaveRow[],
  history: SimStep[],
  g: WaveGeometry,
  paint: Paint,
  opts: { markerId: string; effects?: Effect[]; links?: LinkMode; highlightStep?: number },
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
  const links = opts.links ?? 'hover';

  out.push(
    `<defs><marker id="${opts.markerId}" viewBox="0 0 8 8" refX="7.2" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0.6L8 4L0 7.4z" style="fill:context-stroke"/></marker></defs>`,
  );

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
        `<text x="${r1(xs(i) + g.stepW / 2)}" y="${g.y + 14}" text-anchor="middle" style="font:${hasEvent ? 600 : 500} 10.5px ${paint.mono};fill:${hasEvent ? paint.event : paint.muted}">${history[i].time}</text>`,
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
    out.push(`<path d="${d}" style="fill:none;stroke:${color};stroke-width:1.8;stroke-linejoin:miter"/>`);
  });

  // Relaciones causa → efecto: primero todas las líneas, después las etiquetas
  // encima, para que ninguna línea tape un número.
  const fx = (opts.effects ?? []).filter((e) => rowIndex.has(e.target));
  const tagW = (label: string) => 8 + label.length * 6.4;

  if (links !== 'none') {
    fx.forEach((e, k) => {
      if (e.triggerStep < 0) return;
      const ti = rowIndex.get(e.trigger);
      const gi = rowIndex.get(e.target)!;
      if (ti === undefined || ti === gi) return;
      const x1 = xs(e.triggerStep);
      const y1 = mid(ti);
      const x2 = xs(e.step);
      const y2 = mid(gi);
      // Recortar la línea en el borde de la etiqueta del efecto.
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const hw = tagW(e.label) / 2 + 2;
      const hh = 9;
      const t = Math.min(hw / Math.max(Math.abs(dx), 0.001), hh / Math.max(Math.abs(dy), 0.001), 1);
      const ex = x2 - dx * t;
      const ey = y2 - dy * t;
      if (len < 4) return;
      out.push(
        `<g class="fx-link${links === 'hover' ? ' fx-link--hover' : ''}" data-fx="${k}">` +
          `<line x1="${x1}" y1="${r1(y1)}" x2="${r1(ex)}" y2="${r1(ey)}" style="stroke:${paint.link};stroke-width:1" marker-end="url(#${opts.markerId})"/>` +
          `<circle cx="${x1}" cy="${r1(y1)}" r="2.6" style="fill:${paint.link}"/>` +
          `</g>`,
      );
    });
  }

  fx.forEach((e, k) => {
    const gi = rowIndex.get(e.target)!;
    const w = tagW(e.label);
    const cx = xs(e.step);
    const cy = mid(gi);
    const cause = `${e.trigger}${e.triggerEdge ? ` ${e.triggerEdge}` : ''}`;
    out.push(
      `<g class="fx-tag" data-fx="${k}" data-tip-title="${esc(`${e.label} · ${e.ruleName}`)}" data-tip-body="${esc(`${cause} → ${e.target} = ${e.to}`)}" tabindex="0" role="img" aria-label="${esc(`${e.label} ${e.ruleName}: ${e.target} pasa a ${e.to}`)}">` +
        `<rect x="${r1(cx - w / 2)}" y="${r1(cy - 7.5)}" width="${r1(w)}" height="15" rx="7.5" style="fill:${paint.tagFill};stroke:${paint.tagStroke};stroke-width:1"/>` +
        `<text x="${cx}" y="${r1(cy + 3.6)}" text-anchor="middle" style="font:600 9.5px ${paint.mono};fill:${paint.tagText}">${esc(e.label)}</text>` +
        `<title>${esc(`${e.label} · ${e.ruleName}: ${e.target} = ${e.to}`)}</title>` +
        `</g>`,
    );
  });

  return out.join('');
}
