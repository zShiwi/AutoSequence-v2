/**
 * Diagrama temporal (cronograma de ondas) generado a partir de los datos de
 * simulación.
 *
 * En el index.html original el cronograma se dibujaba dentro de la "plantilla
 * industrial" con cajetín normalizado. Para esta primera fase (núcleo) se
 * genera un cronograma limpio y autónomo en SVG; la plantilla industrial
 * completa y la exportación a PDF quedan para una segunda fase.
 */

import type { Signal, SimStep } from '../types';

const ROW_H = 44; // alto por señal
const TOP = 30; // margen superior
const LABEL_W = 160; // ancho de la columna de etiquetas
const STEP_W = 46; // ancho por paso temporal
const HIGH = 8; // desplazamiento vertical del nivel alto
const LOW = 32; // desplazamiento vertical del nivel bajo

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Devuelve el marcado SVG de un cronograma con una fila por señal.
 */
export function renderTimingDiagram(
  signals: Signal[],
  simulationData: SimStep[],
): string {
  if (signals.length === 0 || simulationData.length === 0) {
    return '<p class="diagram-empty">No hay datos de simulación. Ejecuta la simulación primero.</p>';
  }

  const steps = simulationData.length;
  const width = LABEL_W + steps * STEP_W + 20;
  const height = TOP + signals.length * ROW_H + 20;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="timing-svg">`,
  );

  // Rejilla vertical + etiquetas de tiempo.
  for (let i = 0; i < steps; i++) {
    const x = LABEL_W + i * STEP_W;
    parts.push(
      `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${
        height - 20
      }" stroke="#e2e8f0" stroke-width="1" />`,
    );
    parts.push(
      `<text x="${x + STEP_W / 2}" y="${
        TOP - 12
      }" text-anchor="middle" font-size="11" fill="#718096">t${
        simulationData[i].time
      }</text>`,
    );
  }
  const xEnd = LABEL_W + steps * STEP_W;
  parts.push(
    `<line x1="${xEnd}" y1="${TOP}" x2="${xEnd}" y2="${
      height - 20
    }" stroke="#e2e8f0" stroke-width="1" />`,
  );

  // Una fila por señal.
  signals.forEach((signal, row) => {
    const rowY = TOP + row * ROW_H;
    const yHigh = rowY + HIGH;
    const yLow = rowY + LOW;

    parts.push(
      `<text x="8" y="${
        rowY + ROW_H / 2
      }" font-size="13" font-weight="600" fill="#2d3748">${esc(
        signal.name,
      )}</text>`,
    );
    parts.push(
      `<line x1="${LABEL_W}" y1="${rowY + ROW_H}" x2="${xEnd}" y2="${
        rowY + ROW_H
      }" stroke="#edf2f7" stroke-width="1" />`,
    );

    // Construir la polilínea de la onda.
    const pts: string[] = [];
    let prevY = simulationData[0].states[signal.name] === 1 ? yHigh : yLow;
    for (let i = 0; i < steps; i++) {
      const x = LABEL_W + i * STEP_W;
      const level = simulationData[i].states[signal.name] === 1 ? yHigh : yLow;
      if (level !== prevY && i > 0) {
        // Flanco vertical en el instante del cambio.
        pts.push(`${x},${prevY}`);
        pts.push(`${x},${level}`);
      } else {
        pts.push(`${x},${level}`);
      }
      pts.push(`${x + STEP_W},${level}`);
      prevY = level;
    }
    parts.push(
      `<polyline points="${pts.join(
        ' ',
      )}" fill="none" stroke="#395b8b" stroke-width="2" />`,
    );
  });

  parts.push('</svg>');
  return parts.join('\n');
}
