/** Plantillas de proyecto disponibles al crear uno nuevo. */

import type { Block, Cajetin, ConveyorLayout, Signal } from '../types';
import { acu4Layout } from '../plant/layout';
import { exampleBlocks, exampleCajetin, exampleSignals } from './example';
import { acu4Blocks, acu4Cajetin, acu4Signals } from './acu4';

export interface Template {
  id: string;
  name: string;
  /** Nombre propuesto para el proyecto. */
  projectName: string;
  description: string;
  build: () => { signals: Signal[]; blocks: Block[]; cajetin: Partial<Cajetin>; layout?: ConveyorLayout };
}

export const TEMPLATES: Template[] = [
  {
    id: 'acu4',
    name: 'Acumulador 4 topes · 2 acumulaciones máximas',
    projectName: 'ACU 4 topes',
    description:
      'Pre-carga, carga, pre-descarga y descarga con marcas de tránsito, paso de paleta, control de pieza, robot, seguridad del motor y transportador animado.',
    build: () => ({ signals: acu4Signals(), blocks: acu4Blocks(), cajetin: acu4Cajetin(), layout: acu4Layout() }),
  },
  {
    id: 'transfer',
    name: 'Estación de transferencia',
    projectName: 'Estación de transferencia (ejemplo)',
    description: 'Ejemplo corto: secuencia encadenada de dos cilindros con cinta de salida y paro.',
    build: () => ({ signals: exampleSignals(), blocks: exampleBlocks(), cajetin: exampleCajetin() }),
  },
];

export function templateStats(t: Template): { signals: number; rules: number; blocks: number } {
  const d = t.build();
  return {
    signals: d.signals.length,
    rules: d.blocks.reduce((n, b) => n + b.rules.length, 0),
    blocks: d.blocks.length,
  };
}
