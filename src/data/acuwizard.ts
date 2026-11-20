/**
 * Asistente de proyecto nuevo para un acumulador (ACU).
 *
 * Lo que es igual en todos los ACU se crea solo: el motor con sus tres señales
 * (par y los dos inductivos de la cadena), su secuencia de seguridad y un
 * cilindro por tope con sus inductivos de activo y reposo. Los sensores que
 * dependen de cada instalación (presencia, paso de paleta, acumulación máxima)
 * los añade el usuario después.
 */

import type { Block, Cajetin, ConveyorKind, ConveyorLayout, Signal } from '../types';
import { defaultLayout } from '../plant/layout';
import { motorBlock, motorSignals } from './acu4';

export const MIN_STOPS = 1;
export const MAX_STOPS = 20;

export interface AcuOptions {
  kind: ConveyorKind;
  stops: number;
}

export const kindLabel = (k: ConveyorKind): string => (k === 'suelo' ? 'de suelo' : 'aéreo');

export function stopName(i: number): string {
  return `C${String(i).padStart(2, '0')}`;
}

export function clampStops(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.max(MIN_STOPS, Math.min(MAX_STOPS, Math.round(n)));
}

export function buildAcu(o: AcuOptions): {
  signals: Signal[];
  blocks: Block[];
  cajetin: Partial<Cajetin>;
  layout: ConveyorLayout;
} {
  const n = clampStops(o.stops);
  const cylinders: Signal[] = Array.from({ length: n }, (_, k) => {
    const name = stopName(k + 1);
    return {
      name,
      type: 'Cilindro',
      initial: 0,
      description: `Tope ${k + 1}`,
      inductivoActivo: `${name}PX2`,
      inductivoReposo: `${name}PX1`,
    };
  });
  const signals = [...motorSignals(), ...cylinders];
  return {
    signals,
    blocks: [motorBlock(), { name: 'Topes', rules: [] }],
    cajetin: {
      docType: 'Ciclograma',
      funcAssign: 'ACU',
      installation: `ACU ${kindLabel(o.kind)} · ${n} ${n === 1 ? 'tope' : 'topes'}`,
      installType: o.kind === 'suelo' ? 'De suelo' : 'Aéreo',
    },
    layout: defaultLayout(signals, o.kind),
  };
}
